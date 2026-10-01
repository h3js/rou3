import { fromGroupName } from "../_group-names.ts";
import { segmentWildcards } from "../_segment-wildcards.ts";
import { NullProtoObj } from "../object.ts";
import type { MatchedRoute, MethodData, ParamsIndexMap } from "../types.ts";

/**
 * Hide escaped route syntax (`\:` `\(` `\)` `\{` `\}` `\\`) behind U+FFFD +
 * its index in `ESCAPABLE` before splitting, so no later scan reads it as
 * syntax. `\\` is one of them, so escape pairs are read left to right (`\\:x`
 * is a `\` then `:x`). Other `\x` stay: static keys (`segmentKey`) and param
 * segments (`getParamRegexp`) read them as a literal `x`.
 */
export function encodeEscapes(path: string): string {
  if (!path.includes("\\")) return path;
  return path.replace(/\\([:(){}\\])/g, (_, c) => "\uFFFD" + ESCAPABLE.indexOf(c));
}

/** Undo `encodeEscapes`: each placeholder back to its char, after `prefix`. */
export function decodeEscapes(segment: string, prefix: string): string {
  return segment.replace(/\uFFFD([0-5])/g, (_, i) => prefix + ESCAPABLE[i]);
}

// `getParamRegexp` reads placeholders 3 / 4 as `{` / `}`
const ESCAPABLE = ":(){}\\";

/**
 * Where a route-pattern segment goes in the tree, exactly as `addRoute` inserts
 * it: `2` = `node.wildcard` (a catch-all: `**`, `**:name` or a whole-segment
 * `*`), `1` = `node.param`, otherwise the returned string
 * is the `node.static` key, where any `\x` is a literal `x` (an escaped `\*` /
 * `\*\*` is the literal `*` / `**`: the escape is what keeps it out of the
 * wildcard/param branches) and `\uFFFD` placeholders decode back to `:(){}\`.
 *
 * Shared by `addRoute` and `removeRoute`: the two must classify *and* key
 * segments identically, otherwise removal walks to a different — usually
 * nonexistent — node and silently does nothing.
 *
 * Segments after a `**` go into the wildcard node's `suffix` trie instead of
 * its children (see `_add`).
 */
export function segmentKey(segment: string): string | 1 | 2 {
  if (segment === "*" || segment.startsWith("**")) return 2;
  if (segment.includes(":") || segment.includes("(") || segmentWildcards(segment).length > 0) {
    return 1;
  }
  if (segment.includes("\\")) segment = segment.replace(/\\([\s\S])/g, "$1");
  if (segment.includes("\uFFFD")) segment = decodeEscapes(segment, "");
  return encodeLiteral(segment);
}

/**
 * Percent-encode literal pattern text like URLPattern canonicalizes a
 * pathname pattern, so a route matches the encoded pathname `new URL()`
 * gives (lookup paths are never decoded): the URL path percent-encode set
 * (C0 controls, space, `"#<>?^\`{}`, U+007F and up) as UTF-8 `%XX`, a lone
 * surrogate as U+FFFD. A `%` stays, so an existing `%XX` is kept as written.
 * Only for text already read as literal (static keys, `getParamRegexp`): an
 * escape or a `:name` must be parsed first. U+FFFD-U+FFFF are left alone:
 * internal placeholders or reserved (`checkConstraints` rejects them in a
 * route).
 */
