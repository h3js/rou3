import { createRouter } from "./context.ts";
import { addRoute } from "./operations/add.ts";
import { mergeShapes } from "./_subsume.ts";
import type { MethodData, Node } from "./types.ts";

/**
 * A canonical (fully expanded) route shape: fixed single-segment matchers
 * (`string` literal | `RegExp` constraint | `undefined` = any) followed by a
 * variable-length tail. The tail (trailing `*`, `**`, `**:name`) matches any
 * segment values, so it only constrains the total number of segments:
 * trailing bare `*` -> `[0, 1]`, `**` -> `[0, Infinity]`,
 * `**:name` -> `[1, Infinity]`, no variable tail -> `[0, 0]`.
 */
export interface RouteShape {
  fixed: (string | RegExp | undefined)[];
  tailMin: number;
  tailMax: number;
}

/**
 * A radix-tree edge on the path from the root to a node: a static key (already
 * decoded, so it may be a literal `*`/`**`), or a param (`0`) / wildcard (`1`)
 * branch. Carrying the node kind keeps escaped-literal static keys
 * distinguishable from dynamic segments.
 */
export type Edge = string | 0 | 1;

/**
 * Expand a route pattern into its canonical shapes by inserting it into a
 * throwaway router with the real `addRoute` pipeline (group delimiters, escape
 * encoding, modifiers) and reading the resulting tree entries. Both query
 * patterns and registered routes are therefore classified by the exact same
 * code, so overlap stays consistent with route matching by construction.
 *
 * Results are memoized per pattern string (typical consumers compare N
 * patterns pairwise — N parses instead of N²) and must be treated as
 * immutable by callers.
 */
export function routeToShapes(pattern: string): RouteShape[] {
  let shapes = _patternShapes.get(pattern);
  if (shapes === undefined) {
    const ctx = createRouter();
    addRoute(ctx, "", pattern);
    shapes = [];
    _collectShapes(ctx.root, [], shapes);
    shapes = mergeShapes(shapes);
    // Keep the memo bounded; pattern vocabularies are small in practice, so a
    // full reset on overflow is simpler than recency tracking.
    if (_patternShapes.size >= 1024) _patternShapes.clear();
    _patternShapes.set(pattern, shapes);
  }
  return shapes;
}

/**
 * Build the {@link RouteShape} of a registered route entry from its tree
 * position (kind-tagged edges) and its own `paramsMap` classification.
 *
 * A registered entry is stable once inserted, so its shape is cached across
 * queries. (Query patterns go through {@link routeToShapes}, whose throwaway
 * entries are transient and never benefit from the cache — they call
 * `_computeShape` directly.)
 */
export function shapeOf(edges: Edge[], entry: MethodData): RouteShape {
  let shape = _shapeCache.get(entry);
  if (!shape) _shapeCache.set(entry, (shape = _computeShape(edges, entry)));
  return shape;
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
    if (!_segmentsCanOverlap(a.fixed[k], b.fixed[k])) return false;
  }
  // Total-length ranges must intersect.
  const lo = Math.max(fa + a.tailMin, fb + b.tailMin);
  const hi = Math.min(fa + a.tailMax, fb + b.tailMax);
  return lo <= hi;
}

/**
 * Whether any query shape can match the static segment `key` at `depth`
 * (either via its fixed matcher there, or via its any-value tail).
 */
export function mayMatchAt(query: RouteShape[], depth: number, key: string): boolean {
  for (const q of query) {
    if (depth < q.fixed.length) {
      const m = q.fixed[depth];
      if (m === undefined || (typeof m === "string" ? m === key : m.test(key))) return true;
    } else if (depth - q.fixed.length < q.tailMax) {
      return true;
    }
  }
  return false;
}

// A route entry's shape never changes once inserted; cache across queries.
const _shapeCache = new WeakMap<MethodData, RouteShape>();

// Pattern -> canonical shapes memo for `routeToShapes` (see its doc comment).
const _patternShapes = new Map<string, RouteShape[]>();

function _collectShapes(node: Node, edges: Edge[], shapes: RouteShape[]): void {
  if (node.methods) {
    for (const entry of node.methods[""] || []) {
      shapes.push(_computeShape(edges, entry));
    }
  }
  if (node.static) {
    for (const key in node.static) {
      edges.push(key);
      _collectShapes(node.static[key], edges, shapes);
      edges.pop();
    }
  }
  if (node.param) {
    edges.push(0);
    _collectShapes(node.param, edges, shapes);
    edges.pop();
  }
  if (node.wildcard) {
    edges.push(1);
    _collectShapes(node.wildcard, edges, shapes);
    edges.pop();
  }
}

function _computeShape(edges: Edge[], entry: MethodData): RouteShape {
  const fixed: RouteShape["fixed"] = [];
  let tailMin = 0;
  let tailMax = 0;
  const pMap = entry.paramsMap;
  for (let d = 0; d < edges.length; d++) {
    const edge = edges[d];
    if (typeof edge === "string") {
      fixed.push(edge);
    } else if (edge === 1) {
      // Wildcard is always terminal and its paramsMap entry is always last
      // (`**` is optional, `**:name` requires one segment).
      tailMin = pMap![pMap!.length - 1][2] ? 0 : 1;
      tailMax = Number.POSITIVE_INFINITY;
    } else if (pMap) {
      // Param: classified by this entry's paramsMap entry at this segment index.
      const p = pMap.find((e) => e[0] === d)!;
      if (p[1] instanceof RegExp) {
        fixed.push(p[1]);
      } else if (p[2] /* bare `*` */ && d === edges.length - 1) {
        // A trailing bare `*` matches zero-or-one segment; elsewhere exactly one.
        tailMax = 1;
      } else {
        fixed.push(undefined);
      }
    }
  }
  // Canonical form: trailing any-value matchers are equivalent to tail
  // positions (both match exactly one arbitrary segment), so fold them into
  // the tail. This is what lets `/a/:x` compare equal to shapes reached
  // through the tail model (e.g. the `/a/:x?` <-> `/a/*` equivalence).
  let f = fixed.length;
  while (f > 0 && fixed[f - 1] === undefined) f--;
  if (f < fixed.length) {
    tailMin += fixed.length - f;
    tailMax += fixed.length - f;
    fixed.length = f;
  }
  return { fixed, tailMin, tailMax };
}

/**
 * Whether two single-segment matchers (`string` static | `RegExp` | `undefined`
 * any) can match a common value.
 *
 * `static`/`static` and `static`/`regex` are decided precisely. Any comparison
 * involving `any`, and every `regex`/`regex` pair, is over-approximated to
 * `true` (the conservative "may overlap" default — regex intersection is
 * undecidable in general).
 */
function _segmentsCanOverlap(
  x: string | RegExp | undefined,
  y: string | RegExp | undefined,
): boolean {
  if (typeof x === "string") {
    return typeof y === "string" ? x === y : y instanceof RegExp ? y.test(x) : true;
  }
  if (x instanceof RegExp && typeof y === "string") return x.test(y);
  return true;
}
