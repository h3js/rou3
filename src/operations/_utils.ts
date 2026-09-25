import { fromGroupName } from "../_group-names.ts";
import { hasSegmentWildcard } from "../_segment-wildcards.ts";
import { NullProtoObj } from "../object.ts";
import type { MatchedRoute, ParamsIndexMap } from "../types.ts";

export function encodeEscapes(path: string): string {
  if (!path.includes("\\")) return path;
  return path.replace(/\\([:(){}])/g, (_, c) => "\uFFFD" + "ABCDE"[":(){}".indexOf(c)]);
}

/**
 * Where a route-pattern segment goes in the tree, exactly as `addRoute` inserts
 * it: `2` = `node.wildcard`, `1` = `node.param`, otherwise the returned string
 * is the `node.static` key — an escaped `\*` / `\*\*` is the literal `*` / `**`
 * (the escape is what keeps it out of the wildcard/param branches), and
 * `\uFFFD` placeholders decode back to `:(){}`.
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
  if (segment === "\\*") return "*";
  if (segment === "\\*\\*") return "**";
  if (!segment.includes("\uFFFD")) return segment;
  return segment.replace(/\uFFFD([A-E])/g, (_, c) =>
    // eslint-disable-next-line unicorn/no-nested-ternary
    c === "A" ? ":" : c === "B" ? "(" : c === "C" ? ")" : c === "D" ? "{" : "}",
  );
}

export function expandModifiers(segments: string[]): string[] | undefined {
  for (let i = 0; i < segments.length; i++) {
    const last = segments[i].charCodeAt(segments[i].length - 1);
    if (last !== 63 /* ? */ && last !== 43 /* + */ && last !== 42 /* * */) continue;
    const m = segments[i].match(/^(.*:[\w-]+(?:\([^)]*\))?)([?+*])$/);
    if (!m) continue;
    const pre = segments.slice(0, i);
    const suf = segments.slice(i + 1);
    if (m[2] === "?") {
      return ["/" + pre.concat(m[1]).concat(suf).join("/"), "/" + pre.concat(suf).join("/")];
    }
    const name = m[1].match(/:([\w-]+)/)?.[1] || "_";
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
 * (`/**.md` is `/**\/*.md`: any path ending in a `.md` segment).
 */
export function splitRoute(path: string): string[] {
  const s = splitPath(path);
  while (s[s.length - 1] === "") s.pop();
  if (path.includes("**")) {
    for (let i = 0; i < s.length; i++) {
      if (s[i].length > 2 && s[i].startsWith("**") && s[i].charCodeAt(2) !== 58 /* : */) {
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