export function encodeLiteral(text: string): string {
  // A `test` bails early on plain text (a no-match `replace` costs more)
  return /[\0- "#<>?^`{}\x7F-\uFFFC]/.test(text)
    ? text.replace(/[\0- "#<>?^`{}\x7F-\uFFFC]+/g, (run) =>
        encodeURIComponent(run.replace(/[\uD800-\uDFFF]/gu, "\uFFFD")),
      )
    : text;
}

/**
 * Throws on U+FFFD-U+FFFF: internal placeholders (`encodeEscapes`, `\uFFFE` in
 * `getParamRegexp`; U+FFFF is kept free for the next one), which a route
 * could otherwise write as syntax (`\uFFFD0` read as an escaped `:`).
 *
 * Throws when a `(...)` group in `route` never closes (`/files/(2024`, #199)
 * or contains a `/` (`:id([^/]+)`): the pattern is split on `/` before groups
 * are read, which cut it in two. Either way `new RegExp` threw a raw
 * `SyntaxError` naming internal group names. Also throws on a `{` / `}` that
 * does not pair up or a nested `{...}` (literals or mis-parsed before), on a
 * `\` that escapes no char of its segment (a `\/` or a trailing `\`), and on
 * a `^` / `$` / look-around in a group: the tree tests a segment on its own,
 * where they see its ends, and `routeToRegExp` inline, where they see the rest
 * of the path (#227), and on a capturing group inside a group (a stray
 * numbered or named param; only `(?:…)` is fine). Called by `addRoute` (and
 * so by `routeToRegExp`). A stray `)` stays a literal.
 *
 * Escapes are dropped first (`\(` is no group; `\/` stays, the split cuts
 * there too), then balanced `/`-free groups innermost-out (a capturing one
 * leaves a `\0`, like a backreference, in the group around it), so any `(` left does not close in its own segment, and any `\` left
 * escapes nothing. Braces inside a group are regex.
 */
export function checkConstraints(route: string): void {
  if (!/[\\({}\uFFFD-\uFFFF]/.test(route)) return;
  if (/[\uFFFD-\uFFFF]/.test(route)) {
    invalidSyntax("a U+FFFD-U+FFFF char", route);
  }
  // `\1`-`\9` -> `\0` (a backreference), any other escape -> `_` (a literal,
  // so `\(?=` is no look-ahead)
  let s = route.replace(/\\([^/])/g, (_, c) => (c > "0" && c <= "9" ? "\0" : "_"));
  while (
    s !==
    (s = s.replace(/\([^()/]*\)/g, (group) => {
      if (/[$^\0]|^\(\?<?[=!]/.test(group.replace(/\[[^\]]*\]/g, ""))) {
        invalidSyntax(
          "an anchor, look-around, backreference or capturing group in a constraint",
          route,
        );
      }
      // Only a `(?:…)` may sit inside a constraint (a look-around threw above)
      return group[1] === "?" && group[2] !== "<" ? "" : "\0";
    }))
  );
  if (s.includes("(")) {
    throw new Error(
      `rou3: a \`(\` must close in its own segment, escape a literal one as \`\\(\` (${route})`,
    );
  }
  if (s.includes("\\")) {
    invalidSyntax("a `\\` must escape a char of its segment", route);
  }
  if (/[{}]/.test(s.replace(/\{[^{}]*\}/g, ""))) {
    invalidSyntax("unbalanced or nested `{}`", route);
  }
}

/**
 * Throws a `rou3:` error for pattern syntax with no meaning (yet), quoting the
 * route as written.
 */
export function invalidSyntax(what: string, route: string): never {
  throw new Error(`rou3: ${what} (${route})`);
}

/**
 * `?` / `+` / `*` anywhere but after a whole-segment `:name` (a `?` also after
 * `:name(…)` or in a mixed segment; none after `**:name`), which covers a raw
 * `?` in plain text and a `**` in the middle of a segment too (one message,
 * bundle size; see README).
 */
export const MISPLACED_MODIFIER =
  "misplaced `?` / `+` / `*`: `?` follows `:name` or `:name(…)`, `+` / `*` a whole-segment `:name`, not `**:name`; escape a literal one with `\\`";

/**
 * A segment ending in a param's modifier: the text before the param, the
 * `:name` / `:name(…)`, the modifier.
 */
export const PARAM_MODIFIER: RegExp = /^(.*)(:[A-Za-z_]\w*(?:\([^)]*\))?)([?+*])$/;

/**
 * Expand the first `?` / `+` / `*` modifier of a param into the routes it
 * stands for. A `?` on a param that does not start its segment makes only the
 * param optional (`pre-:x?` is `pre-:x` or `pre-`, as in URLPattern;
 * `{pre-:x}?` drops the segment). After a capture (`*-:x?`, `:a(\\d+):b?`)
 * it stays for `getParamRegexp`, which compiles it in place: one regex, so a
 * greedy capture takes what it can first, as in URLPattern (the two routes
 * would let the one with the param win). `+` / `*` repeat a whole-segment
 * `:name` only: `input` (quoted in the error) repeating a constrained param
 * (`:x(\\d+)+`) or part of a segment (`pre-:x+`) throws: it would drop the
 * constraint / the rest of the segment.
 * A `?` on a `**:name` throws too (the `**` is no text before the param).
 */
export function expandModifiers(segments: string[], input?: string): string[] | undefined {
  for (let i = 0; i < segments.length; i++) {
    const last = segments[i].charCodeAt(segments[i].length - 1);
    if (last !== 63 /* ? */ && last !== 43 /* + */ && last !== 42 /* * */) continue;
    const m = segments[i].match(PARAM_MODIFIER);
    if (!m) continue;
    const pre = segments.slice(0, i);
    const suf = segments.slice(i + 1);
    // Without the param: the text before it in its segment, or no segment
    const without = "/" + pre.concat(m[1] || [], suf).join("/");
    // A `**` before it is no text: `**:name?` throws like `**:name+`
    if (m[3] === "?" && m[1] !== "**") {
      // After a capture, `getParamRegexp` compiles it in place (`*-:x?`)
      if (typeof segmentKey(m[1]) !== "string") continue;
      return ["/" + pre.concat(m[1] + m[2], suf).join("/"), without];
    }
    if (m[1] || m[2].includes("(")) {
      invalidSyntax(MISPLACED_MODIFIER, input!);
    }
    // `:name+` and `:name*` are `**:name` (a value, see `emptyParam`); `:name*`
    // also matches without the segment
    const wc = "/" + pre.concat("**" + m[2], suf).join("/");
    return m[3] === "+" ? [wc] : [wc, without];
  }
}

/**
 * A `*` inside a segment is a catch-all too, as in URLPattern (`/*.png` on
 * `/a/b.png` is `a/b`): the rest of its segment, any segments after it and
 * the start of a later one. The tree reads it as the segment-local `*`
 * (`[^/]*`, see `getParamRegexp`) before or after a `**` that `join`s their
 * captures (see `getMatchParams`): `pre*post` is `pre*`, `**`, `*post` (the
 * capture spans segments) and the segment as is (it doesn't), `*post` is
 * `**`, `*post`, and `pre*` is `pre*`, `**`. Returns those routes' segments,
 * the index of the `**` and whether a `pre*` segment is before it (its `*`
 * starts the capture), or `undefined` without such a `*`. Throws for a second
 * one (one catch-all per route).
 */
export function splitStar(
  segments: string[],
  input: string,
): [routes: string[][], join: number, head: boolean] | undefined {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const at = segment.startsWith("**") || segment === "*" ? [] : segmentWildcards(segment);
    if (at.length === 0) continue;
    for (let j = i + 1; j < segments.length && at.length === 1; j++) {
      if (!segments[j].startsWith("**") && segments[j] !== "*") {
        at.push(...segmentWildcards(segments[j]));
      }
    }
    if (at.length > 1) {
      // A `**` inside a segment (`a**b`) has no meaning yet
      if (at.some((x, k) => at[k + 1] === x + 1)) invalidSyntax(MISPLACED_MODIFIER, input);
      oneCatchAll(input);
    }
    const pre = segments.slice(0, i);
    const post = segments.slice(i + 1);
    const head = segment.slice(0, at[0]);
    const tail = segment.slice(at[0] + 1);
    if (!head) return [[pre.concat("**", segment, post)], i, false];
    if (!tail) return [[pre.concat(segment, "**", post)], i + 1, true];
    return [[pre.concat(head + "*", "**", "*" + tail, post), segments], i + 1, true];
  }
}

/** Throws for a route with more than one catch-all, quoting it as written. */
export function oneCatchAll(input: string): never {
  throw new Error(
    `rou3: a route can have only one \`*\`, \`**\`, \`:name+\` or \`:name*\` (${input})`,
  );
}

/**
 * Whether matching `m` on `segments` gives a `:name` an empty segment, or a
 * `**:name` (`:name+`, `:name*`) an empty value: those need one, as in
 * URLPattern. A `*`, a `**` and a constraint (it decides: `:id(\d*)`) may be
 * empty. Callers check only paths with an empty segment.
 */
export function emptyParam(m: MethodData<unknown>, segments: string[]): boolean {
  const pMap = m.paramsMap;
  const params = pMap && getMatchParams(segments, pMap, m.suffix)!;
  // A `*` is named by a digit and a constraint is a RegExp (`/^…$/`), both
  // `< ":"`; a `**` is `optional`
  return !!pMap?.some(
    ([, name, optional]) => !optional && (name as string) > ":" && params![name as string] === "",
  );
}

/**
 * Whether entry `m` of a wildcard node matches zero segments there: a bare
 * `**` always, a `*` (named by a digit, a `**:name` by a letter or `_`) only
 * after the lookup path's trailing slash (`slash`): `/foo/*` matches `/foo/`
 * with `""`, but not `/foo`, as in URLPattern.
 */
export function matchesZero(m: MethodData<unknown>, slash?: boolean): boolean {
  const last = m.paramsMap![m.paramsMap!.length - 1];
  return last[2] || (!!slash && (last[1] as string) < ":");
}

export function normalizePath(path: string): string {
  if (!path.includes("/.")) return path;
  const r: string[] = [];
  for (const s of path.split("/")) {
    if (s === ".") continue;
    // r[0] is the leading "" — a ".." at the root is a no-op, never a literal
    else if (s === "..") {
      if (r.length > 1) r.pop();
    } else r.push(s);
  }
  return r.join("/") || "/";
}

/**
 * Split a lookup path (already stripped of its one ignored trailing `/`) into
 * segments. Empty segments are kept: `/a/` is `["a", ""]` (#209).
 */
export function splitPath(path: string): string[] {
  const s = path.split("/");
  s.shift();
  return s;
}

/**
 * Like `splitPath`, for route patterns: `/a//` and `/a/` canonicalize to `/a`,
 * and a `**` followed by more of its segment reads like a `*` there, as in
 * URLPattern (`/**.md` is `/*.md`: any path ending in `.md`, one capture; a
 * third `*` is a second catch-all, `/***` is `/**\/*`). A `{` or `}` right
 * after the `**` is group syntax, not part of the segment (before group
 * expansion: `/a/**{.md}?` is `/a/**` or `/a/**.md`).
 */
export function splitRoute(path: string): string[] {
  const s = splitPath(path);
  while (s[s.length - 1] === "") s.pop();
  if (path.includes("**")) {
    for (let i = 0; i < s.length; i++) {
      if (/^\*\*[^:{}]/.test(s[i])) {
        s.splice(i, 1, ...(s[i][2] === "*" ? ["**", s[i].slice(2)] : [s[i].slice(1)]));
      }
    }
  }
  return s;
}

/**
 * Registration identity of a pattern that expands (groups, `?`/`+`/`*`
 * modifiers), shared by `addRoute` and `removeRoute`: its pre-expansion text
 * with trailing empties dropped and static segments keyed like the tree, so
 * spellings the tree cannot tell apart (`/a/:x?/` vs `/a/:x?`, `\)` vs `)`)
 * share one identity.
 */
export function expandedRouteId(path: string): string {
  return (
    "/" +
    splitRoute(encodeEscapes(path))
      .map((segment) => {
        const key = segmentKey(segment);
        return typeof key === "string" ? key : segment;
      })
      .join("/")
  );
}

/**
 * A node's entries for `method`, least -> most specific on equal weight: the
 * method-agnostic (`""`) ones, then the method's own. Both are siblings on the
 * node (a method-scoped entry must never hide a `""` one), and callers order
 * them by weight with a stable sort. `reverse` flips each bucket (same-node
 * ties go to the first-registered in findRoute).
 */
export function methodEntries<T>(
  methods: Record<string, MethodData<T>[] | undefined>,
  method: string,
  reverse?: boolean,
): MethodData<T>[] | undefined {
  let own = methods[method];
  let any = method ? methods[""] : undefined;
  if (reverse) {
    own &&= own.slice().reverse();
    any &&= any.slice().reverse();
  }
  return own && any ? any.concat(own) : own || any;
}

/**
 * A `*` inside a segment is split around a `**` (see `splitStar`): the pieces
 * after its first one (`join`) add theirs after a `/`.
 */
function setParam(
  params: Record<string, string>,
  key: string,
  value: string,
  join?: boolean,
): void {
  params[key] = join && params[key] !== undefined ? params[key] + "/" + value : value;
}

export function getMatchParams(
  segments: string[],
  paramsMap: ParamsIndexMap,
  suffix?: [number, number],
): MatchedRoute["params"] {
  const params = new NullProtoObj();
  // Segments after a `**` are counted from the end of the path
  const end = suffix ? segments.length - suffix[1] : segments.length;
  for (const [index, name, optional, , join] of paramsMap) {
    // A bare `**` (`~index` is where it starts; negative for the other
    // params) over zero segments is unset; a `*` there (after a trailing
    // slash) is `""`
    if (optional && ~index >= end) continue;
    const segment =
      index < 0
        ? segments.slice(~index, end).join("/")
        : segments[suffix && index > suffix[0] ? index - suffix[0] - 1 + end : index];
    if (typeof name === "string") {
      setParam(params, name, segment, join);
      // A bare `**` is also `_` (deprecated alias, 0.x compatibility)
      if (index < 0 && optional && !join) params._ = segment;
    } else {
      const match = segment.match(name);
      if (match) {
        for (const key in match.groups) {
          // An absent optional (`*-:x?`) has no key
          if (match.groups[key] !== undefined) {
            setParam(params, fromGroupName(key), match.groups[key], join);
          }
        }
      }
    }
  }
  return params;
}
