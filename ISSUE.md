# What h3-rules needs from rou3

Context: [h3-rules](https://github.com/h3js/h3-rules) (private in /workspace/github/h3js/h3-rules/) matches route-rule patterns with
`findAllRoutes` / compiled `matchAll` and merges all matched layers least → most specific.
It now ships an optional `preMerge` optimization that resolves each pattern's subsumption
chain at build time so per-request resolution takes only the most specific matched layer.
Building this surfaced one compiled/runtime divergence and three API gaps that h3-rules
currently papers over with re-implementations of rou3 internals. In priority order:

## 1. Bug: compiled `matchAll` diverges from `findAllRoutes` on method fallback

When a node has both a method-scoped and a method-agnostic registration, runtime resolves
`methods[m] || methods[""]` — one layer. The compiled output emits **both**:

```js
import { createRouter, addRoute, findAllRoutes } from "rou3";
import { compileRouter } from "rou3/compiler";

const r = createRouter();
addRoute(r, "", "/api/**", "AGN");
addRoute(r, "GET", "/api/**", "GET-DATA");

findAllRoutes(r, "GET", "/api/x").map((m) => m.data);
// runtime:  ["GET-DATA"]
compileRouter(r, { matchAll: true })("GET", "/api/x").map((m) => m.data);
// compiled: ["GET-DATA", "AGN"]   (generated: r.unshift($agn); if (m==="GET") r.unshift($get))
```

The duplicate layer is not benign for merge-style consumers: whichever layer merges later
re-overrides the other's values. In h3-rules this silently reverted method-scoped rule
overrides in compiled mode only (`GET /api/** → { x-b: "get" }` lost to the agnostic
`{ x-b: "all" }`). Worse, the emission order of the pair follows **registration order**, so
the winner flips depending on rule declaration order.

**Ask:** compiled `matchAll` should produce the same layer list as `findAllRoutes` — emit
the agnostic push behind an `else` (or method-miss guard) instead of unconditionally.

h3-rules workaround (would love to delete): deterministic registration order + skipping an
adjacent same-route layer whose entries carry no method
([`resolveLayers`](src/merge.ts)).

## 2. Feature: expose a subsumption relation between patterns

`routesOverlap(a, b)` answers "can any path match both?" — pre-merge additionally needs
"does `a` match a **superset** of what `b` matches?" to (a) order chains and (b) reject
partially-overlapping rule sets (`/a/*/c` vs `/a/b/*`) where "most specific match" is
ambiguous.

h3-rules re-implements rou3's shape model for this
([`parseRouteShape` / `subsumesRoute`](src/premerge.ts)):
fixed segments + `tailMin`/`tailMax`, plain `**` matching zero segments, `**:name`
requiring one, trailing `*` spanning two depths. That duplication will drift the moment
pattern semantics evolve, and it has to bail out (throw) on anything it cannot model —
today: regex params — where rou3 itself could answer precisely.

**Ask:** export either

```ts
routeSubsumes(patternA: string, patternB: string): boolean;
// or richer, one call per pair:
compareRoutes(a: string, b: string): "disjoint" | "equal" | "subsumes" | "subsumed" | "partial";
```

built on the same internal shape machinery as `routesOverlap`, including regex-param
segments (`RegExp` source equality / trivially-decidable cases are enough; returning
`"partial"` when undecidable is fine — callers treat it as ambiguous).

## 3. Guarantee: document `findAllRoutes` / compiled `matchAll` result ordering

Merge-style consumers depend on layer order. h3-rules assumes, and its whole `preMerge`
take-last strategy relies on:

- results are ordered **least → most specific** (broader/wilder/shallower nodes first);
- for patterns strictly ordered by subsumption, traversal order agrees with subsumption
  order (this holds today: wildcard node → param node → static node per level, and
  `pushSorted` puts optional/lighter entries first within a node);
- runtime and compiled ordering are identical.

Today this is observable behavior, not contract. **Ask:** document it (README + a pinned
test in rou3), so downstream take-last / fold logic isn't broken by an internal traversal
change. If ordering is ever intentionally changed, a `matchAll` option to request
specificity order would do.

## 4. Nice-to-have: matched pattern (+ method) on `MatchedRoute`

`findAllRoutes` / compiled `matchAll` / `findOverlappingRoutes` return `{ data, params }`
with no way to tell **which registered pattern** produced a layer. h3-rules needs the
pattern per layer (params attribution across pre-merged chains) and works around it by
wrapping every registration's data in `{ route, method, rules }`.

**Ask:** opt-in flag to include the registered route (and method) on results:

```ts
findAllRoutes(r, m, p, { routes: true }); // → { data, params, route, method? }[]
```

Opt-in keeps the compiled output size unchanged for consumers that don't need it.

## 5. Future / sketch: merge-aware compilation

With 1–4 in place, h3-rules' remaining cold-path cost is the compiled tree walk itself
(~535 ns of a ~870 ns request in our benchmark; the merge is already precomputed). The
endgame would be a compiler mode for fold-style consumers: the caller provides the fold at
compile time (or per-match-set data is precomputed, like h3-rules' `preMerge`), and the
generated function returns a single precomputed result per distinct match-set instead of a
layer array — i.e. enumerate the decision-tree outcomes rather than collecting layers at
runtime. Only rou3 can do this exactly (partial overlaps multiply match-sets; only the
compiler sees the full tree). No concrete ask yet — flagging where the ceiling is.

---

**Versions:** observed against rou3 `0.9.0` (h3-rules pins `^0.9.0`).
**Repros/tests:** h3-rules pins all of the above behavior in
`test/compiler.test.ts` ("duplicate agnostic layer"), `test/premerge.test.ts`
(parity grids, `subsumesRoute` suite), and `src/premerge.ts` (shape model duplication).
