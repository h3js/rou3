import { fromGroupName } from "../_group-names.ts";
import { NullProtoObj } from "../object.ts";
import type { MatchedRoute, ParamsIndexMap } from "../types.ts";

export function encodeEscapes(path: string): string {
  if (!path.includes("\\")) return path;
  return path.replace(/\\([:(){}])/g, (_, c) => "\uFFFD" + "ABCDE"[":(){}".indexOf(c)]);
}

export function decodeEscaped(segment: string): string {
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
    else if (s === ".." && r.length > 1) r.pop();
    else r.push(s);
  }
  return r.join("/") || "/";
}

export function splitPath(path: string): string[] {
  const s = path.split("/");
  s.shift();
  if (s[s.length - 1] === "") s.pop();
  return s;
}

/** Like `splitPath`, for route patterns: `/a//` and `/a/` canonicalize to `/a`. */
export function splitRoute(path: string): string[] {
  const s = splitPath(path);
  while (s[s.length - 1] === "") s.pop();
  return s;
}

export function getMatchParams(
  segments: string[],
  paramsMap: ParamsIndexMap,
): MatchedRoute["params"] {
  const params = new NullProtoObj();
  for (const [index, name] of paramsMap) {
    const segment = index < 0 ? segments.slice(-(index + 1)).join("/") : segments[index];
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
