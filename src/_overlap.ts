import { createRouter } from "./context.ts";
import { addRoute } from "./operations/add.ts";
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
 */
export function routeToShapes(pattern: string): RouteShape[] {
  const ctx = createRouter();
  addRoute(ctx, "", pattern);
  const shapes: RouteShape[] = [];
  _collectShapes(ctx.root, [], shapes);
  return _mergeShapes(shapes);
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
 * Whether shape `a` certainly matches a superset of the paths shape `b`
 * matches (subset containment of match-sets, `a` ⊇ `b`).
 *
 * Sound but not complete: `true` is a proof, `false` means "not provable"
 * rather than "certainly not a superset". Containment between two regex
 * constraints is only decided by source equality, and a regex is only proven
 * to cover a static literal via an anchored `test()` (regex intersection is
 * undecidable in general).
 */
export function shapeSubsumes(a: RouteShape, b: RouteShape): boolean {
  const fa = a.fixed.length;
  const fb = b.fixed.length;
  // `b`'s total-length range must sit inside `a`'s.
  if (fa + a.tailMin > fb + b.tailMin || fa + a.tailMax < fb + b.tailMax) {
    return false;
  }
  const common = fa < fb ? fa : fb;
  for (let k = 0; k < common; k++) {
    if (!_segmentSubsumes(a.fixed[k], b.fixed[k])) return false;
  }
  // Positions covered by `b`'s any-value tail but fixed in `a` must be
  // unconstrained. (Length containment already guarantees every `b` path is
  // long enough to reach all of `a`'s fixed positions.)
  for (let k = fb; k < fa; k++) {
    if (a.fixed[k] !== undefined) return false;
  }
  return true;
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
 * Collapse shapes that differ only in tail length into one shape per fixed
 * prefix (union of contiguous total-length ranges). An optional-syntax pattern
 * expands into several entries (`/a/:x?` -> `/a` + `/a/:x`) whose canonical
 * shapes are `["a"] [0,0]` and `["a"] [1,1]`; merging yields `["a"] [0,1]` —
 * the same shape as `/a/*` — so containment checks see through the expansion.
 */
function _mergeShapes(shapes: RouteShape[]): RouteShape[] {
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      // Ranges must be equal fixed-wise and union into one contiguous range.
      if (
        _sameFixed(a.fixed, b.fixed) &&
        a.tailMin <= b.tailMax + 1 &&
        b.tailMin <= a.tailMax + 1
      ) {
        a.tailMin = Math.min(a.tailMin, b.tailMin);
        a.tailMax = Math.max(a.tailMax, b.tailMax);
        shapes.splice(j, 1);
        j = i; // Restart: the widened range may absorb earlier-skipped shapes.
      }
    }
  }
  return shapes;
}

function _sameFixed(a: RouteShape["fixed"], b: RouteShape["fixed"]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    if (!_segmentSubsumes(a[k], b[k]) || !_segmentSubsumes(b[k], a[k])) return false;
  }
  return true;
}

/**
 * Whether single-segment matcher `x` certainly matches every value `y`
 * matches. `any` covers everything; literals must be equal; an (anchored)
 * regex provably covers a literal it tests true on, and another regex only
 * when their sources are identical.
 */
function _segmentSubsumes(x: string | RegExp | undefined, y: string | RegExp | undefined): boolean {
  if (x === undefined) return true;
  if (typeof x === "string") return x === y;
  if (typeof y === "string") return x.test(y);
  return y instanceof RegExp && x.source === y.source && x.flags === y.flags;
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
