# rou3

Lightweight, high-performance HTTP router for JS/TS: a segment trie (one node per path segment, no prefix compression) plus a map of static paths. Zero runtime dependencies. Entry points: `rou3` (`src/index.ts`) and `rou3/compiler` (`src/compiler.ts`).

> [!IMPORTANT]
> Keep `AGENTS.md` and `.agents/*.md` updated when behavior or contracts change. Document current rules and why they hold, not history.

## Docs

Read the relevant doc before changing that area:

- [`.agents/matching.md`](.agents/matching.md): tree, lookup, same-node siblings, `""` method entries, `findAllRoutes` ordering, segments after `**`, removal, empty segments.
- [`.agents/syntax.md`](.agents/syntax.md): pattern pipeline, escapes, `{}` groups, reserved syntax, param/capture-group names.
- [`.agents/compiler.md`](.agents/compiler.md): `compileRouter` / `compileRouterToString` contract and codegen invariants.
- [`.agents/regexp.md`](.agents/regexp.md): `routeToRegExp` (regex ≡ router) and `regExpToRoute`.
- [`.agents/overlap.md`](.agents/overlap.md): `routesOverlap` / `compareRoutes` / `findOverlappingRoutes` and `routeNodeKeys`.
- [`.agents/testing.md`](.agents/testing.md): suites, fixture conventions, sweeps, cross-engine and Node 22 checks.

## Core invariants

- Interpreter (`findRoute` / `findAllRoutes`) and compiled matchers (JIT and AOT) return identical results; tests compare them.
- `findAllRoutes` order (least → most specific) is a public contract (README "Result ordering").
- `routeToRegExp(p)` matches exactly the paths `findRoute` matches on a router holding only `p` (consumers use it as a security guard).
- Never write a second pattern parser: derived APIs (`routeToRegExp` validation, overlap, `routeNodeKeys`) run the real `addRoute` on a throwaway router.
- Lookup ignores at most one trailing slash; middle empty segments are meaningful.
- Optional features (overlap, regexp, `routeNodeKeys`, `regExpToRoute`) must stay tree-shakeable; `test/bench/bundle.test.ts` budgets the core bundle.
- `addRoute` preprocessing helpers bail early when their trigger char is absent; keep those guards.
- Every thrown error starts with `rou3:`; pattern errors (via `invalidSyntax()`) are `rou3: <what> (<route as written>)`.

## Code conventions

- Performance-first: `charCodeAt()` over `.startsWith()`, plain `for` loops, null-prototype objects (`NullProtoObj`), `.concat()` over spread.
- Hot-path var names: `m` (method), `p` (path), `s` (segments), `l` (length).
- Internal files are prefixed `_`; internal helpers go at the end of the file; keep modules under ~200 LoC.
- ESM only, explicit `.ts` import extensions, `with { type: "json" }` for JSON; import from specific modules, not barrels.
- Multi-arg functions take an options object as the second parameter.

## Bug fix workflow (regression-first)

1. Write the regression test reproducing the bug.
2. Run it and confirm it **fails** (never skip).
3. Make the minimal fix.
4. Confirm the test passes, then run the broader suite.

## Git

- Semantic, lower-case commits with scope (`fix(compiler): ...`), short description on the second line.
- If not on `main`, `git push` after committing. Use `gh` for GitHub.
