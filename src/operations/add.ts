import { expandGroupDelimiters, joinGroup, scanFirstGroup } from "../_group-delimiters.ts";
import { toGroupName, toUnnamedGroupKey } from "../_group-names.ts";
import { createRouter } from "../context.ts";
import { NullProtoObj } from "../object.ts";
import type { Node, RouterContext, ParamsIndexMap } from "../types.ts";
import {
  absolutePattern,
  checkConstraints,
  decodeEscapes,
  encodeEscapes,
  encodeLiteral,
  expandedRouteId,
  expandModifiers,
  invalidSyntax,
  MISPLACED_MODIFIER,
  oneCatchAll,
  PARAM_MODIFIER,
  segmentKey,
  splitRoute,
  splitStar,
} from "./_utils.ts";

/**
 * Add a route to the router context.
 *
 * Param names are `[A-Za-z_]\w*`: a `-` ends one (`:test-id` is `:test` and a
 * literal `-id`), and so does a group's `{` / `}` (`/:a{b}?` is `:a` and an
 * optional `b`; `/{:a}(\\d+)` is `:a` and an unnamed `(\\d+)`, not its
 * constraint), as in URLPattern. Also as there, a `:name` sharing its
 * segment takes as little as it can (`/:a-:b` on `/x-y-z` is `x` and `y-z`),
 * and a `?` on one after text makes only the param optional (`/pre-:x?`
 * matches `/pre-` and `/pre-a`; `/{pre-:x}?` drops the segment). After a
 * capture the segment is one regex, so a greedy capture takes what it can
 * (`/*-:x?` on `/--` is `{ 0: "-" }`, `/:a(\\d+):b?` on `/12` `{ a: "12" }`).
 *
 * A pattern without a leading `/` gets one (`foo/:id`). One starting with a
 * group gets it per expansion (`absolutePattern`): `{/:a}?/b` is absolute, as
 * in URLPattern (`/:a/b` or `/b`), while `{a}?/b` is `/a/b` or `/b`. Text
 * right after a leading `{/…}?` throws (`{/a}?b`: without the group the route
 * would be relative).
 *
 * @throws a `rou3:` error for pattern syntax with no meaning (yet), quoting
 * the pattern: an unclosed `(`, unbalanced or nested `{}`, `{…}+` / `{…}*`,
 * a `?` / `+` / `*` anywhere but after a whole-segment `:name` (`?` also
 * after `:name(regex)` and in a mixed segment; never after a group's `{` /
 * `}`: `/{:a}{*}`, `/{:a}?*`), a raw `?` after plain text
 * (`/foo?`), a `**` in the middle of a segment (`/a**b`), an empty or `(?`
 * group, a `:` without a valid name (`/:0`, `/:café`, `/:id$`), more after `**:name`
 * in its segment, a repeated param name, more than one `**`, a `\` that
 * escapes no char of its segment (`\/`), an anchor, look-around,
 * backreference or capturing group in a constraint (`/:x((a))`; use `(?:…)`),
 * and a U+FFFD-U+FFFF char (internal placeholders).
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
  _add(ctx, method, path, data);
}

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
    if (groupExpanded[1] !== undefined) route ??= expandedRouteId(path);
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
    if (routes.length > 1) route ??= expandedRouteId(path);
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
  // Param names of this expansion: a name declared twice throws
  const names: string[] = [];

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
      // A `*` takes one segment or more (or, last, none after a trailing
      // slash: see `matchesZero`), empty ones too (a `**:name` needs a value)
      const empty = segment.length === 1;
      // A bare `**` is optional; it and a `*` are unnamed captures (`"0"`,
      // `"1"`, ..., numbered with unnamed groups), as in URLPattern. A bare
      // `**`'s value is also reported as `_` (deprecated, see
      // `getMatchParams`), so that name is taken. The `**` of a split `*` is
      // part of its capture: its number (taken by the piece before it, if
      // any), no `_` alias.
      paramsMap.push([
        -(i + 1),
        i === join
          ? String(unnamed(head ? _unnamedParamIndex - 1 : _unnamedParamIndex++))
          : segment.length === 2
            ? (addName(names, "_", input), String(unnamed(_unnamedParamIndex++)))
            : empty
              ? String(unnamed(_unnamedParamIndex++))
              : addName(names, segment.slice(3), input),
        // optional, but not the `**` of a `pre*` ending its segment (its one
        // segment case is the segment as written, see `splitStar`)
        segment.length === 2 && !(i === join && i === segments.length - 1),
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
        const [regexp, nextIndex, inPlace] = getParamRegexp(
          segment,
          _unnamedParamIndex - (tail ? 1 : 0),
          names,
          input,
          (n) => toUnnamedGroupKey(unnamed(n)),
        );
        _unnamedParamIndex = nextIndex;
        paramsRegexp[i] = regexp;
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
  });

  // Static (keyed by the lookup form after its one trailing-slash strip, so
  // root "/" is "" and a stripped "//" -> "/" can't reach it, #209)
  if (!hasParams) {
    ctx.static[segments.length > 0 ? key : ""] = node;
  }
  return _unnamedParamIndex;
}

/** Maps the index of an unnamed capture in a route to its key in a pattern. */
export type Unnamed = (index: number) => number;

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

