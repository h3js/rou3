import { mayMatchAt, routeToShapes, shapeOf, shapesOverlap, visitSuffixTrie } from "../_overlap.ts";
import { shapeSubsumes } from "../_subsume.ts";
import type { Edge, RouteShape } from "../_overlap.ts";
import type { MatchedRoute, MethodData, Node, RouterContext } from "../types.ts";
import { routeId } from "./_utils.ts";

// Matches reported so far, per method bucket (`""`, then the queried method):
// data -> registration identities (`MethodData.route`).
type Seen = [Map<unknown, Set<string>>, Map<unknown, Set<string>>];

/**
 * How the match-sets of two route patterns relate. See {@link compareRoutes}.
 */
export type RouteComparison = "disjoint" | "equal" | "superset" | "subset" | "partial";

/**
 * Whether at least one path matches both patterns.
 *
 * Patterns are read the same way `addRoute` reads them, so the answer agrees
 * with `findRoute`. Two dynamic segments where at least one has a regex
 * constraint are assumed to overlap (`/u/:id(\d+)` and `/u/:s([a-z]+)` give
 * `true`), so `true` can be a false positive, but `false` is always exact.
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
 * Compare the sets of paths two patterns match. Reads as "`patternA` is … of
 * `patternB`":
 *
 * - `"equal"`: both match the same paths (param names don't matter).
 * - `"superset"`: `patternA` matches every path `patternB` matches, and more.
 * - `"subset"`: `patternB` matches every path `patternA` matches, and more.
 * - `"disjoint"`: no path matches both.
 * - `"partial"`: none of the above could be proven. The patterns may share
 *   some paths.
 *
 * Every other verdict is proven. When something can't be decided, the answer
 * is a weaker verdict, never a wrong one: two different regex constraints
 * compare as `"partial"` even when they are equivalent (`/u/:id(\d+)` and
 * `/u/:id([0-9]+)`), and an equal pair that is provable in one direction only
 * is a `"superset"` or `"subset"` (`/u/:id(42)` and `/u/42`).
 *
 * Patterns are read the same way `addRoute` reads them, so the answer agrees
 * with `findRoute`: `/a/*` is `"equal"` to `/a/**`, and `/a/:x*` is a
 * `"subset"` of `/a/**` (only `**` takes the empty segment of `/a//`).
 *
 * @example
 * compareRoutes("/api/**", "/api/admin/**"); // "superset"
 * compareRoutes("/a/:x/c", "/a/b/*"); // "partial"
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
 * Find every registered route that can match a path `pattern` matches. Like
 * {@link findAllRoutes}, but takes a pattern instead of a path.
 *
 * Results are in the same least to most specific order, with the same method
 * handling, and follow the overlap rules of {@link routesOverlap}. A route with
 * segments after a `**` comes right after the bare `**` it follows.
 *
 * Matches only have `data` (there is no single path to read params from). A
 * route added with optional syntax, or added again with the same data, is
 * reported once. Different routes (another pattern or method) are always
 * reported separately, even when they share the same `data`.
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
    // (canonical: `/café-:id` is `/caf%C3%A9-:id`, see `routeId`)
    const routes = seen.get(d);
    const id = routeId(entry.route);
    if (routes?.has(id)) continue;
    const shape = shapeOf(edges, entry);
    if (query.some((q) => shapesOverlap(q, shape))) {
      if (routes) routes.add(id);
      else seen.set(d, new Set([id]));
      matches.push({ data: d });
    }
  }
}
