import { createRouter } from "../context.ts";
import type { MatchedRoute, MethodData, Node, RouterContext } from "../types.ts";
import { addRoute } from "./add.ts";

/**
 * Whether two route patterns can match a common concrete path (their match-sets
 * intersect). Pure and router-free.
 *
 * Overlap means "there exists a concrete path matched by both patterns" — it is
 * *not* subset containment. Patterns are expanded through rou3's own pipeline,
 * so groups (`{s}?`), optional/repeat modifiers (`:x?`/`:x+`/`:x*`), escaping,
 * and wildcard segment-count rules match `findRoute`/`findAllRoutes` exactly.
 *
 * Segment-count rules: bare `**` matches zero-or-more segments, `**:name` one-
 * or-more, a trailing bare `*` zero-or-one, and mid-pattern `*` / `:name`
 * exactly one.
 *
 * Regex-constrained segments are handled precisely against static literals
 * (`/user/:id(\d+)` vs `/user/42`), but two dynamic segments where at least one
 * is constrained are over-approximated to "overlaps" (the safe conservative
 * default; exact regex intersection is undecidable).
 *
 * @example
 * routesOverlap("/**", "/protected/feed/**"); // true
 * routesOverlap("/a/**", "/b/**"); // false
 * routesOverlap("/a/**", "/a"); // true (`**` matches zero segments)
 */
export function routesOverlap(patternA: string, patternB: string): boolean {
  const a = _routeToShapes(patternA);
  const b = _routeToShapes(patternB);
  for (const x of a) {
    for (const y of b) {
      if (_shapesOverlap(x, y)) return true;
    }
  }
  return false;
}

/**
 * Find every registered route whose match-set intersects the given pattern
 * (scope). Like {@link findAllRoutes}, but the query is a *pattern* instead of a
 * concrete path.
 *
 * Results are ordered least- to most-specific (same traversal order as
 * `findAllRoutes`) and method handling mirrors it (`method`, falling back to the
 * method-agnostic `""` bucket). Overlap semantics are identical to
 * {@link routesOverlap}.
 *
 * Returned matches carry only `data` — a pattern describes a whole scope rather
 * than one concrete path, so no `params` can be resolved. Each matched `data`
 * value is returned at most once (routes with optional syntax expand to several
 * tree entries; duplicates would carry no extra information).
 */
export function findOverlappingRoutes<T>(
  ctx: RouterContext<T>,
  method: string = "",
  pattern: string,
): MatchedRoute<T>[] {
  const query = _routeToShapes(pattern);
  const matches: MatchedRoute<T>[] = [];
  _collectOverlaps(ctx.root, method, query, [], new Set(), matches);
  return matches;
}

/**
 * A canonical (fully expanded) route shape: fixed single-segment matchers
 * (`string` literal | `RegExp` constraint | `undefined` = any) followed by a
 * variable-length tail. The tail (trailing `*`, `**`, `**:name`) matches any
 * segment values, so it only constrains the total number of segments:
 * trailing bare `*` -> `[0, 1]`, `**` -> `[0, Infinity]`,
 * `**:name` -> `[1, Infinity]`, no variable tail -> `[0, 0]`.
 */
interface RouteShape {
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
type Edge = string | 0 | 1;

/**
 * Expand a route pattern into its canonical shapes by inserting it into a
 * throwaway router with the real `addRoute` pipeline (group delimiters, escape
 * encoding, modifiers) and reading the resulting tree entries. Both query
 * patterns and registered routes are therefore classified by the exact same
 * code, so overlap stays consistent with route matching by construction.
 */
function _routeToShapes(pattern: string): RouteShape[] {
  const ctx = createRouter();
  addRoute(ctx, "", pattern);
  const shapes: RouteShape[] = [];
  _collectShapes(ctx.root, [], shapes);
  return shapes;
}

function _collectShapes(node: Node, edges: Edge[], shapes: RouteShape[]): void {
  if (node.methods) {
    for (const entry of node.methods[""] || []) {
      shapes.push(_shapeOf(edges, entry));
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

function _collectOverlaps<T>(
  node: Node<T>,
  method: string,
  query: RouteShape[],
  edges: Edge[],
  seen: Set<T>,
  matches: MatchedRoute<T>[],
): void {
  // Least- to most-specific: wildcard, then param, then static, then self.
  if (node.wildcard) {
    edges.push(1);
    _collectOverlaps(node.wildcard, method, query, edges, seen, matches);
    edges.pop();
  }
  if (node.param) {
    edges.push(0);
    _collectOverlaps(node.param, method, query, edges, seen, matches);
    edges.pop();
  }
  if (node.static) {
    for (const key in node.static) {
      // Static keys are value-constrained: skip subtrees the query can't reach.
      if (_mayMatchAt(query, edges.length, key)) {
        edges.push(key);
        _collectOverlaps(node.static[key], method, query, edges, seen, matches);
        edges.pop();
      }
    }
  }
  if (node.methods) {
    const data = node.methods[method] || node.methods[""];
    if (data) {
      for (const entry of data) {
        if (seen.has(entry.data)) continue;
        const shape = _shapeOf(edges, entry);
        if (query.some((q) => _shapesOverlap(q, shape))) {
          seen.add(entry.data);
          matches.push({ data: entry.data });
        }
      }
    }
  }
}

// A route entry's shape never changes once inserted; cache across queries.
const _shapeCache = new WeakMap<MethodData, RouteShape>();

/**
 * Build the {@link RouteShape} of a registered route entry from its tree
 * position (kind-tagged edges) and its own `paramsMap` classification.
 */
function _shapeOf(edges: Edge[], entry: MethodData): RouteShape {
  let shape = _shapeCache.get(entry);
  if (shape) return shape;
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
  shape = { fixed, tailMin, tailMax };
  _shapeCache.set(entry, shape);
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
function _shapesOverlap(a: RouteShape, b: RouteShape): boolean {
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

/**
 * Whether any query shape can match the static segment `key` at `depth`
 * (either via its fixed matcher there, or via its any-value tail).
 */
function _mayMatchAt(query: RouteShape[], depth: number, key: string): boolean {
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
