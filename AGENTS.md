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
  _group-delimiters.ts# Non-capturing group ({...}) expansion helper
  regexp.ts           # routeToRegExp() utility
  compiler.ts         # JIT/AOT compiler (generates optimized match functions)
  operations/
    add.ts            # addRoute() - insert routes into the radix tree
    find.ts           # findRoute() - single-match lookup
    find-all.ts       # findAllRoutes() - multi-match lookup
    remove.ts         # removeRoute() - remove routes from tree
    _utils.ts         # Shared internal utilities
test/
  router.test.ts      # Core router tests
  find.test.ts        # Route matching tests (interpreter vs compiled)
  find-all.test.ts    # Multi-match tests
  regexp.test.ts      # RegExp conversion tests
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
routeToRegExp(route) -> RegExp

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

### Compiler

`compileRouter()` generates an optimized function via `new Function()`:
- Inlines static routes for O(1) lookup
- Unrolls segment checks into `split("/")`-based array access
- Inlines regex patterns for param validation
- Compare interpreter vs compiled output in tests

### URLPattern group delimiters

- `src/_group-delimiters.ts` expands non-capturing group delimiters before route insertion/removal/regexp generation.
- Supported forms: `{...}` and `{...}?` (plus single-segment `{...}+` / `{...}*` converted to `(?:...)+/*` regex fragments).
- Limitation: `{...}+` / `{...}*` are rejected when group body contains `/` (cross-segment repetition unsupported in radix tree).

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
