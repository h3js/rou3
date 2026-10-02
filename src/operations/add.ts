import { expandGroupDelimiters, joinGroup, scanFirstGroup } from "../_group-delimiters.ts";
import { toUnnamedGroupKey } from "../_group-names.ts";
import {
  absolutePattern,
  addName,
  checkConstraints,
  dotSegments,
  encodeEscapes,
  expandedRouteId,
  expandModifiers,
  invalidSyntax,
  MISPLACED_MODIFIER,
  oneCatchAll,
  segmentKey,
  splitRoute,
  splitStar,
  starGroups,
  type Unnamed,
} from "../_pattern.ts";
import { getParamRegexp, linearRegExp } from "../_segment-regexp.ts";
import { createRouter } from "../context.ts";
import { NullProtoObj } from "../object.ts";
import type { Node, RouterContext, ParamsIndexMap } from "../types.ts";

/**
 * Add a route to the router. `data` is returned when the route matches.
 *
 * `method` is an HTTP method (upper-cased), or `""` for every method. `path` is
 * a route pattern (see README "Route patterns"):
 *
 * - `:name` matches one segment, `:name(regex)` one the regex matches, and an
 *   unnamed `(regex)` captures into a numbered key (`"0"`, `"1"`, …).
 * - `:name?`, `:name+` and `:name*` match zero or one, one or more, and zero or
 *   more segments.
 * - `*` (or `(.*)`) matches the rest of the path, `/` included, and is optional
 *   at the end of a route. `**` matches zero or more segments, `**:name` one or
 *   more into `name`.
 * - `{...}` groups text, and `{...}?` makes it optional.
 *
 * Literal text is percent-encoded (`/café` is `/caf%C3%A9`), and a pattern
 * without a leading `/` gets one.
 *
 * `.` / `..` segments are resolved like `new URL()` resolves a path
 * (`/foo/../bar` is `/bar`, see docs/reference.md "Dot segments").
 *
 * @throws a `rou3:` error quoting the pattern when its syntax has no meaning
 * (see docs/reference.md "Invalid patterns"): for example an unclosed `(` or `{`, a
 * misplaced modifier (`*?`, `/foo?`), an invalid or repeated param name (`/:0`,
 * `/a/:x/:x`), a second catch-all (`/*\/x/*`), a capturing group, anchor,
 * look-around or backreference in a regex constraint, a raw tab, LF or CR
 * (URLPattern drops it; write `%09`, `%0A`, `%0D`), or a `.` / `..` segment
 * next to a param, catch-all or group (`/:id/..`, `/a/../:id`).
 */
export function addRoute<T>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  data?: T,
): void {
  method = method.toUpperCase();
  path = absolutePattern(path);
  checkConstraints(path);
  // `.` / `..` segments resolved (errors quote `path`, as written)
  const resolved = dotSegments(path);
  const [route, unnamed] = starGroups(resolved);
  variants = undefined;
  // A `:name(.*)` keys its `*`: an identity of its own (not the `*` route's)
  _add(ctx, method, route, data, unnamed && expandedRouteId(resolved), path, unnamed);
}

/**
 * The `variants` token of the `addRoute` call in progress: set once it
 * registers several entries (see `MethodData.variants`).
 */
let variants: object | undefined;

/**
 * `route` is the registration identity `removeRoute` splices entries by. A
 * pattern that expands (groups, `?`/`+`/`*` modifiers) stamps its normalized
 * *pre-expansion* text (`expandedRouteId`) on every entry, so the `/admin`
 * entry of `/admin/:page?` is never confused with a separately registered
 * `/admin` on the same node. A plain pattern's identity is its rewritten
 * segment join — the string `ctx.static` is keyed by (one `join` per entry,
 * no extra parsing) — so spellings the tree cannot tell apart (`\)` vs `)`,
 * `/a/` vs `/a`) share one identity. `input` is the pattern as written, quoted
 * in errors (an expansion is rewritten: `:x+` is `**:x`). `unnamed` maps the
 * index of an unnamed capture in `path` to its key in `input` (see
 * `skipGroup`). Returns how many unnamed captures `path` has.
 */
