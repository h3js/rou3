import { fromGroupName } from "../_group-names.ts";
import { hasSegmentWildcard } from "../_segment-wildcards.ts";
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

const ESCAPABLE = ":(){}\\";

/**
 * Where a route-pattern segment goes in the tree, exactly as `addRoute` inserts
 * it: `2` = `node.wildcard`, `1` = `node.param`, otherwise the returned string
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
  if (segment.startsWith("**")) return 2;
  if (
    segment === "*" ||
    segment.includes(":") ||
    segment.includes("(") ||
    hasSegmentWildcard(segment)
  ) {
    return 1;
  }
  if (segment.includes("\\")) segment = segment.replace(/\\([\s\S])/g, "$1");
  if (!segment.includes("\uFFFD")) return segment;
  return decodeEscapes(segment, "");
}

/**
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
  if (!/[\\({}]/.test(route)) return;
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
 * `:name(…)` or in a mixed segment), which covers a raw `?` in plain text and
 * a `**` in the middle of a segment too (one message, bundle size; see README).
 */
export const MISPLACED_MODIFIER =
  "a `?` / `+` / `*` modifier must follow a whole-segment `:name` (escape a literal one with `\\`)";

/**
 * Expand the first `?` / `+` / `*` modifier of a param into the routes it
 * stands for. `+` / `*` repeat a whole-segment `:name` only: `input` (quoted
 * in the error) repeating a constrained param (`:x(\\d+)+`) or part of a
 * segment (`pre-:x+`) dropped the constraint / the rest of the segment.
 */
export function expandModifiers(segments: string[], input?: string): string[] | undefined {
  for (let i = 0; i < segments.length; i++) {
    const last = segments[i].charCodeAt(segments[i].length - 1);
    if (last !== 63 /* ? */ && last !== 43 /* + */ && last !== 42 /* * */) continue;
    const m = segments[i].match(/^(.*:[A-Za-z_]\w*(?:\([^)]*\))?)([?+*])$/);
    if (!m) continue;
    const pre = segments.slice(0, i);
    const suf = segments.slice(i + 1);
    if (m[2] === "?") {
      return ["/" + pre.concat(m[1]).concat(suf).join("/"), "/" + pre.concat(suf).join("/")];
    }
    if (!/^:[A-Za-z_]\w*$/.test(m[1])) {
      invalidSyntax(MISPLACED_MODIFIER, input!);
    }
    const name = m[1].slice(1);
    const wc = "/" + [...pre, `**:${name}`, ...suf].join("/");
    const without = "/" + [...pre, ...suf].join("/");
    return m[2] === "+" ? [wc] : [wc, without];
  }
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
 * and a `**` followed by more of its segment is `**` plus a `*` segment
 * (`/**.md` is `/**\/*.md`: any path ending in a `.md` segment). A `{` or `}`
 * right after the `**` is group syntax, not part of the segment (before group
 * expansion: `/a/**{.md}?` is `/a/**` or `/a/**.md`, never `/a/**\/*`).
 */
export function splitRoute(path: string): string[] {
  const s = splitPath(path);
  while (s[s.length - 1] === "") s.pop();
  if (path.includes("**")) {
    for (let i = 0; i < s.length; i++) {
      if (/^\*\*[^:{}]/.test(s[i])) {
        s.splice(i, 1, "**", s[i].slice(1));
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

export function getMatchParams(
  segments: string[],
  paramsMap: ParamsIndexMap,
  suffix?: [number, number],
): MatchedRoute["params"] {
  const params = new NullProtoObj();
  // Segments after a `**` are counted from the end of the path
  const end = suffix ? segments.length - suffix[1] : segments.length;
  for (const [index, name] of paramsMap) {
    const segment =
      index < 0
        ? segments.slice(-(index + 1), end).join("/")
        : segments[suffix && index > suffix[0] ? index - suffix[0] - 1 + end : index];
    if (typeof name === "string") {
      params[name] = segment;
    } else {
      const match = segment.match(name);
      if (match) {
        for (const key in match.groups) {
          params[fromGroupName(key)] = match.groups[key];
        }
      }
    }
  }
  return params;
}
