import { expandGroupDelimiters } from "../_group-delimiters.ts";
import { toGroupName, toUnnamedGroupKey } from "../_group-names.ts";
import { replaceSegmentWildcards } from "../_segment-wildcards.ts";
import { NullProtoObj } from "../object.ts";
import type { Node, RouterContext, ParamsIndexMap } from "../types.ts";
import {
  checkConstraints,
  decodeEscapes,
  encodeEscapes,
  expandedRouteId,
  expandModifiers,
  invalidSyntax,
  MISPLACED_MODIFIER,
  segmentKey,
  splitRoute,
} from "./_utils.ts";

/**
 * Add a route to the router context.
 *
 * Param names are `[A-Za-z_]\w*`: a `-` ends one (`:test-id` is `:test` and a
 * literal `-id`), as in URLPattern.
 *
 * @throws a `rou3:` error for pattern syntax with no meaning (yet), quoting
 * the pattern: an unclosed `(`, unbalanced or nested `{}`, `{…}+` / `{…}*`,
 * a `?` / `+` / `*` anywhere but after a whole-segment `:name` (`?` also
 * after `:name(regex)` and in a mixed segment), a raw `?` after plain text
 * (`/foo?`), a `**` in the middle of a segment (`/a**b`), an empty or `(?`
 * group, a `:` without a valid name (`/:0`, `/:café`), more after `**:name`
 * in its segment, a repeated param name, more than one `**`, a `\` that
 * escapes no char of its segment (`\/`), and an anchor, look-around,
 * backreference or unnamed group in a constraint (`/:x((a))`; use `(?:…)`).
 */
