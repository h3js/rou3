import { mayMatchAt, routeToShapes, shapeOf, shapesOverlap } from "../_overlap.ts";
import type { Edge, RouteShape } from "../_overlap.ts";
import type { MatchedRoute, Node, RouterContext } from "../types.ts";

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
  const a = routeToShapes(patternA);
  const b = routeToShapes(patternB);
  for (const x of a) {
    for (const y of b) {
      if (shapesOverlap(x, y)) return true;
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
  const query = routeToShapes(pattern);
  const matches: MatchedRoute<T>[] = [];
  _collectOverlaps(ctx.root, method, query, [], new Set(), matches);
  return matches;
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
      if (mayMatchAt(query, edges.length, key)) {
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
        const shape = shapeOf(edges, entry);
        if (query.some((q) => shapesOverlap(q, shape))) {
          seen.add(entry.data);
          matches.push({ data: entry.data });
        }
      }
    }
  }
}
