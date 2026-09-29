# Testing

- `pnpm test` runs lint, `tsc`, and vitest with coverage; one file: `pnpm vitest run test/<file>.test.ts`. Type tests: `test/types.test-d.ts`.
- Matcher tests compare `findRoute` / `findAllRoutes` with compiled JIT and AOT output; tree and codegen are snapshot-tested.
- Brute-force sweeps (pairs of patterns × short paths) back the hard invariants: `suffix.test.ts` (never pick a strictly broader route), `method-agnostic.test.ts`, `overlap.test.ts`, `route-node-keys.test.ts`, `regexp.test.ts`, `regexp-to-route.test.ts`. Keep them passing with 0 violations; known exceptions live in named, stale-guarded sets (a listed entry that stops differing fails).
- `test/wpt.test.ts`: URLPattern WPT data; diffs in `KNOWN_DIFFS`, `REGEXP_ONLY_KNOWN_DIFFS`, `ROUTER_KNOWN_DIFFS` (with reasons), rejected syntax in `RESERVED_PATTERNS` (asserted to throw).

## Regex fixtures and sweeps

- **Fixtures** (`test/_regexp-cases.ts`): `match` entries are `[path, groups?, params?]`. `groups` lists every named group exactly (`toStrictEqual`, unset = `undefined`, `_N` keyed `"N"`, escaped names decoded); `params` is the `findRoute` result where it differs (asserted to differ). `noMatch` paths are asserted against the tree, the JS regex and every engine. Pinned sets: `LOOKBEHIND_ROUTES`, `PCRE2_DUPLICATE_NAME_ROUTES`, `LOOKAHEAD_ROUTES`, `RESERVED_SYNTAX_ROUTES`, `TWO_CATCH_ALL_ROUTES`.
- **Sweeps** (`regexp.test.ts`): `sweepPatterns()` × `sweepPaths()` (rejected routes dropped via `routerAccepts`). "matches exactly the paths findRoute matches" must report nothing. "captures what findRoute captures" accepts only `isRequiredSegmentGap()`; anything else goes in `KNOWN_CAPTURE_DIFFS` (classes: `**` over zero segments unset vs `""`; an optional taking a later `*`'s segment; `OTHER_EXPANSION`). `SWEEP_LOOKBEHIND_PATTERNS`, `SWEEP_LOOKAHEAD_PATTERNS`, `SWEEP_DUPLICATE_NAME_PATTERNS` are asserted exactly, so moving a route onto a look-behind or alternation fails loudly.
- **Reversal** (`regexp-to-route.test.ts`): every non-fallback fixture round-trips by source and routes like the original; every sweep pattern reverses to an equivalent route except `KNOWN_NON_EQUIVALENT`.

## Cross-engine

- **PCRE** (`regexp.pcre.test.ts`): runs output through installed `grep -P`, `rg -P`, `pcre2grep`, `pcregrep`, `perl`, `php` (each probed first, auto-skipped when missing; line-based tools skip inputs with `\n`). `PCRE2_DUPLICATE_NAME_ROUTES` must be rejected by strict PCRE2 and accepted by Perl. `rg -P` spawns with `node_modules` dirs removed from `PATH` (`systemEnv`) so it reaches a system build, not the WASM one.
- **RE2 family**: the `ripgrep` devDependency (WASM, Rust `regex` engine, no system binary needed) via `ripgrep(args, { buffer: true })` with `--no-config --text`. Everything outside the look-behind / look-ahead / duplicate-name sets must compile and match like JS; those sets must fail to compile.
- **Node 22** (no duplicate named groups): tests gate on the `DUPLICATE_NAMED_GROUPS` probe in `_regexp-cases.ts` (fixtures and sweep patterns needing it are dropped, `unsupportedSweepPatterns()` must equal `SWEEP_DUPLICATE_NAME_PATTERNS`). CI has a `node22` job. Locally, `pnpm` may pick its own Node, so run `node node_modules/vitest/vitest.mjs run` with the Node 22 binary. Node 20 (the `engines` floor) is not tested (vitest needs 22.12+).