export function addRoute<T>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  data?: T,
): void {
  method = method.toUpperCase();
  if (path.charCodeAt(0) !== 47 /* '/' */) {
    path = `/${path}`;
  }
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
 * in errors (an expansion is rewritten: `:x+` is `**:x`).
 */
function _add<T>(
  ctx: RouterContext<T>,
  method: string,
  path: string,
  data: T | undefined,
  route?: string,
  input: string = path,
): void {
  const groupExpanded = expandGroupDelimiters(path, input);
  if (groupExpanded) {
    route ??= expandedRouteId(path);
    for (const expandedPath of groupExpanded) {
      _add(ctx, method, expandedPath, data, route, input);
    }
    return;
  }

  path = encodeEscapes(path);

  const segments = splitRoute(path);

  // Expand modifiers (:name?, :name+, :name*) into multiple route entries
  const expanded = expandModifiers(segments, input);
  if (expanded) {
    route ??= expandedRouteId(path);
    for (const p of expanded) {
      _add(ctx, method, p, data, route, input);
    }
    return;
  }

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
  // Nodes on the way to the `**`, flagged `hasSuffix` for a suffix route
  const trail: Node<T>[] | undefined = path.includes("**") ? [] : undefined;

  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i];
    const key = segmentKey(segment);

    // Wildcard
    if (key === 2) {
      if (suffix) {
        throw new Error(
          `rou3: a route can have only one \`**\`, \`:name+\` or \`:name*\` (${input})`,
        );
      }
      trail?.push(node);
      if (!node.wildcard) {
        node.wildcard = { key: "**" };
      }
      node = node.wildcard;
      paramsMap.push([
        -(i + 1),
        addName(names, segment.length === 2 ? "_" : segment.slice(3), input),
        segment.length === 2 /* no id */,
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
      if (segment === "*") {
        // A trailing `*` may match no segment, but not after a `**`
        paramsMap.push([i, String(_unnamedParamIndex++), !suffix /* optional */]);
      } else if (!/^:[A-Za-z_]\w*$/.test(segment)) {
        const [regexp, nextIndex] = getParamRegexp(segment, _unnamedParamIndex, names, input);
        _unnamedParamIndex = nextIndex;
        paramsRegexp[i] = regexp;
        if (!suffix) {
          node.hasRegexParam = true;
        }
        paramsMap.push([i, regexp, false]);
      } else {
        paramsMap.push([i, addName(names, segment.slice(1), input), false]);
      }
      continue;
    }

    // Static (a `?` is a literal only escaped: no lookup path has one)
    if (/(^|[^\\])\?/.test(segment)) {
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
}

/**
 * Record param `name` of an expansion of `input`, throwing on a repeat or on
 * a name that is not `[A-Za-z_]\w*` (`:0`, `:café`, `**:x(\\d+)`, `**:x.json`:
 * a `**:name` ends its segment).
 */
function addName(names: string[], name: string, input: string): string {
  if (names.includes(name) || !/^[A-Za-z_]\w*$/.test(name)) {
    invalidSyntax(`${names.includes(name) ? "duplicate" : "invalid"} param name "${name}"`, input);
  }
  names.push(name);
  return name;
}

/**
 * The regex of a dynamic segment (params, constraints, `*`), after its
 * modifier has been expanded and its escapes encoded (`encodeEscapes`); a `\x`
 * outside a group is a literal `x`. Throws on what has no meaning (yet) there:
 * a `:` without a valid name, an empty group or one starting with `?`, a `?` /
 * `+` / `*` modifier on anything but a whole segment's `:name` (a `?` / `+` was
 * a raw regex quantifier, a `*` right after a name, group or `*` is ambiguous
 * with a modifier or a mid-segment `**`). `routeToRegExp` reuses it (with its own unnamed group keys), so
 * a dynamic segment is the same regex in both.
 */
export function getParamRegexp(
  segment: string,
  unnamedStart: number,
  names: string[],
  input: string,
  groupKey: (index: number) => string = toUnnamedGroupKey,
): [RegExp, number] {
  let _i = unnamedStart;
  // Replace \x escapes outside (...) with a \uFFFE placeholder
  let _s = "",
    _d = 0,
    // Index right after the last `:name`, top-level group or `*`
    _e = -1;
  for (let j = 0; j < segment.length; j++) {
    const c = segment.charCodeAt(j);
    if (_d === 0) {
      if (c === 58 /* : */) {
        // A name is `[A-Za-z_]\w*` (a `-` ends it); a non-ASCII char can't
        // follow it (URLPattern reads it as part of the name)
        _e =
          j + 1 + addName(names, /^[\w\x80-\ufffc]*/.exec(segment.slice(j + 1))![0], input).length;
      } else if (c === 40 /* ( */ && /[?)]/.test(segment[j + 1])) {
        invalidSyntax("empty or `(?` group", input);
      } else if (c === 63 /* ? */ || c === 43 /* + */ || (c === 42 /* * */ && j === _e)) {
        // `?` / `+` here were raw quantifiers; a `*` right after a name or
        // group is ambiguous with a modifier, after a `*` a mid-segment `**`
        invalidSyntax(MISPLACED_MODIFIER, input);
      } else if (c === 42) {
        _e = j + 1;
      }
    } else if (c === 58) {
      // A `:` inside a group (`(?:`) is no param
      _s += "\uFFFE:";
      continue;
    }
    if (c === 40) _d++;
    else if (c === 41 && _d > 0) {
      if (--_d === 0) _e = j + 1;
    } else if (c === 92 && _d === 0 && j + 1 < segment.length) {
      // `\*` stays an escape so it is no wildcard (`\:` `\(` `\\` are encoded)
      const n = segment[++j];
      _s += n === "*" ? "\\*" : "\uFFFE" + n;
      continue;
    }
    // Regex chars outside a (...) group are literals, as in a static segment
    // (`:x.json`, `*$`); inside one they are regex (`:id(\d+\.\d+)`).
    else if (_d === 0 && /[.^$|[\]){}]/.test(segment[j])) {
      _s += "\\" + segment[j];
      continue;
    }
    _s += segment[j];
  }
  [_s, _i] = replaceSegmentWildcards(_s, _i, groupKey);

  const regex = decodeEscapes(
    _s
      // Names were checked and recorded above; a `\uFFFE:` is inside a group
      .replace(
        /(?<!\uFFFE):([A-Za-z_]\w*)(?:\(([^)]*)\))?/g,
        (_, id, p) => `(?<${toGroupName(id)}>${p || "[^/]+"})`,
      )
      .replace(/\((?![?<])/g, () => `(?<${groupKey(_i++)}>`),
    "\uFFFE",
  ).replace(/\uFFFE([\s\S])/g, (_, c) => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c));

  return [new RegExp(`^${regex}$`), _i];
}
