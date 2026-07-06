import { mayMatchAt, routeToShapes, shapeOf, shapesOverlap } from "../_overlap.ts";
import { shapeSubsumes } from "../_subsume.ts";
import type { Edge, RouteShape } from "../_overlap.ts";
import type { MatchedRoute, Node, RouterContext } from "../types.ts";

/**
 * How the match-sets of two route patterns relate. See {@link compareRoutes}.
 */
export type RouteComparison = "disjoint" | "equal" | "subsumes" | "subsumed" | "partial";

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
  return _anyOverlap(routeToShapes(patternA), routeToShapes(patternB));
}

/**
 * Compare two route patterns by the sets of concrete paths they match. Pure
 * and router-free, like {@link routesOverlap}, but answers containment as well
 * as intersection:
 *
 * - `"disjoint"` — no concrete path matches both (proven).
 * - `"equal"` — both match exactly the same paths (proven; param *names*
 *   don't matter: `/a/:x` equals `/a/:y`, `/u/:id(\d+)` equals `/u/:x(\d+)`).
 * - `"subsumes"` — `patternA` provably matches every path `patternB` matches,
 *   and the reverse could not be proven: a superset, strict unless equality
 *   is undecidable.
 * - `"subsumed"` — the mirror image (`patternA` ⊆ `patternB`).
 * - `"partial"` — neither containment could be proven and the match-sets
 *   *may* intersect.
 *
 * Every verdict's containment claims are proofs; what is *not* guaranteed is
 * exhaustiveness of the undecidable directions, which always degrade toward a
 * weaker verdict, never a wrong claim:
 *
 * - Two regex-constrained segments are only proven equal by source equality
 *   (modulo param names), and a regex only proven to cover a literal via
 *   `test()` — so `/u/:id(\d+)` vs `/u/:id([0-9]+)` reports `"partial"` even
 *   though the sets are equal.
 * - Strictness of `"subsumes"`/`"subsumed"` is best-effort: when a pair is
 *   actually equal but equality is only provable in one direction, the proven
 *   containment is reported — `/u/:id(42)` vs `/u/42` is `"subsumes"`, not
 *   `"equal"`.
 * - `"partial"`'s intersection half is over-approximated (like
 *   {@link routesOverlap}): a `"partial"` pair of disjoint regex constraints,
 *   e.g. `/u/:a(\d+)` vs `/u/:b([a-z]+)`, may in fact share no path.
 * - Containment of one multi-shape pattern (optional groups/modifiers) in
 *   another is proven shape-by-shape, so a subset split across several of the
 *   other pattern's alternatives may also degrade to `"partial"`.
 *
 * Patterns are expanded through rou3's own `addRoute` pipeline (groups,
 * modifiers, escaping), so the verdict is consistent with
 * `findRoute`/`findAllRoutes` by construction — e.g. `/a/:x?` is `"equal"` to
 * `/a/*` (both match `/a` and `/a/seg`).
 *
 * @example
 * compareRoutes("/api/**", "/api/admin/**"); // "subsumes"
 * compareRoutes("/a/:x/c", "/a/b/*"); // "partial" (ambiguous specificity)
 * compareRoutes("/a/**", "/b/**"); // "disjoint"
 */
export function compareRoutes(patternA: string, patternB: string): RouteComparison {
  const a = routeToShapes(patternA);
  const b = routeToShapes(patternB);
  const aCoversB = _covers(a, b);
  const bCoversA = _covers(b, a);
  if (aCoversB && bCoversA) return "equal";
  if (aCoversB) return "subsumes";
  if (bCoversA) return "subsumed";
  return _anyOverlap(a, b) ? "partial" : "disjoint";
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
 * than one concrete path, so no `params` can be resolved. A route registered
 * with optional/group syntax expands into several tree entries that share one
 * `data` reference; those are collapsed to a single match. Distinct routes are
 * always reported separately, even when they carry an equal primitive `data`
 * value (or none — `addRoute` stores `null` when no data is given).
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

// Whether any shape pair overlaps — the single overlap definition shared by
// routesOverlap and compareRoutes (their agreement is pinned by tests).
function _anyOverlap(a: RouteShape[], b: RouteShape[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (shapesOverlap(x, y)) return true;
    }
  }
  return false;
}

// Every shape of `sub` is contained in a single shape of `sup`. Sufficient
// (not necessary) for union containment — a `sub` shape covered only by the
// union of several `sup` shapes is not detected (see compareRoutes docs).
function _covers(sup: RouteShape[], sub: RouteShape[]): boolean {
  return sub.every((s) => sup.some((x) => shapeSubsumes(x, s)));
}

function _collectOverlaps<T>(
  node: Node<T>,
  method: string,
  query: RouteShape[],
  edges: Edge[],
  seen: Set<unknown>,
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
        const d = entry.data;
        // Collapse only genuine reference-duplicates: a route with optional/group
        // syntax (`:x?`, `{/c}?`) expands into several tree entries that share the
        // same `data` reference. Primitive/absent data (`addRoute` stores `null`
        // when none is given) is never deduped, so distinct routes that happen to
        // carry an equal primitive value are all reported instead of dropped.
        const isRef = d !== null && (typeof d === "object" || typeof d === "function");
        if (isRef && seen.has(d)) continue;
        const shape = shapeOf(edges, entry);
        if (query.some((q) => shapesOverlap(q, shape))) {
          if (isRef) seen.add(d);
          matches.push({ data: d });
        }
      }
    }
  }
}
