import { mayMatchAt, routeToShapes, shapeOf, shapesOverlap, visitSuffixTrie } from "../_overlap.ts";
import { shapeSubsumes } from "../_subsume.ts";
import type { Edge, RouteShape } from "../_overlap.ts";
import type { MatchedRoute, MethodData, Node, RouterContext } from "../types.ts";

// Matches reported so far, per method bucket (`""`, then the queried method):
// data -> registration identities (`MethodData.route`).
type Seen = [Map<unknown, Set<string>>, Map<unknown, Set<string>>];

/**
 * How the match-sets of two route patterns relate. See {@link compareRoutes}.
 */
export type RouteComparison = "disjoint" | "equal" | "superset" | "subset" | "partial";

/**
 * Whether two route patterns can match a common concrete path (their match-sets
 * intersect). Pure and router-free.
 *
 * Overlap means "there exists a concrete path matched by both patterns" — it is
 * *not* subset containment. Patterns are expanded through rou3's own pipeline,
 * so groups (`{s}?`), optional/repeat modifiers (`:x?`/`:x+`/`:x*`), escaping,
 * and wildcard segment-count rules match `findRoute`/`findAllRoutes` exactly.
 *
 * Segment-count rules: bare `**` matches zero-or-more segments, `*` and
 * `**:name` one-or-more (a trailing `*` none after a trailing slash: `/a/*`
 * and `/a` overlap on `/a/`), and `:name` exactly one.
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
 * - `"superset"` — `patternA` provably matches every path `patternB` matches,
 *   and the reverse could not be proven (strict unless equality is
 *   undecidable).
 * - `"subset"` — the mirror image (`patternA` ⊆ `patternB`).
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
 * - Strictness of `"superset"`/`"subset"` is best-effort: when a pair is
 *   actually equal but equality is only provable in one direction, the proven
 *   containment is reported — `/u/:id(42)` vs `/u/42` is `"superset"`, not
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
 * `findRoute`/`findAllRoutes` by construction — e.g. `/a/:x*` is `"equal"` to
 * `/a{/**:y}?` but a `"subset"` of `/a/**` (only `**` takes the empty segment
 * of `/a//`), and `/a/*` a `"subset"` of `/a/**` (only `**` matches `/a`).
 *
 * @example
 * compareRoutes("/api/**", "/api/admin/**"); // "superset"
 * compareRoutes("/a/:x/c", "/a/b/*"); // "partial" (ambiguous specificity)
 * compareRoutes("/a/**", "/b/**"); // "disjoint"
 */
export function compareRoutes(patternA: string, patternB: string): RouteComparison {
  const a = routeToShapes(patternA);
  const b = routeToShapes(patternB);
  const aCoversB = _covers(a, b);
  const bCoversA = _covers(b, a);
  if (aCoversB && bCoversA) return "equal";
  if (aCoversB) return "superset";
  if (bCoversA) return "subset";
  return _anyOverlap(a, b) ? "partial" : "disjoint";
}

/**
 * Find every registered route whose match-set intersects the given pattern
 * (scope). Like {@link findAllRoutes}, but the query is a *pattern* instead of a
 * concrete path.
 *
 * Results are ordered least- to most-specific (same traversal order as
 * `findAllRoutes`; a route with segments after `**` comes right after the bare
 * `**` it follows, as a scope has no last segment to rank from) and method
 * handling mirrors `findAllRoutes`: routes registered for `method` and
 * method-agnostic (`""`) ones are both reported, the `""` ones first on a
 * shared node. Overlap semantics are identical to {@link routesOverlap}.
 *
 * Returned matches carry only `data` — a pattern describes a whole scope rather
 * than one concrete path, so no `params` can be resolved. A route registered
 * with optional/group syntax expands into several tree entries; those are
 * collapsed to a single match. Distinct routes (a different pattern or
 * method) are always reported separately, even when they share one `data`
 * reference or an equal primitive value (or none — `addRoute` stores `null`
 * when no data is given). A route registered again for the same method with
 * the same data (the same route for `removeRoute`: `/a` and `/a/` included)
 * is reported once.
 */
export function findOverlappingRoutes<T>(
  ctx: RouterContext<T>,
  method: string = "",
  pattern: string,
): MatchedRoute<T>[] {
  const query = routeToShapes(pattern);
  const matches: MatchedRoute<T>[] = [];
  _collectOverlaps(ctx.root, method, query, [], [new Map(), new Map()], matches);
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
  seen: Seen,
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
    _collectEntries(node, method, query, edges, seen, matches);
  }
  // Routes with segments after this `**` (its suffix trie), after the bare one
  if (node.suffix) {
    visitSuffixTrie(node.suffix, [], (trieNode, after) => {
      _collectEntries(trieNode, method, query, edges.concat(after), seen, matches);
    });
  }
}

function _collectEntries<T>(
  node: Node<T>,
  method: string,
  query: RouteShape[],
  edges: Edge[],
  seen: Seen,
  matches: MatchedRoute<T>[],
): void {
  // The node's method-agnostic ("") entries, then the method's own (siblings,
  // as in findAllRoutes). Each bucket is deduped on its own: `GET /a` and
  // `/a` are distinct registrations even with one data reference.
  const methods = node.methods!;
  if (method) _collectBucket(methods[""], query, edges, seen[0], matches);
  _collectBucket(methods[method], query, edges, seen[method ? 1 : 0], matches);
}

function _collectBucket<T>(
  entries: MethodData<T>[] | undefined,
  query: RouteShape[],
  edges: Edge[],
  seen: Map<unknown, Set<string>>,
  matches: MatchedRoute<T>[],
): void {
  if (!entries) return;
  for (const entry of entries) {
    const d = entry.data;
    // One match per registration: a route with optional/group syntax (`:x?`,
    // `{/c}?`) expands into several tree entries stamped with the same
    // registration identity (`entry.route`, what `removeRoute` splices by)
    // and the same data. The identity alone would merge distinct data
    // registered on one route; the data alone, distinct routes sharing it.
    const routes = seen.get(d);
    if (routes?.has(entry.route)) continue;
    const shape = shapeOf(edges, entry);
    if (query.some((q) => shapesOverlap(q, shape))) {
      if (routes) routes.add(entry.route);
      else seen.set(d, new Set([entry.route]));
      matches.push({ data: d });
    }
  }
}