/**
 * Record param `name` of an expansion of `input`, throwing on a repeat or on
 * a name that is not `[A-Za-z_]\w*` (`:0`, `:café`, `**:x(\\d+)`, `**:x.json`:
 * a `**:name` ends its segment). A `**:name` runs to its segment's end, so
 * the quoted name drops the `\` a group put before a name char outside a
 * constraint (`**:x{s}?` names `xs`) and decodes `encodeEscapes`' placeholders
 * (`**:x\:y` names `x\:y`).
 */
function addName(names: string[], name: string, input: string): string {
  if (names.includes(name) || !/^[A-Za-z_]\w*$/.test(name)) {
    invalidSyntax(
      `${names.includes(name) ? "duplicate" : "invalid"} param name "${decodeEscapes(name.replace(/\\(?=[\w$\x80-\ufffc])(?![^(]*\))/g, ""), "\\")}"`,
      input,
    );
  }
  names.push(name);
  return name;
}

/**
 * The regex of a dynamic segment (params, constraints, `*`), after its
 * modifier has been expanded and its escapes encoded (`encodeEscapes`); a `\x`
 * outside a group is a literal `x`. Throws on what has no meaning (yet) there:
 * a `:` without a valid name, an empty group or one starting with `?`, a `?` /
 * `+` / `*` modifier on anything but a whole segment's `:name` (a `?` / `+` would
 * be a raw regex quantifier, a `*` right after a name or group is ambiguous with
 * a modifier) and a mid-segment `**`. `routeToRegExp` reuses it (with its own
 * unnamed group keys), so a dynamic segment is the same regex in both.
 *
 * A `:name` here shares its segment, so it takes as little as possible
 * (`[^/]+?`, as in URLPattern: `:a-:b` on `x-y-z` is `x` and `y-z`); a `*`
 * stays greedy (URLPattern's `*` is a greedy `(.*)`). A `?` ending the
 * segment after a `:name` / `:name(…)` makes it optional in place
 * (`(?:(?<x>…))?`, unset when absent; `expandModifiers` leaves it here after
 * a capture), so the captures split the segment like URLPattern's regex. Its
 * name is the third element of the result.
 */