function _add<T>(
  ctx: RouterContext<T>,
  method: string,
  path: string,
  data: T | undefined,
  route?: string,
  input: string = path,
  unnamed: Unnamed = same,
): number {
  const groupExpanded = expandGroupDelimiters(path, input);
  if (groupExpanded) {
    // A single expansion (`/a/*-{:x}?` is `/a/*-:x?`) is that route
    if (groupExpanded[1] !== undefined) {
      route ??= expandedRouteId(path);
      variants ??= {};
    }
    _add(ctx, method, groupExpanded[0], data, route, input, unnamed);
    if (groupExpanded[1] !== undefined) {
      // A pattern without a `*` or `(` has no unnamed capture to renumber
      _add(
        ctx,
        method,
        groupExpanded[1],
        data,
        route,
        input,
        /[*(]/.test(path) ? skipGroup(path, input, unnamed) : unnamed,
      );
    }
    return 0;
  }

  path = encodeEscapes(path);

  const segments = splitRoute(path);

  // Expand modifiers (:name?, :name+, :name*) into multiple route entries
  const expanded = expandModifiers(segments, input);
  if (expanded) {
    route ??= expandedRouteId(path);
    variants ??= {};
    let count = 0;
    for (const p of expanded) {
      count = _add(ctx, method, p, data, route, input, unnamed);
    }
    return count;
  }

  const star = path.includes("*");
  // A `*` inside a segment: the routes the tree reads it as (see `splitStar`)
  const split = star ? splitStar(segments, input) : undefined;
  if (split) {
    const [routes, join, head] = split;
    if (routes.length > 1) {
      route ??= expandedRouteId(path);
      variants ??= {};
    }
    let count = 0;
    for (const r of routes) {
      count = _insert(
        ctx,
        method,
        r,
        data,
        route,
        input,
        unnamed,
        star,
        r === segments ? -1 : join,
        head,
      );
    }
    return count;
  }
  return _insert(ctx, method, segments, data, route, input, unnamed, star);
}

/**
 * Insert one route (`segments`, after expansion) of `input`, returning how
 * many unnamed captures it has (see `_add`). `star`: it may have a catch-all
 * with segments after it. `join`: the index of the `**` a `*` inside a
 * segment was split around (see `splitStar`), after its first piece where
 * `head` (the pieces are one capture).
 */
function _insert<T>(
  ctx: RouterContext<T>,
  method: string,
  segments: string[],
  data: T | undefined,
  route: string | undefined,
  input: string,
  unnamed: Unnamed,
  star: boolean,
  join = -1,
  head?: boolean,
): number {
  let node = ctx.root;

  let _unnamedParamIndex = 0;

  const paramsMap: ParamsIndexMap = [];
  const paramsRegexp: RegExp[] = [];
  // Literal text and constraints of its regex segments (see `getParamRegexp`)
  let rank = 0;
  // Param names of this expansion: a name declared twice throws
  const names: string[] = [];
  // The key of unnamed capture `n`; a `:name(.*)`'s declares its name once
  // (the pieces of a split `*` share it)
  let named = false;
  const captureKey = (n: number) => {
    const k = unnamed(n);
    if (typeof k === "string" && !named) {
      named = true;
      addName(names, k, input);
    }
    return k;
  };

  // Segments after a `**` (static key, or `1` for a param) are inserted into
  // the wildcard's `suffix` trie last segment first, once the params are read
  let suffix: (string | 1)[] | undefined;
  let wildcardIndex = -1;
  // Nodes on the way to the catch-all, flagged `hasSuffix` for a suffix route
  const trail: Node<T>[] | undefined = star ? [] : undefined;

  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i];
    const key = segmentKey(segment);

    // Wildcard (a catch-all: `**`, `**:name` or a whole-segment `*`)
    if (key === 2) {
      if (suffix) {
        oneCatchAll(input);
      }
      trail?.push(node);
      if (!node.wildcard) {
        node.wildcard = { key: "**" };
      }
      node = node.wildcard;
      // A `*` takes one segment or more (or, last, none: see `matchesZero`),
      // empty ones too (a `**:name` needs a value), and so does the `**` of a
      // split `*` (it may need a segment, see `splitStar`)
      const empty = segment.length === 1 || i === join;
      // A bare `**` is optional; it and a `*` are unnamed captures (`"0"`,
      // `"1"`, ..., numbered with unnamed groups), as in URLPattern. A bare
      // `**`'s value is also reported as `_` (deprecated, see
      // `getMatchParams`), so that name is taken. The `**` of a split `*` is
      // part of its capture: its number (taken by the piece before it, if
      // any), no `_` alias.
      paramsMap.push([
        -(i + 1),
        i === join
          ? String(captureKey(head ? _unnamedParamIndex - 1 : _unnamedParamIndex++))
          : segment.length === 2
            ? (addName(names, "_", input), String(unnamed(_unnamedParamIndex++)))
            : empty
              ? String(captureKey(_unnamedParamIndex++))
              : addName(names, segment.slice(3), input),
        // optional, but not the `**` of a `pre*` ending its segment, before
        // more of the route too (its one segment case is the segment as
        // written, see `splitStar`); before a `*post` piece it may be empty
        segment.length === 2 && !(i === join && segments[i + 1]?.charCodeAt(0) !== 42) /* * */,
        empty,
        undefined,
        i === join,
      ]);
      if (i === segments.length - 1) {
        break;
      }
      suffix = [];
      wildcardIndex = i;
      continue;
    }

    // Param
    if (key === 1) {
      if (suffix) {
        suffix.push(1);
      } else {
        trail?.push(node);
        if (!node.param) {
          node.param = { key: "*" };
        }
        node = node.param;
      }
      if (!/^:[A-Za-z_]\w*$/.test(segment)) {
        // The last piece of a split `*` starts with it: its number
        const tail = i === join + 1 && segment.charCodeAt(0) === 42; /* * */
        const [source, nextIndex, inPlace, segmentRank] = getParamRegexp(
          segment,
          _unnamedParamIndex - (tail ? 1 : 0),
          names,
          input,
          (n) => toUnnamedGroupKey(captureKey(n)),
        );
        _unnamedParamIndex = nextIndex;
        // The same matches without polynomial backtracking (see `linearRegExp`)
        const regexp = (paramsRegexp[i] = linearRegExp(source));
        rank += segmentRank;
        if (!suffix) {
          node.hasRegexParam = true;
        }
        // Captures alone with at most one required `:name` (`*:a`, `:a:b?`,
        // `*:x?`) restrict the segment no more than a `:name` / `*`: they
        // rank from the end like one (`kindAt`)
        paramsMap.push([
          i,
          regexp,
          false,
          /^(?!(?:[\s\S]*:\w+(?![\w?])){2})(?:\*|:[A-Za-z_]\w*)+\??$/.test(segment),
          inPlace,
          tail,
        ]);
      } else {
        paramsMap.push([i, addName(names, segment.slice(1), input), false]);
      }
      continue;
    }

    // Static (a `?` is a literal only escaped: no lookup path has one)
    if (segment.includes("?") && /(^|[^\\])\?/.test(segment)) {
      invalidSyntax(MISPLACED_MODIFIER, input);
    }
    segment = segments[i] = key;
    if (suffix) {
      suffix.push(segment);
      continue;
    }
    trail?.push(node);
    const child = node.static?.[segment];
    if (child) {
      node = child;
    } else {
      const staticNode = { key: segment };
      if (!node.static) {
        node.static = new NullProtoObj();
      }
      node.static![segment] = staticNode;
      node = staticNode;
    }
  }

  if (suffix) {
    for (const n of trail!) {
      n.hasSuffix = true;
    }
    node = node.suffix ??= { key: "" };
    for (let j = suffix.length - 1; j >= 0; j--) {
      const edge = suffix[j];
      if (edge === 1) {
        node = node.param ??= { key: "*" };
      } else {
        node = (node.static ??= new NullProtoObj())[edge] ??= { key: edge };
      }
    }
  }

  // Assign index, params and data to the node
  const hasParams = paramsMap.length > 0;
  const key = "/" + segments.join("/");
  const methods = (node.methods ??= new NullProtoObj());
  (methods[method] ??= []).push({
    data: data ?? (null as T),
    paramsRegexp,
    paramsMap: hasParams ? paramsMap : undefined,
    route: route ?? key,
    suffix: suffix && [wildcardIndex, suffix.length],
    variants,
    // Within half a weight point (`getParamRegexp` ranks a segment by
    // +-2^31 at most)
    rank: rank / 2 ** 32,
  });

  // Static (keyed by the lookup form after its one trailing-slash strip, so
  // root "/" is "" and a stripped "//" -> "/" can't reach it, #209)
  if (!hasParams) {
    ctx.static[segments.length > 0 ? key : ""] = node;
  }
  return _unnamedParamIndex;
}

