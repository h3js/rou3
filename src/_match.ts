import { fromGroupName } from "./_group-names.ts";
import { NullProtoObj } from "./object.ts";
import type { MatchedRoute, MethodData, ParamsIndexMap } from "./types.ts";

// Lookup-time helpers shared by `findRoute`, `findAllRoutes` and the compiler
// (and `splitPath` by `splitRoute`): path normalization and splitting, entry
// order on a node, and params.

/**
 * Whether matching `m` on `segments` gives a `:name` an empty segment, or a
 * `**:name` (`:name+`, `:name*`) an empty one among those it takes: every
 * segment needs a value, as in URLPattern (`[^/]+(?:/[^/]+)*`). A `*` (also a
 * `:name(.*)`, any segment of it), a `**` and a constraint (it decides:
 * `:id(\d*)`) may be empty. Callers check only paths with an empty segment.
 */
export function emptyParam(m: MethodData<unknown>, segments: string[]): boolean {
  const pMap = m.paramsMap;
  const params = pMap && getMatchParams(segments, pMap, m.suffix)!;
  // A `*` (also a `:name(.*)`) is `empty`, a bare `**` is named by a digit
  // and a constraint is a RegExp (`/^…$/`), both `< ":"`. A value holds an
  // empty segment where it is `""`, or starts, ends or holds `//` (a
  // `:name`'s has no `/`).
  return !!pMap?.some(
    ([, name, , empty]) =>
      !empty && (name as string) > ":" && /(^|\/)(\/|$)/.test(params![name as string]),
  );
}

/**
 * Whether entry `m` of a wildcard node (a route ending in its catch-all)
 * matches zero segments there: a bare `**` (`optional`) and a `*` (`empty`,
 * also a `:name(.*)`; not the `**` of a split one), not a `**:name`. A
 * trailing `*` is optional, as in 0.11: `/foo/*` matches `/foo` (no key, see
 * `getMatchParams`) and `/foo/` (`""`).
 */
export function matchesZero(m: MethodData<unknown>): boolean {
  const last = m.paramsMap![m.paramsMap!.length - 1];
  return last[2] || (!!last[3] && !last[5]);
}

export function normalizePath(path: string): string {
  if (!path.includes("/.")) return path;
  const r: string[] = [];
  let s = "";
  for (s of path.split("/")) {
    if (s === ".") continue;
    // r[0] is the leading "" — a ".." at the root is a no-op, never a literal
    else if (s === "..") {
      if (r.length > 1) r.pop();
    } else r.push(s);
  }
  // A last `.` / `..` leaves a trailing slash, as in WHATWG (`/a/b/..` is
  // `/a/`, which a `/a/*` matches)
  if (s === "." || s === "..") r.push("");
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
 * Same-node `entries` in registration order, each run of one route's variants
 * (`variants`, added together) reversed: on a tie, `findRoute` picks the
 * first-registered variant, so `findAllRoutes` lists it last of them (the one
 * it keeps), as the `reverse` order does. The input itself when there is none.
 */
export function reverseVariants<T>(entries: MethodData<T>[]): MethodData<T>[] {
  let out: MethodData<T>[] | undefined;
  for (let i = 0, j; i < entries.length; i = j) {
    const token = entries[i].variants;
    for (j = i + 1; token && entries[j]?.variants === token; j++);
    if (j - i > 1) (out ??= entries.slice()).splice(i, j - i, ...entries.slice(i, j).reverse());
  }
  return out || entries;
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
  slash?: boolean,
): MatchedRoute["params"] {
  const params = new NullProtoObj();
  // Segments after a `**` are counted from the end of the path
  const end = suffix ? segments.length - suffix[1] : segments.length;
  for (const [index, name, optional, , , join] of paramsMap) {
    // A bare `**` (`~index` is where it starts; negative for the other
    // params) over zero segments is unset; a trailing `*` there too, unless
    // the lookup path had a trailing slash (`slash`): `""`
    if (~index >= end && (optional || !slash)) continue;
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
