import { expandGroupDelimiters } from "./_group-delimiters.ts";
import { hasSegmentWildcard } from "./_segment-wildcards.ts";
import { getParamRegexp } from "./operations/add.ts";
import { decodeEscaped, encodeEscapes, expandModifiers, splitPath } from "./operations/_utils.ts";
import type { MethodData } from "./types.ts";

/**
 * A single-segment matcher (consumes exactly one path segment).
 *
 * - `0` static: matches only the literal `v`.
 * - `1` any: matches any single segment (`*` mid-pattern, `:name`).
 * - `2` regex: matches a single segment satisfying `re` (`:id(\d+)`, `*.png`, groups).
 */
export type SegmentMatcher =
  | { readonly t: 0; readonly v: string }
  | { readonly t: 1 }
  | { readonly t: 2; readonly re: RegExp };

/**
 * A canonical (fully expanded) route shape: a list of fixed single-segment
 * matchers followed by an optional variable-length tail.
 *
 * The tail (trailing `*`, `**`, `**:name`) matches any segment values, so it
 * only constrains the total number of segments — never their contents.
 *
 * - trailing bare `*`  -> tail `[0, 1]`
 * - trailing `**`      -> tail `[0, Infinity]`
 * - trailing `**:name` -> tail `[1, Infinity]`
 * - no variable tail   -> `[0, 0]`
 */
export interface RouteShape {
  readonly fixed: SegmentMatcher[];
  readonly tailMin: number;
  readonly tailMax: number;
}

/**
 * Expand a raw route pattern into one or more canonical {@link RouteShape}s,
 * reusing rou3's own normalization pipeline so overlap stays consistent with
 * `addRoute`/`findRoute`:
 *
 * 1. `{...}` / `{...}?` group delimiters -> multiple paths
 * 2. escape encoding + segment splitting
 * 3. `:x?` / `:x+` / `:x*` modifiers -> multiple paths
 *
 * A pattern with optional/group syntax therefore yields several shapes; two
 * patterns overlap when *any* pair of their shapes overlaps.
 */
export function routeToShapes(path: string): RouteShape[] {
  if (path.charCodeAt(0) !== 47 /* '/' */) {
    path = `/${path}`;
  }
  const groupExpanded = expandGroupDelimiters(path);
  if (groupExpanded) {
    return groupExpanded.flatMap((p) => routeToShapes(p));
  }
  const segments = splitPath(encodeEscapes(path));
  const expanded = expandModifiers(segments);
  if (expanded) {
    return expanded.flatMap((p) => routeToShapes(p));
  }
  return [segmentsToShape(segments)];
}

function segmentsToShape(segments: string[]): RouteShape {
  const fixed: SegmentMatcher[] = [];
  let tailMin = 0;
  let tailMax = 0;
  let unnamedIndex = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    // Wildcard (`**` / `**:name`) — always terminal, mirrors add.ts `break`.
    if (seg.startsWith("**")) {
      tailMin = seg.length === 2 /* bare `**` */ ? 0 : 1;
      tailMax = Number.POSITIVE_INFINITY;
      break;
    }

    // Param / dynamic single-segment.
    if (seg === "*") {
      // A trailing bare `*` matches zero-or-one segment; elsewhere exactly one.
      if (isLast) {
        tailMin = 0;
        tailMax = 1;
      } else {
        fixed.push({ t: 1 });
      }
      continue;
    }
    if (seg.includes(":") || seg.includes("(") || hasSegmentWildcard(seg)) {
      if (/^:[\w-]+$/.test(seg)) {
        fixed.push({ t: 1 });
      } else {
        const [re, next] = getParamRegexp(seg, unnamedIndex);
        unnamedIndex = next;
        fixed.push({ t: 2, re });
      }
      continue;
    }

    // Static (decode escapes / literal `\*`, `\*\*`).
    let s = seg;
    if (s === "\\*") s = "*";
    else if (s === "\\*\\*") s = "**";
    fixed.push({ t: 0, v: decodeEscaped(s) });
  }

  return { fixed, tailMin, tailMax };
}

/**
 * Rebuild a {@link RouteShape} straight from a matched radix-tree branch
 * (accumulated node keys + a route's {@link MethodData}). Used by
 * `findOverlappingRoutes` so registered routes are classified identically to
 * how they were inserted.
 */
export function methodDataToShape(keys: string[], data: MethodData): RouteShape {
  const byIndex = new Map<number, { name: string | RegExp; optional: boolean }>();
  let wildcardOptional = true;
  if (data.paramsMap) {
    for (const [index, name, optional] of data.paramsMap) {
      if (index < 0) {
        wildcardOptional = optional;
      } else {
        byIndex.set(index, { name, optional });
      }
    }
  }

  const fixed: SegmentMatcher[] = [];
  let tailMin = 0;
  let tailMax = 0;

  for (let d = 0; d < keys.length; d++) {
    const key = keys[d];
    const isLast = d === keys.length - 1;

    if (key === "**") {
      tailMin = wildcardOptional ? 0 : 1;
      tailMax = Number.POSITIVE_INFINITY;
      break;
    }

    if (key === "*") {
      const entry = byIndex.get(d);
      if (entry?.name instanceof RegExp) {
        fixed.push({ t: 2, re: entry.name });
      } else if (entry?.optional && isLast) {
        // A trailing bare `*` is optional (zero-or-one segment).
        tailMin = 0;
        tailMax = 1;
      } else {
        fixed.push({ t: 1 });
      }
      continue;
    }

    fixed.push({ t: 0, v: key });
  }

  return { fixed, tailMin, tailMax };
}

/**
 * Whether two canonical shapes share at least one concrete path.
 *
 * Value constraints only exist where both shapes have a *fixed* matcher at the
 * same position; tails match any value. Since any valid common length is at
 * least `max(fixedA, fixedB)`, every shared fixed position is always in range,
 * so the value check is independent of the chosen length.
 */
export function shapesOverlap(a: RouteShape, b: RouteShape): boolean {
  const fa = a.fixed.length;
  const fb = b.fixed.length;
  const common = fa < fb ? fa : fb;
  for (let k = 0; k < common; k++) {
    if (!segmentsCanOverlap(a.fixed[k], b.fixed[k])) return false;
  }
  // Total-length ranges must intersect.
  const lo = Math.max(fa + a.tailMin, fb + b.tailMin);
  const hi = Math.min(fa + a.tailMax, fb + b.tailMax);
  return lo <= hi;
}

/**
 * Whether two single-segment matchers can match a common value.
 *
 * `static`/`static` and `static`/`regex` are decided precisely. Any comparison
 * involving `any`, and every `regex`/`regex` pair, is over-approximated to
 * `true` (the conservative "may overlap" default — regex intersection is
 * undecidable in general).
 */
function segmentsCanOverlap(x: SegmentMatcher, y: SegmentMatcher): boolean {
  if (x.t === 0 && y.t === 0) return x.v === y.v;
  if (x.t === 0 && y.t === 2) return y.re.test(x.v);
  if (x.t === 2 && y.t === 0) return x.re.test(y.v);
  return true;
}