const same: Unnamed = (index) => index;

/**
 * The `unnamed` numbering of `path` without its first group (a `{…}?`), given
 * `path`'s: unnamed captures are numbered over the whole pattern, as in
 * URLPattern, so the ones in a left-out group use up their numbers (in
 * `/a{/(\d+)}?/**`, the `**` is `1` on `/a/x/y` too). Counted by `_add`
 * itself on the text before the group, with and without it.
 */
export function skipGroup(path: string, input: string, unnamed: Unnamed = same): Unnamed {
  const [pre, body] = scanFirstGroup(path)!;
  // A group without a `*` or `(` holds no unnamed capture (unless it extends
  // a `**`: `**.md` is `**` and `*.md`), so most (`{-:title}?`) skip nothing
  if (!/[*(]/.test(body) && !pre.endsWith("*")) return unnamed;
  const count = (p: string) => _add(createRouter(), "", p, undefined, undefined, input);
  const before = count(pre);
  // Joined like `expandGroupDelimiters` joins them: `/:a{(\d+)}?` holds an
  // unnamed `(\d+)`, not `:a`'s constraint; a relative leading group is
  // read after its `/` (`{(\d+)}?/*`)
  const skip = count(absolutePattern(joinGroup(pre, body, input))) - before;
  return skip ? (index) => unnamed(index < before ? index : index + skip) : unnamed;
}
