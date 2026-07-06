# rou3

Lightweight, high-performance JavaScript/TypeScript HTTP router. Zero runtime dependencies.

> [!IMPORTANT]
> Keep `AGENTS.md` updated with project status.

## Project Structure

```
src/
  index.ts            # Public API re-exports
  types.ts            # TypeScript interfaces & param inference types
  context.ts          # createRouter() factory
  object.ts           # NullProtoObj (null-prototype object constructor)
  _escape.ts          # URLPattern backslash escape handling (placeholder approach)
  _group-delimiters.ts# Non-capturing group ({...}) expansion helper
  _segment-wildcards.ts# Wildcard segment capture handling
  _overlap.ts         # Pattern-overlap shape model (tree entry -> RouteShape, shape intersection)
  regexp.ts           # routeToRegExp() utility
  regexp-to-route.ts  # regExpToRoute() utility (inverse of routeToRegExp)
  compiler.ts         # JIT/AOT compiler (generates optimized match functions)
  operations/
    add.ts            # addRoute() - insert routes into the radix tree
    find.ts           # findRoute() - single-match lookup
    find-all.ts       # findAllRoutes() - multi-match lookup
    overlap.ts        # routesOverlap() / compareRoutes() / findOverlappingRoutes() - pattern-vs-pattern relations
    remove.ts         # removeRoute() - remove routes from tree
    _utils.ts         # Shared utilities (escaping, path splitting, normalization)
test/
  router.test.ts      # Core router tests
  find.test.ts        # Route matching tests (interpreter vs compiled)
  find-all.test.ts    # Multi-match tests
  overlap.test.ts     # Pattern-overlap tests (routesOverlap / compareRoutes / findOverlappingRoutes)
  regexp.test.ts      # RegExp conversion tests
  regexp.pcre.test.ts # Cross-engine PCRE checks (runs routeToRegExp output through installed grep -P/rg -P/pcre2grep/perl/php)
  _regexp-cases.ts    # Shared route->regex fixtures (used by regexp.test.ts + regexp.pcre.test.ts)
  types.test-d.ts     # TypeScript type-level tests
  bench/              # Performance benchmarks (mitata)
  _utils.ts           # Test helpers (createRouter, formatTree)
```

## Public API

Two entry points: `rou3` (main) and `rou3/compiler`.

```ts
// rou3
createRouter<T>(options?) -> RouterContext<T>
addRoute(ctx, method, path, data?) -> void
removeRoute(ctx, method, path) -> void
findRoute(ctx, method, path, opts?) -> MatchedRoute<T> | undefined
findAllRoutes(ctx, method, path, opts?) -> MatchedRoute<T>[]
routesOverlap(patternA, patternB) -> boolean
compareRoutes(patternA, patternB) -> "disjoint" | "equal" | "subsumes" | "subsumed" | "partial"
findOverlappingRoutes(ctx, method, pattern) -> MatchedRoute<T>[]
routeToRegExp(route) -> RegExp
regExpToRoute(regexp) -> string

// rou3/compiler
compileRouter<T>(router, opts?) -> (method, path) => MatchedRoute<T> | undefined
compileRouterToString(router, functionName?, opts?) -> string
```

## Core Algorithm

**Radix tree** with three node types: **static** (exact match), **param** (`:id`, `*`), **wildcard** (`**`).

### Node structure

```ts
interface Node<T> {
  key: string;
  static?: Record<string, Node<T>>;
  param?: Node<T>;
  wildcard?: Node<T>;
  hasRegexParam?: boolean;
  methods?: Record<string, MethodData<T>[]>;
}
```

### Lookup priority

1. Static child (exact segment match)
2. Param child (single-segment dynamic)
3. Wildcard (multi-segment catch-all)

### `findAllRoutes` result ordering

Results are ordered **least → most specific**, and the interpreter (`findAllRoutes`) and compiled `matchAll` must agree exactly (`test/find-all.test.ts` asserts `toEqual`). Two levels:

- **Across node kinds:** tree traversal order (wildcard → param → static → self) yields general → specific.
- **Same-node siblings** (multiple routes sharing one param/wildcard node, i.e. one `methods[method]` array): ordered by **specificity weight ascending**, with **insertion order preserved on ties** (#187). Weight = one point per regex-constrained param + one for a required last param on a *dynamic* terminal (param/wildcard node; static terminals don't distinguish required from optional — mirrors the compiler's `hasLastOptionalParam`/`currentIdx === -1` gating). `pushSorted()` in `find-all.ts` sorts each pushed array (stable `Array#sort`); the compiler reaches the same order by sorting matchers **descending** by weight then `r.unshift`-ing, and `.reverse()`-ing first so equal-weight siblings keep insertion order despite the unshift. The two weight models are kept identical on purpose — insertion order and weight order coincided before #187, which masked the divergence.

### Compiler

`compileRouter()` generates an optimized function via `new Function()`:

- Inlines static routes for O(1) lookup
- Unrolls segment checks into `split("/")`-based array access
- Inlines regex patterns for param validation
- Method-agnostic (`""`) registrations are emitted as an `else` fallback after the method-scoped `if(m==="…")` chain (`compileMethodMatch`), mirroring the runtime's per-node `methods[m] || methods[""]`: a method-scoped entry shadows the agnostic sibling even when its own conditions (regex/length) fail. Previously the agnostic entry was emitted unconditionally, so compiled `matchAll` returned a duplicate agnostic layer and compiled `findRoute` wrongly fell back to it.
- Compare interpreter vs compiled output in tests

### URLPattern group delimiters

- `src/_group-delimiters.ts` expands non-capturing group delimiters before route insertion/removal/regexp generation.
- Supported forms: `{...}` and `{...}?` (plus single-segment `{...}+` / `{...}*` converted to `(?:...)+/*` regex fragments).
- Limitation: `{...}+` / `{...}*` are rejected when group body contains `/` (cross-segment repetition unsupported in radix tree).
- **Regexp inlining (`routeToRegExp` only):** the radix tree still expands `{...}?` into two full routes (add/remove need that), but `routeToRegExp()` compiles a *trailing single* optional group inline as `(?:...)?` via `inlineOptionalGroup()` in `regexp.ts`, instead of OR-joining two full-route regexes. This avoids re-emitting params before the group in both branches — the duplicate named groups (`(?<id>…)|(?<id>…)`) that PCRE2-family engines reject. It handles the mid-segment case (`/book{s}?` → `^\/book(?:s)?\/?$`, `/blog/:id(\d+){-:title}?` → `…(?<id>\d+)(?:-(?<title>…))?…`) and the cross-segment case (`/foo{/bar}?` → `^\/foo(?:\/bar)?\/?$`); it falls back to alternation (old behavior) for multi-group routes, mid-route optionals (non-empty `suf`), unexpected segment shapes, **or a mid-segment optional following a greedy open-ended capture** (`/media/*{.webp}?` — inlining would let `[^/]*` swallow `.webp` and change the captured value, so it stays as alternation; these are the only fixtures that still emit duplicate names). The group scanner (`scanFirstGroup()`) is shared: it lives in `_group-delimiters.ts` (already in the core bundle via add/remove) and is used by both `expandGroupDelimiters()` and `inlineOptionalGroup()`, so the two paths classify groups identically. It returns a `[pre, body, suf, mod]` **tuple** (not an object) to avoid enlarging the size-budgeted core bundle.

### URLPattern backslash escaping

Two separate escape systems handle `\x` in route patterns:

1. **Router escape encoding** (`_utils.ts`): `encodeEscapes()` converts `\:`, `\(`, `\)`, `\{`, `\}` to `\uFFFD` + single-char placeholders (A-E) before segment splitting, preventing these chars from being interpreted as route syntax. `decodeEscaped()` converts them back for static node keys. Other `\x` (like `\*`) are left for existing `segment === "\\*"` handling.

2. **Regex escape handling** (`_escape.ts`): `replaceEscapesOutsideGroups()` replaces `\x` outside `(...)` groups with `\uFFFE` placeholder, preserving regex syntax inside groups (e.g., `\d` in `(\d+)`). `resolveEscapePlaceholders()` then converts placeholders to regex-safe literals. Used by `routeToRegExp()` and `getParamRegexp()` in `add.ts`.

Key invariant: `\uFFFD` (U+FFFD) is used for router-level escaping, `\uFFFE` (U+FFFE) for regex-level escaping — they must not collide.

### RegExp → route (`regExpToRoute`)

- `src/regexp-to-route.ts` is the inverse of `routeToRegExp()`: it parses an anchored, PCRE-compatible `RegExp` (or its `source` string) back into a rou3 route pattern. Tree-shakeable — zero impact on the core bundle (only pulled in when imported).
- Targets the dialect `routeToRegExp()` emits. The parser strips `^`/`$` and the trailing `\/?`, then walks the body recognizing: static separators (`\/`) + segments, catch-alls (`\/?(?<_>.*)` → `**`, `\/?(?<name>.+)` → `**:name`), and optional-group units (`(?:\/…)?`). Segment-internal parsing maps `(?<name>[^/]+)` → `:name`, `(?<_N>[^/]*)` / bare `([^/]*)` → `*`, `(?<_N>pat)` / bare `(pat)` → `(pat)`, `(?<name>pat)` → `:name(pat)`, and re-escapes literal route-syntax chars (`: ( ) { } * \`). Bare (unnamed) capturing groups map like their `(?<_N>…)` counterparts.
- Optional units classify by inner shape: a whole-segment param → `:name?` / `:name*` / `:name(pat)?|*` (repeat form `pat(?:\/pat)*` → `+`/`*`); a literal/mixed inner → `{…}?` merged onto the previous segment (`(?:s)?` → `{s}?`, `(?:\/bar)?` → `{/bar}?`). Whole-segment `.+` → `:name+`.
- **Reject-by-default (no silent corruption):** `reverseSegment()` is a whitelist parser — only named/bare groups, escaped-punctuation literals, and plain literal chars are accepted. Anything outside the dialect throws a `rou3:` error instead of being literalized into a wrong route: structural look-arounds (`(?=` `(?!` `(?<=` `(?<!`) and other `(?…)` group constructs, backreferences and metaclass escapes outside a constraint (`\k<x>`, `\1`, `\d`, `\w`, `\b`), and bare (unescaped) regex operators at segment level (`. ^ $ * + ? | [ ] { }`). Constraint bodies (`(…)`) stay **opaque** — arbitrary regex inside them (quantifiers, non-greedy, look-arounds, nested groups) is preserved verbatim. `constraint()` still rejects bodies containing `/` (unrepresentable after path splitting). Match-affecting **regexp flags** (`i`/`m`/`s`) throw (routes carry none, so honoring them silently is impossible); `g`/`y`/`u`/`v`/`d` don't affect a fully-anchored match and are ignored.
- **Round-trip:** `routeToRegExp(regExpToRoute(regexp)).source === regexp.source` holds for every non-fallback fixture (`test/regexp-to-route.test.ts` asserts this over `_regexp-cases.ts`). The **alternation fallback** forms (`PCRE2_DUPLICATE_NAME_ROUTES`, e.g. `/media/*{.webp}?` → `^(?:…|…)$`) are not reversible and throw.

### Pattern overlap & subsumption (`routesOverlap` / `compareRoutes` / `findOverlappingRoutes`)

- The feature is tree-shakeable (the core bundle is unaffected; see `test/bench/bundle.test.ts`): `src/_overlap.ts` holds the shape model, `src/operations/overlap.ts` the public API + tree traversal. A route is modeled as a `RouteShape`: an array of fixed single-segment matchers (`string` literal | `RegExp` constraint | `undefined` = any) plus a variable-length tail `[tailMin, tailMax]` (trailing `*` -> `[0,1]`, `**` -> `[0,∞]`, `**:name` -> `[1,∞]`, none -> `[0,0]`). The tail matches any values, so it constrains only segment **count**, never contents.
- Shapes are built from radix-tree entries (`shapeOf`): kind-tagged edges (static key | param | wildcard) plus the entry's own `paramsMap`. Carrying the node kind keeps escaped-literal static keys (`\*` -> static `"*"`) distinguishable from dynamic segments. Per-entry shapes are cached in a `WeakMap`.
- Query patterns are inserted into a throwaway router via the real `addRoute` (`routeToShapes`), so queries and registered routes are classified by the exact same pipeline (`expandGroupDelimiters` -> `encodeEscapes`/`splitPath` -> `expandModifiers` -> regex params). A pattern with optional/group syntax yields several shapes; patterns overlap when **any** shape pair overlaps.
- `shapesOverlap()`: check the shared fixed prefix then test that total-length ranges `[fixed+tailMin, fixed+tailMax]` intersect. Value check is length-independent because any valid common length ≥ `max(fixedA, fixedB)`.
- **Overlap = "∃ concrete path matched by both,"** not subset containment. `static`/`static` and `static`/`regex` are precise; `any`-vs-anything and `regex`/`regex` are **over-approximated to overlap** (conservative default — regex intersection is undecidable).
- **Shape canonicalization:** `_computeShape` folds trailing `undefined` (any-value) fixed matchers into the tail (`/a/:x` -> `["a"] [1,1]`), and `routeToShapes` merges shapes with identical fixed prefixes and contiguous length ranges (`/a/:x?` -> `["a"] [0,0]` + `["a"] [1,1]` -> `["a"] [0,1]`). Both are match-set-preserving; they make containment see through optional-syntax expansion (`/a/:x?` == `/a/*`).
- `compareRoutes(a, b)` classifies match-set relations: `disjoint` | `equal` | `subsumes` (strict superset) | `subsumed` | `partial` (intersecting, no containment proven). Built on `shapeSubsumes()` (`_overlap.ts`): `b`'s total-length range inside `a`'s + per-position matcher containment (`any` ⊇ all; literals by equality; anchored regex ⊇ literal via `test()`; regex ⊇ regex only by source+flags equality) + `a`'s fixed positions under `b`'s tail must be `any`. Pattern-level containment is proven shape-by-shape (each `b` shape inside a *single* `a` shape) — sufficient, not necessary, so union-split coverage degrades to `partial`. **Sound by construction:** every verdict except `partial` is a proof; undecidable cases (different regex sources, param names irrelevant) fall back to `partial`/one-sided, never a wrong claim. Param *names* don't affect the verdict (`/a/:x` equals `/a/:y`).
- `findOverlappingRoutes` traverses the tree in `findAllRoutes` order (wildcard, param, static, self) so results are least→most specific, prunes static subtrees the query can't reach, and collapses only genuine reference-duplicates (a route with optional/group syntax expands into several entries sharing one `data` reference); distinct routes with equal-or-absent primitive `data` are all reported. Matches carry `data` only (a scope has no single concrete path → no `params`).

### Input path normalization

`normalizePath()` in `_utils.ts` resolves `.` and `..` segments in lookup paths (fast-path: skip if no `/.` found). Both `findRoute()` and `findAllRoutes()` normalize before matching. The compiler inlines equivalent logic in generated code.

### Wildcard segment captures

- **Breaking change:** unnamed captures now use URLPattern-style numeric keys (`"0"`, `"1"`, ...) instead of legacy `_0`, `_1`, ...
- Unescaped `*` inside a segment is treated as an unnamed capture (`"0"`, `"1"`, ...), including mid-pattern forms like `/*.png` and `/file-*-*.png`.
- Wildcard capture indexing is shared with unnamed regex groups in the same route.
- `removeRoute()` now treats wildcard-segment patterns as dynamic segments (same classification as add/find/regexp).

## Build & Scripts

- **Builder:** `obuild` (config in `build.config.mjs`)
- **Entries:** `src/index.ts`, `src/compiler.ts`
- **Output:** ESM + `.d.mts` declarations

```bash
pnpm build             # Build with obuild
pnpm dev               # Vitest watch mode
pnpm lint              # ESLint + Prettier
pnpm lint:fix          # Auto-fix
pnpm test              # Full test suite + coverage
pnpm test:types        # TypeScript type checking
pnpm bench:node        # Benchmarks (node)
pnpm bench:bun         # Benchmarks (bun)
pnpm bench:deno        # Benchmarks (deno)
```

## Testing

- **Framework:** Vitest (config in `vitest.config.mjs`)
- **Dual validation:** Tests compare `findRoute()` results against `compileRouter()` output
- **Snapshots:** Tree structure and compiled code snapshots
- **Type tests:** `vitest typecheck` via `types.test-d.ts`
- Run a single test: `pnpm vitest run test/<file>.test.ts`
- **WPT compat tests:** `test/wpt.test.ts` validates URLPattern compatibility using Web Platform Test data. Known diffs are tracked in `KNOWN_DIFFS`, `REGEXP_ONLY_KNOWN_DIFFS`, and `ROUTER_KNOWN_DIFFS` sets with reason comments.
- **PCRE cross-engine tests:** `test/regexp.pcre.test.ts` runs `routeToRegExp()` output through whichever real PCRE-compatible CLIs are installed (`grep -P`, `rg -P`, `pcre2grep`, `pcregrep`, `perl`, `php`). Each candidate is included only after a `(?<name>...)` sanity probe, so missing/non-PCRE tools are auto-skipped (suite is a no-op if none are present). All fixtures are asserted to compile and match on every detected engine. `PCRE2_DUPLICATE_NAME_ROUTES` flags any route whose output reuses a named group across alternation branches (valid in JS/Perl, rejected by PCRE2 without `PCRE2_DUPNAMES`); it contains the non-inlinable cases (e.g. `/media/*{.webp}?`, a mid-segment optional after a greedy capture) — for those the suite asserts strict PCRE2 engines *reject* the output while Perl accepts and matches it. `test/regexp.test.ts` asserts every other fixture emits no duplicate named groups, and conversely that each `PCRE2_DUPLICATE_NAME_ROUTES` entry really does (so the set can't go silently stale).

## Code Conventions

- **Performance-first:** `charCodeAt()` over `.startsWith()`, traditional `for` loops, null-prototype objects, `.concat()` over spread
- **Abbreviated hot-path vars:** `m` (method), `p` (path), `s` (segments), `l` (length)
- **Internal files:** Prefixed with `_` (e.g., `_utils.ts`)
- **ESM only**, explicit `.ts` extensions in imports
- **ESLint:** `eslint-config-unjs` with custom overrides
- **Formatter:** Prettier

## Best Practices

### Code Style

- Prefer ESM over CommonJS
- Use explicit extensions (`.ts`/`.js`) in import statements
- For `.json` imports, use `with { "type": "json" }`
- Avoid barrel files (`index.ts` re-exports); import directly from specific modules
- Place non-exported/internal helpers at the end of the file
- For multi-arg functions, use an options object as the second parameter for extensibility
- Split logic across files; avoid long single-file modules (>200 LoC). Use `_*` for naming internal files

### Bug Fix Workflow (Regression-First)

1. **Write the regression test first** — reproduce the exact bug
2. **Run it and confirm it fails** — MUST fail before touching implementation
3. **Fix the implementation** — minimal change
4. **Run the test again** — confirm it passes
5. **Run the broader test suite** — ensure no regressions

Never skip step 2. A regression test that wasn't proven to fail first has no value.

### Git

- **Commits:** Semantic, lower-case (e.g., `perf: ...`, `fix(compiler): ...`), include scope, add short description on second line
- If not on `main`, also `git push` after committing
- Use `gh` CLI for GitHub operations