export function getParamRegexp(
  segment: string,
  unnamedStart: number,
  names: string[],
  input: string,
  groupKey: (index: number) => string = toUnnamedGroupKey,
): [RegExp, number, string?] {
  let _i = unnamedStart;
  // The in-place optional param's name
  let _o: string | undefined;
  // Replace \x escapes outside (...) with a \uFFFE placeholder
  let _s = "",
    _d = 0,
    // Index right after the last `:name`, top-level group or `*`
    _e = -1;
  for (let j = 0; j < segment.length; j++) {
    const c = segment.charCodeAt(j);
    if (_d === 0) {
      if (c === 58 /* : */) {
        // A name is `[A-Za-z_]\w*` (a `-` ends it); a `$` or non-ASCII char
        // can't follow it (part of the name in URLPattern: `:id$` is `id$`)
        _e =
          j + 1 + addName(names, /^[\w$\x80-\ufffc]*/.exec(segment.slice(j + 1))![0], input).length;
      } else if (c === 40 /* ( */ && /[?)]/.test(segment[j + 1])) {
        invalidSyntax("empty or `(?` group", input);
      } else if (c === 63 /* ? */ || c === 43 /* + */ || (c === 42 /* * */ && j === _e)) {
        // A `?` ending the segment after a `:name` / `:name(…)` makes it
        // optional: kept raw for the name replace below (literal text is
        // percent-encoded, it would be `%3F`)
        if (c === 63 && j === segment.length - 1 && PARAM_MODIFIER.test(segment)) {
          _s += "?";
          continue;
        }
        // Otherwise `?` / `+` here would be raw quantifiers; a `*` right after
        // a name or group is ambiguous with a modifier, after a `*` a
        // mid-segment `**` (an escaped `\*` is consumed below and never sets
        // `_e`)
        invalidSyntax(MISPLACED_MODIFIER, input);
      } else if (c === 42) {
        // A `*` here is the part of a catch-all in this segment (see
        // `splitStar`), an unnamed group numbered with the others
        _e = j + 1;
        _s += "([^/]*)";
        continue;
      }
    } else if (c === 58) {
      // A `:` inside a group (`(?:`) is no param
      _s += "\uFFFE:";
      continue;
    }
    if (c === 40) _d++;
    else if (c === 41 && _d > 0) {
      if (--_d === 0) _e = j + 1;
    } else if (_d === 0 && c === 0xfffd && /[34]/.test(segment[j + 1])) {
      // `encodeEscapes`' placeholders 3 and 4, an escaped `{` / `}`, are text;
      // the others (`\:` `\(` `\)` `\\`) stay hidden until params and groups
      // are named (`encodeLiteral` leaves U+FFFD alone)
      _s += encodeLiteral("{}"[+segment[++j] - 3]);
      continue;
    } else if (_d === 0 && /[\0- "#$).<>?[-^`{-}\x7F-\uFFFC]/.test(segment[j])) {
      // Outside a (...) group, a `\x` is a literal `x` (U+FFFE-marked; `\*`
      // stays an escape so it is no wildcard), and so are regex chars, as in
      // a static segment (`:x.json`, `*$`; inside a group they are regex:
      // `:id(\d+\.\d+)`). Literal text is percent-encoded like URLPattern
      // (`encodeLiteral`, a surrogate pair at once; `%XX` is no syntax).
      const esc = c === 92 && j + 1 < segment.length ? 1 : 0;
      const ch = segment.slice(j + esc, j + esc + (segment.codePointAt(j + esc)! > 0xffff ? 2 : 1));
      const encoded = encodeLiteral(ch);
      j += esc + ch.length - 1;
      _s += encoded !== ch ? encoded : esc && ch !== "*" ? "\uFFFE" + ch : "\\" + ch;
      continue;
    }
    _s += segment[j];
  }
  const regex = decodeEscapes(
    _s
      // Names were checked and recorded above; a `\uFFFE:` is inside a group.
      // `[^\x2f]+?` before a group is the `:name` `joinGroup` constrained,
      // emitted as `[^/]+?` (alone it stays as written).
      .replace(/(?<!\uFFFE):([A-Za-z_]\w*)(?:\(([^)]*)\))?(\?$)?/g, (m, id, p, o, i, s) => {
        const group = `(?<${toGroupName(id)}>${p && p + s[i + m.length] != "[^\\x2f]+?(" ? p : "[^/]+?"})`;
        return o ? ((_o = id), `(?:${group})?`) : group;
      })
      .replace(/\((?![?<])/g, () => `(?<${groupKey(_i++)}>`),
    "\uFFFE",
  ).replace(/\uFFFE([\s\S])/g, (_, c) => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c));

  return [new RegExp(`^${regex}$`), _i, _o];
}
