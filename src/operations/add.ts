import { expandGroupDelimiters } from "../_group-delimiters.ts";
import { toGroupName, toUnnamedGroupKey } from "../_group-names.ts";
import { replaceSegmentWildcards } from "../_segment-wildcards.ts";
import { NullProtoObj } from "../object.ts";
import type { Node, RouterContext, ParamsIndexMap } from "../types.ts";
import {
  checkConstraints,
  decodeEscapes,
  encodeEscapes,
  encodeLiteral,
  expandedRouteId,
  expandModifiers,
  invalidSyntax,
  MISPLACED_MODIFIER,
  PARAM_MODIFIER,
  segmentKey,
  splitRoute,
} from "./_utils.ts";

/**
 * Add a route to the router context.
 *
 * Param names are `[A-Za-z_]\w*`: a `-` ends one (`:test-id` is `:test` and a
 * literal `-id`), and so does a group's `{` / `}` (`/:a{b}?` is `:a` and an
 * optional `b`), as in URLPattern. Also as there, a `:name` sharing its
 * segment takes as little as it can (`/:a-:b` on `/x-y-z` is `x` and `y-z`),
 * and a `?` on one after text makes only the param optional (`/pre-:x?`
 * matches `/pre-` and `/pre-a`; `/{pre-:x}?` drops the segment). After a
 * capture the segment is one regex, so a greedy capture takes what it can
 * (`/*-:x?` on `/--` is `{ 0: "-" }`, `/:a(\\d+):b?` on `/12` `{ a: "12" }`).
 *
 * @throws a `rou3:` error for pattern syntax with no meaning (yet), quoting
 * the pattern: an unclosed `(`, unbalanced or nested `{}`, `{…}+` / `{…}*`,
 * a `?` / `+` / `*` anywhere but after a whole-segment `:name` (`?` also
 * after `:name(regex)` and in a mixed segment), a raw `?` after plain text
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
 * a capture), so the captures split the segment like URLPattern's regex.
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
  [_s, _i] = replaceSegmentWildcards(_s, _i, groupKey);

  const regex = decodeEscapes(
    _s
      // Names were checked and recorded above; a `\uFFFE:` is inside a group
      .replace(/(?<!\uFFFE):([A-Za-z_]\w*)(?:\(([^)]*)\))?(\?$)?/g, (_, id, p, o) => {
        const group = `(?<${toGroupName(id)}>${p || "[^/]+?"})`;
        return o ? `(?:${group})?` : group;
      })
      .replace(/\((?![?<])/g, () => `(?<${groupKey(_i++)}>`),
    "\uFFFE",
  ).replace(/\uFFFE([\s\S])/g, (_, c) => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c));

  return [new RegExp(`^${regex}$`), _i];
}
