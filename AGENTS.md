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
  _group-names.ts     # Capture-group name codec (param name <-> group name escaping)
  _segment-wildcards.ts# Wildcard segment capture handling
  _overlap.ts         # Pattern-overlap shape model (tree entry -> RouteShape, shape intersection)
  _subsume.ts         # Shape subsumption/canonicalization (shapeSubsumes, mergeShapes, regex-key normalization)
  route-node-keys.ts  # routeNodeKeys() - radix-node identity keys for a pattern
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
  route-node-keys.test.ts # routeNodeKeys() (fixtures + node-sharing property sweep + shadowing sweep)
  group-names.test.ts # Capture-group name codec (round-trip + injectivity)
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
compareRoutes(patternA, patternB) -> "disjoint" | "equal" | "superset" | "subset" | "partial"
findOverlappingRoutes(ctx, method, pattern) -> MatchedRoute<T>[]
routeNodeKeys(pattern) -> string[]
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

**Removal** (`removeRoute`) splices `MethodData` entries by the **registration identity** `addRoute` stamps on them (`MethodData.route`), never by deleting the whole `methods[method]` bucket — same-node siblings (`/a/:id` vs `/a/:userId`, `/a/**` vs `/a/**:rest`, `/a/:id` vs `/a/:n(\d+)`) used to be dropped together (#201). The identity is derived in `_add` (`add.ts`) and mirrored by `_removeRoute`/`_remove` (`remove.ts`): a plain pattern's identity is its **rewritten segment join** (static keys post-`segmentKey`, cut at a terminal `**`) — the same string `ctx.static` is keyed by (one `join` per entry, no extra parse) — so spellings the tree can't distinguish (`/a/` ≡ `/a`, `\)` ≡ `)`, `/a/**/b` ≡ `/a/**`) remove each other; a pattern that **expands** (groups, `?`/`+`/`*` modifiers) stamps its pre-expansion text on every entry, normalized by `expandedRouteId()` (`_utils.ts`: trailing empties dropped, static segments keyed via `segmentKey`) so `/a/:x?/` ≡ `/a/:x?` and `\)/:x?` ≡ `)/:x?` there too. Keeping the pre-expansion text means the `/admin` entry of `/admin/:page?` never collides with a separately registered `/admin` on the same node (a per-expansion identity spliced whichever came first). Removal takes out *every* entry with that identity (duplicate registrations go together, as before), and an emptied static node deletes its `ctx.static` key in O(1) via the join accumulated during the walk (a value scan of `ctx.static` made bulk teardown O(N²)). Removal is therefore **by registered pattern** (breaking vs ≤0.9.2): `/x/*` no longer removes `/x/:id`, `/ab` no longer removes `/a{b}`, and `:id(\d+)` vs `:x(\d+)` are distinct even though `compareRoutes` calls them equal. Pinned in `router.test.ts` "Router remove". Known residual: `Node.hasRegexParam` is never cleared after the last regex sibling leaves (cost-only — `findAllRoutes` keeps running the regex loop on that node).

**Same-node siblings** (multiple routes sharing one node's `methods[method]` array) resolve by one shared model in all three matchers (`_selectMatcher` in find.ts, `pushSorted` in find-all.ts, the compiled matcher): the highest specificity weight among **fully-matching** entries wins, ties go to the first-registered. Weight = one point per passing regex-constrained param + one for a required last param on a dynamic (param/wildcard) terminal. An entry whose regex fails is skipped — lookup falls through to less specific siblings, other node kinds, or the optional end-of-path fallback, never aborting (the old per-level greedy regex filter made `findRoute` miss routes that `findAllRoutes` found). Out-of-bounds `segments[i]` reads (`undefined`) must never coerce into a literal `"undefined"` static key — guard with `index < segments.length` before any `node.static[...]` lookup. Both pinned in `find.test.ts` "same-node sibling selection" and `find-all.test.ts` "out-of-bounds segment". `_selectMatcher` keeps a single-sibling/no-regex fast path — lookup perf is at parity with the pre-selection code; keep it when editing.

### `findAllRoutes` result ordering

Results are ordered **least → most specific**, and the interpreter (`findAllRoutes`) and compiled `matchAll` must agree exactly (`test/find-all.test.ts` asserts `toEqual`). This is a **public contract**, documented in README ("Result ordering") and pinned by `test/find-all.test.ts` (`matcher: ordering contract` ties result order to `compareRoutes` subsumption order) — changing it is a breaking change. Two levels:

- **Across node kinds:** tree traversal order (wildcard → param → static → self) yields general → specific.
- **Same-node siblings** (multiple routes sharing one param/wildcard node, i.e. one `methods[method]` array): ordered by **specificity weight ascending**, with **insertion order preserved on ties** (#187). Weight = one point per regex-constrained param + one for a required last param on a *dynamic* terminal (param/wildcard node; static terminals don't distinguish required from optional — mirrors the compiler's `hasLastOptionalParam`/`currentIdx === -1` gating). `pushSorted()` in `find-all.ts` sorts each pushed array (stable `Array#sort`); the compiler reaches the same order by sorting matchers **descending** by weight, emitting `r.push(...)`, and reversing `r` **once at return** (`return r.reverse()` — the final array is the reverse of emit order; per-match `unshift` was O(n) each). In matchAll mode the matcher list is pre-`.reverse()`-d so equal-weight siblings keep insertion order despite the final reverse. Single-match mode must **not** pre-reverse: first `return` wins there, so ties stay in insertion order to match `findRoute` (duplicate registrations resolve to the first-registered entry; an unconditional pre-reverse used to flip this). The weight models (`pushSorted`, `_selectMatcher` in find.ts, and the compiled emission) must order each node's siblings identically; the absolute values may differ by a per-node constant — when **no** sibling has an optional last param, the compiler skips the widened end-of-path check and its per-matcher `l>c` conditions entirely (`hasOptionalLastParam()` gate), shifting every sibling's condition count down by one uniformly. Insertion order and weight order coincided before #187, which masked the divergence.

**Carve-out: optional syntax breaks pattern-level subsumption consistency (known, documented, not a bug to "fix").** `findAllRoutes` orders **tree entries** (post-`expandModifiers`, single-shape routes); `compareRoutes` compares **patterns** (the union of all their expansions). A pattern with `:name?` / `:name*` / `{...}?` registers several entries, and the expansion that makes the pattern the broader one often does not participate in the match at all — so **no node-local weight function can observe it**. `compareRoutes` is correct here and must not be changed (e.g. `/api/*/:path*` really does match `/api` — dropping `:path*` leaves a trailing bare `*`, zero-or-one — while `/api/*/**` does not, so `compareRoutes("/api/*/**", "/api/*/:path*") === "subset"` is true). A sweep over 61 patterns × 13 paths × both registration orders found 354 order-vs-containment violations and **every one** required the superset pattern to be multi-expansion; registering each expansion individually removes them all. `:x+`, `**`, `**:rest`, `*`, regex params and static routes never violate on their own, interpreter vs compiled `matchAll` never diverged (that contract is intact), and `findRoute` is unaffected. Three classes, pinned as known-divergent in `test/find-all.test.ts` (`matcher: ordering contract: optional-syntax carve-out`) and documented in README ("Result ordering" carve-out):

- **A1** — an expansion is byte-identical to the other route, so the stable sort is a no-op and **registration order decides** (`/admin` vs `/admin/:page?` on `/admin`).
- **A2** — same node, the optional pattern's *matched* entry is strictly narrower, so it sorts last (`/api/*/:path*` ⊇ `/api/*/**` on `/api/v1/x`) — wrong in both registration orders.
- **A3** — the matched entries live in different nodes and traversal order decides (`/p/:id/:id*` ⊇ `/p/:id/*` on `/p/a`) — wrong in both registration orders.

A1/A2 (same-node) are fixable by recording a per-pattern breadth rank at `addRoute` time and feeding it into the sibling weight; **A3 is not** — cross-node order is fixed by traversal, so a partial fix would not close the gap. A full fix means globally re-sorting the result set against a partial order (`compareRoutes`) after collection: a behavior + perf change, i.e. a major-version design change. Do not touch the weight functions expecting them to help.

### Compiler

`compileRouter()` generates an optimized function via `new Function()`:

- **Static routes** dispatch is hybrid (`STATIC_CHAIN_MAX = 8`): up to 8 static paths emit an `else if` chain of `p === "..."` compares — faster there because repeated/interned path strings compare near pointer-speed and dynamic requests miss the chain via cheap length checks (an unconditional map cost the bench set ~1.3×). Above 8 they emit a single null-prototype map lookup (`{path: {method: data}}`, matchAll: `{path: {method: data[]}}`) held in a `$N` data slot — O(1) vs the chain's O(N) (map is ~2-3× faster at 20-50 routes with fresh per-request strings, ~6× at 50 interned). Method miss falls through to the tree lookup, mirroring the interpreter's `ctx.static` fast path. Both map levels are null-proto so `__proto__`/`constructor` path or method strings can't match (pinned in `find.test.ts` "prototype-key lookups" and "many static routes", which covers the >8 map codegen incl. duplicates and matchAll). Lookup ignores **one** trailing slash only (#209), which the prologue already strips, so both modes compare the stripped `p` once — no secondary `…/` chain or `p.slice(0,-1)` retry (those existed only for the old two-slash rule). Root is keyed `""` in both `ctx.static` and the dispatch, so `"//"` (stripped to `"/"`) can't reach it. Pinned in `find.test.ts` "at most one trailing slash is ignored (#209)".
- Unrolls segment checks into `split("/")`-based array access
- **Tree static siblings** dispatch is hybrid too (`SEGMENT_CHAIN_MAX = 32`): up to 32 static children of one node emit an `else if(s[i]==="...")` chain; above that a hoisted null-proto `{segment: index}` map + dense integer `switch` — O(1) vs the chain's O(N) scan (measured crossover ~40 siblings; switch ~1.4× faster at 64, ~2× at 200 where the chain degrades to interpreter speed). The switch **must** keep its `l>i` bound check even after an `else`: an out-of-bounds `s[i]` is `undefined`, which the map lookup would coerce to the key `"undefined"` (the chain's `===` was immune). AOT map emission uses a computed key for a literal `__proto__` segment (a plain `"__proto__":` property in an object literal would set the prototype). Pinned in `find.test.ts` "wide static fan-out".
- **`__proto__` object-literal keys** go through `propKey()`: it emits `["__proto__"]` for that one name and a plain `JSON.stringify` key for every other (so ordinary routes' codegen is byte-identical). Used by the AOT segment map **and** every `params:{…}` emission site (plain/optional/repeat param names, `**:name` tails, and both `scanRegExpGroups` branches — whole-segment `.test()` and `.groups.<name>` reads); a route param named `__proto__` used to hit the prototype setter and silently vanish from the compiled result while the interpreter (null-proto params object) returned it. The `..._normalizeGroups()` spread fallback needs no guard (spread creates own data properties). Pinned in `find.test.ts` "__proto__ param names".
- **End-of-path widening** (`l===c||l===c-1` + per-matcher `l>c` guards, the `/x` matches `/x/*` rule) is emitted only when some matcher at the param node actually has an optional last param (`hasOptionalLastParam()`); all-required nodes (plain `:id`, the common case) get a single `l===c`. Gating on `node.key === "*"` alone used to emit a dead widened branch for every required-only param node and for static nodes of escaped `\*` segments.
- **Method keys are `JSON.stringify`-ed** into `m===` compares — methods are user input; a raw quote was a SyntaxError in JIT mode and code injection in AOT output (pinned in `find.test.ts` "unusual method names").
- **JIT data slots are function parameters** (`$N`, ~10% faster per access than array reads) up to `DATA_ARGS_MAX = 32_000`; above that `compileRouter` recompiles with a single array argument (`$[N]`) to stay under the engine's 65535 formal-parameter/spread-call limits (pinned in `find.test.ts` "data slots above the argument limit").
- **Wildcard tails** with an all-static prefix compile to `p.slice(K)` at a constant byte offset (O(1) substring view, ~4.5× faster per match) instead of `s.slice(i).join('/')` (`compileNode` threads `staticPrefixLen`; a param segment resets it to -1 and falls back to slice/join). Valid because the split prologue keeps every segment of `p` (no trailing-empty pop since #209), so both forms read the same characters. Doubled-slash edge cases are pinned in `find.test.ts` "wildcard tail extraction".
- **matchAll** accumulates with `r.push(...)` + a single `return r.reverse()` (final array = reverse of emit order — identical to the old per-match `unshift`, without the O(n) shifts).
- `serializeData()` dedupes `$N` data slots via a `Map` (`ctx.dataMap`), not `Array#indexOf` (compile-time O(N²) on large routers).
- **Regex params** are resolved at compile time by `scanRegExpGroups()` (escape- and character-class-aware source scan): group names — including user named groups embedded in constraint bodies — are emitted as direct `params:{name:_mN.groups.name}` reads with the `__rou3_unnamed_N` → `"N"` renaming done at compile time, and the regex runs **once** (`(_mN=re.exec(seg))!==null` in the condition). A whole-segment group (`^(?<name>...)$`, the common `:id(\d+)` shape) skips `exec()` entirely: `.test()` + `params:{name:seg}` (the anchored group always equals the segment). Unparseable group names (e.g. unicode) fall back to the legacy exec + `{...spread}` + runtime `_normalizeGroups` path (also single-exec now, via a `_mN` temp). This is ~3.6× faster end-to-end on regex routes than the old always-spread emission (the `.groups` spread + runtime renaming dominated, not the double exec). `_mN` temps are declared next to `let s=...` via `ctx.regexTemps`. Regexes live in `$N` **data slots** (`serializeRegExp()`, deduped by source in `ctx.regexpMap` — separate from `dataMap` so a regex can't collide with an equal-looking string data value; JIT passes the RegExp object, AOT emits its literal): an inline literal would allocate a fresh RegExp per evaluation (ES2015+ semantics), measured ~2-6% per match.
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

Perf: `addRoute`'s pre-processing helpers each bail out early when the input lacks their trigger char — `encodeEscapes` (`\`), `decodeEscaped` (`\uFFFD`), `expandGroupDelimiters` (`{`), `expandModifiers` (trailing `?`/`+`/`*` charCode check). Plain routes skip all the regex/scanner machinery (~2x faster add); keep the guards when editing these helpers.

### Regex ≡ router (`routeToRegExp` exactness, #200)

`routeToRegExp(p).test(path)` must agree with `findRoute(router_with_only_p, "", path) !== undefined` — consumers use the regex as a guard/scope check (h3 v2 `use(route, mw)` inherited an auth bypass from an under-match), so the regex mirrors the **trie's** tolerances rather than URLPattern's. Pinned by the property sweep in `test/regexp.test.ts` ("matches exactly the paths findRoute matches") plus `_regexp-cases.ts` fixtures; the 7 `/foo/`-style WPT cases moved from `ROUTER_KNOWN_DIFFS` to `KNOWN_DIFFS` accordingly. The rules:

- **Trailing slash:** every non-root route ends in `TRAILING_SLASH` = `(?:(?<=/)/|(?<!/)/?)$` — lookup strips at most one trailing `/` (#209), and when the body ends in `/` (a real empty last segment, e.g. `/a//` → `/a/:x` with `x: ""`) exactly one must follow. Root is `^\/$`. The look-behinds are fixed-length (PCRE/Perl-safe). `regExpToRoute` still accepts the pre-#209 two-slash suffix `(?:\/\/|(?<!\/)\/?)`.
- **Whole-segment `:name` → `[^/]*`** (the param node takes `""`: `/a//b` reaches `/a/:x/b`); inside a mixed segment it stays `[^/]+` (mirrors `getParamRegexp`). `:name?` likewise.
- **Trailing `*` is optional** (`(?:/(?<_N>[^/]*))?`), also when only `?`/`*`-modified segments follow it.
- **`**:name` / `:name+` → `/(?<n>.*)`** (required separator, segments may be empty); `.+` let `/a//` match with `n="/"`.
- **Router-order expansion (`needsModifierExpansion`):** a mid-route `:x+` / `:x*` (`/a/:x+/b` is `/a/**:x` in the tree) and an empty segment followed only by optional ones (`/docs/{v2}?/:page?` → `/docs//:page?` also registers `/docs`, the empty segment turning trailing) expand through the router's own `expandModifiers`, *after* group expansion like `addRoute`. `inlineOptionalGroup` bails on such routes (it used to feed the unexpanded prefix to the emitter: `/api/:p+/meta{.json}?` missed `/api/secret`). Identical branch sources are deduped before joining.
- A root-level optional is emitted as `(?:/X)?` with no leading `/`: `routeToRegExpSegments` returns `[segments, ownSeparator]` and `joinSegments` drops the leading `/` on that flag (an in-band sentinel char collided with literal route content, e.g. a NUL). The old `^\/?X` form let the leading slash double as a trailing one.
- **Not modeled:** repeated constrained params (`:id(\d+)+` / `*`) — a router bug: `expandModifiers` drops the constraint in the tree while the regex keeps it (regex under-matches); the empty path `""` (the router matches it against root-reaching routes, the regex requires a leading `/`); `normalize: true` lookups (`.`/`..` are resolved before matching — the regex sees the raw path).

### Catch-all regex emission

The separator before a catch-all is **never** a bare optional `\/?` after a prefix: `^\/api\/?(?<_>.*)` matched `/apifoo`, and `.+` could capture the separator itself (`/base/**:p` on `/base/` gave `p="/"`). Now `/api/**` → `^\/api(?:\/(?<_>.*))?<TRAILING_SLASH>` (zero or more segments; on `/api` and `/api/` the group is unset where the router reports `""`), `/base/**:p` → `^\/base\/(?<p>.*)<TRAILING_SLASH>`, and root `/:x+` / `/**:x` → `^\/(?<x>.*)<TRAILING_SLASH>`. Only root `/**` keeps `^\/?(?<_>.*)` (no prefix to overrun). Side effect for `regExpToRoute`: `**:name` and `:name+` now emit **byte-identical** regexes (both one-or-more segments, `compareRoutes` → `equal`, same node key), so `**:name` reverses to `:name+`; likewise `/a/:_*` and `/a/**` share output and a *trailing* `(?:\/(?<_>.*))?` reverses to `**`. Source round-trip still holds. `_regexp-cases.ts` fixtures carry `noMatch` paths asserted against the tree, the JS regex and every PCRE engine — negative cases are what was missing when this shipped.

### RegExp → route (`regExpToRoute`)

- `src/regexp-to-route.ts` is the inverse of `routeToRegExp()`: it parses an anchored, PCRE-compatible `RegExp` (or its `source` string) back into a rou3 route pattern. Tree-shakeable — zero impact on the core bundle (only pulled in when imported).
- Targets the dialect `routeToRegExp()` emits. The parser strips `^`/`$` and the trailing-slash suffix (`(?:(?<=\/)\/|(?<!\/)\/?)`, or the legacy pre-#209 `(?:\/\/|(?<!\/)\/?)` / `\/?`), then walks the body recognizing: static separators (`\/`) + segments, catch-alls (a trailing `(?:\/(?<_>.*))?` → `**`; the legacy `\/?(?<_>.*)` / `\/?(?<name>.+)` forms → `**` / `**:name` — still emitted for a root `/**`, and accepted from older rou3 output), and optional-group units (`(?:\/…)?`). A trailing `\/(?<name>.*)` → `:name+` (so `/a/:x(.*)` reverses to `/a/:x+` — byte-identical regex). Segment-internal parsing maps `(?<name>[^/]*)` / legacy `(?<name>[^/]+)` → `:name`, optional `(?:\/(?<_N>[^/]*))?` → `*`, `(?<_N>[^/]*)` / bare `([^/]*)` → `*`, `(?<_N>pat)` / bare `(pat)` → `(pat)`, `(?<name>pat)` → `:name(pat)`, and re-escapes literal route-syntax chars (`: ( ) { } * \`). Bare (unnamed) capturing groups map like their `(?<_N>…)` counterparts.
- Optional units classify by inner shape: a whole-segment param → `:name?` / `:name*` / `:name(pat)?|*` (repeat form `pat(?:\/pat)*` → `+`/`*`); a literal/mixed inner → `{…}?` merged onto the previous segment (`(?:s)?` → `{s}?`, `(?:\/bar)?` → `{/bar}?`). Whole-segment `.+` → `:name+`.
- **Reject-by-default (no silent corruption):** `reverseSegment()` is a whitelist parser — only named/bare groups, escaped-punctuation literals, and plain literal chars are accepted. Anything outside the dialect throws a `rou3:` error instead of being literalized into a wrong route: structural look-arounds (`(?=` `(?!` `(?<=` `(?<!`) and other `(?…)` group constructs, backreferences and metaclass escapes outside a constraint (`\k<x>`, `\1`, `\d`, `\w`, `\b`), and bare (unescaped) regex operators at segment level (`. ^ $ * + ? | [ ] { }`). Constraint bodies (`(…)`) stay **opaque** — arbitrary regex inside them (quantifiers, non-greedy, look-arounds, nested groups) is preserved verbatim. `constraint()` still rejects bodies containing `/` (unrepresentable after path splitting). Match-affecting **regexp flags** (`i`/`m`/`s`) throw (routes carry none, so honoring them silently is impossible); `g`/`y`/`u`/`v`/`d` don't affect a fully-anchored match and are ignored.
- **Round-trip:** `routeToRegExp(regExpToRoute(regexp)).source === regexp.source` holds for every non-fallback fixture (`test/regexp-to-route.test.ts` asserts this over `_regexp-cases.ts`). The **alternation fallback** forms (`PCRE2_DUPLICATE_NAME_ROUTES`, e.g. `/media/*{.webp}?` → `^(?:…|…)$`) are not reversible and throw.

### Pattern overlap & subsumption (`routesOverlap` / `compareRoutes` / `findOverlappingRoutes`)

- The feature is tree-shakeable (the core bundle is unaffected; see `test/bench/bundle.test.ts`): `src/_overlap.ts` holds the shape model, `src/_subsume.ts` the subsumption/canonicalization layer, `src/operations/overlap.ts` the public API + tree traversal. A route is modeled as a `RouteShape`: an array of fixed single-segment matchers (`string` literal | `RegExp` constraint | `undefined` = any) plus a variable-length tail `[tailMin, tailMax]` (trailing `*` -> `[0,1]`, `**` -> `[0,∞]`, `**:name` -> `[1,∞]`, none -> `[0,0]`). The tail matches any values, so it constrains only segment **count**, never contents.
- Shapes are built from radix-tree entries (`shapeOf`): kind-tagged edges (static key | param | wildcard) plus the entry's own `paramsMap`. Carrying the node kind keeps escaped-literal static keys (`\*` -> static `"*"`) distinguishable from dynamic segments. Per-entry shapes are cached in a `WeakMap`.
- Query patterns are inserted into a throwaway router via the real `addRoute` (`routeToShapes`), so queries and registered routes are classified by the exact same pipeline (`expandGroupDelimiters` -> `encodeEscapes`/`splitPath` -> `expandModifiers` -> regex params). A pattern with optional/group syntax yields several shapes; patterns overlap when **any** shape pair overlaps. `routeToShapes` memoizes per pattern string (bounded `Map`, reset at 1024 entries) — pairwise consumers (`compareRoutes` over N patterns) pay N parses, not N²; callers must treat returned shapes as immutable.
- `shapesOverlap()`: check the shared fixed prefix then test that total-length ranges `[fixed+tailMin, fixed+tailMax]` intersect. Value check is length-independent because any valid common length ≥ `max(fixedA, fixedB)`.
- **Overlap = "∃ concrete path matched by both,"** not subset containment. `static`/`static` and `static`/`regex` are precise; `any`-vs-anything and `regex`/`regex` are **over-approximated to overlap** (conservative default — regex intersection is undecidable).
- **Shape canonicalization:** `_computeShape` (`_overlap.ts`) folds trailing `undefined` (any-value) fixed matchers into the tail (`/a/:x` -> `["a"] [1,1]`), and `routeToShapes` merges shapes with *identical* fixed prefixes (`_segmentEqual` — strict identity, never mutual-subsumption proofs) and contiguous length ranges (`/a/:x?` -> `["a"] [0,0]` + `["a"] [1,1]` -> `["a"] [0,1]`) via `mergeShapes` (`_subsume.ts`). Both are match-set-preserving; they make containment see through optional-syntax expansion (`/a/:x?` == `/a/*`).
- `compareRoutes(a, b)` classifies match-set relations: `disjoint` | `equal` | `superset` (strict unless equality is undecidable) | `subset` | `partial` (no containment proven, sets *may* intersect). Verdict names follow the ES2025 Set methods (`isSupersetOf`/`isSubsetOf`/`isDisjointFrom`); `superset`/`subset` are directional (`compareRoutes(a, b) === "superset"` means `a` ⊇ `b`). Built on `shapeSubsumes()` (`_subsume.ts`): `b`'s total-length range inside `a`'s + per-position matcher containment (`any` ⊇ all; literals by equality; anchored regex ⊇ literal via `test()`; regex ⊇ regex only by source equality modulo named-group names — `_regExpKey` strips `(?<name>` so param names never affect the verdict, `/u/:id(\d+)` == `/u/:x(\d+)`) + `a`'s fixed positions under `b`'s tail must be `any`. Pattern-level containment is proven shape-by-shape (each `b` shape inside a *single* `a` shape) — sufficient, not necessary, so union-split coverage degrades to `partial`. **Containment claims are proofs; undecidable directions degrade to a weaker verdict, never a wrong claim.** Two caveats are inherent: strictness of `subsumes`/`subsumed` is best-effort (an actually-equal pair whose equality is only provable one way — `/u/:id(42)` vs `/u/42` — reports the proven containment, not `equal`), and `partial`'s intersection half is over-approximated (a `partial` regex-vs-regex pair may in fact be disjoint). Both are pinned in `test/overlap.test.ts`.
- `findOverlappingRoutes` traverses the tree in `findAllRoutes` order (wildcard, param, static, self) so results are least→most specific, prunes static subtrees the query can't reach, and collapses only genuine reference-duplicates (a route with optional/group syntax expands into several entries sharing one `data` reference); distinct routes with equal-or-absent primitive `data` are all reported. Matches carry `data` only (a scope has no single concrete path → no `params`).

### Route node keys (`routeNodeKeys`)

`src/route-node-keys.ts` exposes the **radix-node identity** of a pattern — a syntactic tree property, deliberately separate from the semantic match-set relations `compareRoutes` answers. Tree-shakeable: it only reuses `createRouter`/`addRoute` (already in the core bundle) and is dropped entirely when unimported, so `test/bench/bundle.test.ts` is unaffected (measured byte-identical with and without the `src/index.ts` re-export).

- **Why it exists:** rou3 buckets registrations by **node**, and lookup resolves a node with `methods[method] || methods[""]`, so a method-scoped entry on a node hides that node's method-agnostic (`""`) entry. Consumers that bucket their own per-route metadata by **pattern text** (h3 PR #1524 did) see `/users/*` and `GET /users/:id` as two entries where rou3 has one bucket — the `basicAuth` gate is silently deleted, fail-open. `compareRoutes` cannot close this gap: over 18,336 pattern pairs, `=== "equal"` had 13% recall on node collisions and 51 of 338 `"equal"` verdicts did not collide (`/a/:x/**` vs `/a/:x+` are equal but live on `/a/*/**` and `/a/**`). Keep the two APIs separate.
- **Soundness contract:** `routeNodeKeys(A) ∩ routeNodeKeys(B) ≠ ∅` **⟺** A and B share a radix node (hence one `methods[]` bucket). Sound in **both** directions *as a statement about nodes*, and explicitly **not** a statement about match sets — the key erases regex constraints and widens `**:name` → `**`, so `/u/:id(\d+)` and `/u/:slug([a-z]+)` share `/u/*` while matching disjoint paths. Over-merging is the fail-closed direction and the correct bias here. It is **not** named `canonicalRoutePattern` for exactly that reason: the key is not an equivalent pattern.
- **Implementation constraint (non-negotiable):** never write a second pattern parser. `routeNodeKeys` inserts into a throwaway router via the real `addRoute` (exactly like `routeToShapes` in `_overlap.ts`) and DFS-walks the tree emitting `prefix || "/"` at every node with `methods` — which dedupes for free. A parser that drifts from `addRoute` would report node identities the router doesn't use, recreating the very bug this exists to prevent. It must **not** import `_overlap.ts` (that pulls `mergeShapes` from `_subsume.ts` into the graph).
- **Node-identity rules the key encodes:** param edge (`node.param`, key `*`) is taken by `:name`, `*`, `:id(\d+)`, `(\d+)` and mid-segment captures (`*.png`, `pre-:id-suf`, `file-*-*.png`) — name and constraint live in the *entry*, not the node; wildcard edge (`node.wildcard`, key `**`) by `**`, `**:rest`, `:x+`, and it is **terminal** (the add loop breaks, so `/a/**/anything` is `/a/**`); static otherwise via `decodeEscaped` with `\*`→`*` and `\*\*`→`**`. Trailing empty segments are all popped (`/a` ≡ `/a/` ≡ `/a//`, #193) but *middle* empties are a real static `""` key (`/a//b`).
- **Key encoding:** segments joined by `/`; param → `*`, wildcard → `**`, static key `k` emitted with `*`→`\*`, `**`→`\*\*` and `: ( ) { }` backslash-escaped, so a literal can never be read as a marker and every key is itself a route pattern reaching exactly its own node (`routeNodeKeys(k) === [k]`). Weaker encodings fail: escaping only `\`/`*` breaks idempotence (a static key may legitimately contain a raw `\`, e.g. `a\*`), and leaving `)`/`}` unescaped breaks it for keys like `\)`.
- **Memo:** bounded `Map` cleared at 1024 entries (same policy as `routeToShapes`); returns `keys.slice()` so callers cannot mutate the memo.
- **Tests (`test/route-node-keys.test.ts`) — the property sweep is what keeps this honest.** Over a 141-pattern corpus (segment alphabet × depth ≤ 2 × tails, plus optional/group/escape extras) it asserts `keysIntersect(a,b) === sharesNode(a,b)` for all 19,881 ordered pairs against ground truth read off the tree (0 mismatches). The **security** sweep then takes every disjoint-key pair (11,515), registers A under `""` and B under `GET`, and asserts A still comes back from `findAllRoutes` **and** compiled `matchAll` on every path A covers alone — 44,916 checks, 0 shadowed. A false negative in the key model surfaces there as a dropped `""` entry. Encoding injectivity is brute-forced over the adversarial alphabet `{a \ * : ( ) { } .}` up to length 3 (820 segments, 247 reachable static keys, 0 collisions, `*`/`**` reserved), plus idempotence and an explicit **non-goal guard** that equal keys do not imply equal (or overlapping) match sets.

### Capture-group name escaping

Param names accept `[\w-]+`, but a named capture group must be a valid identifier (no `-`, no leading digit) in JS **and** in PCRE. `src/_group-names.ts` is the codec every regex-emitting path goes through:

- `toGroupName()` passes valid identifiers through unchanged (the common case, so existing output is byte-identical) and escapes the rest behind `ESCAPED_GROUP_PREFIX` (`__rou3_esc_`), encoding `_` -> `__` and `-` -> `_h` (`:test-id` -> `__rou3_esc_test_hid`, `:0` -> `__rou3_esc_0`). Names in the reserved `__rou3_` space and `_N`-shaped ones (the unnamed form `routeToRegExp` emits) are escaped too, so a group name maps back to exactly one param name. The escape is a **prefix code** — every `_` in the output opens a two-char escape — hence injective: distinct names can't collide and decoding is exact. This is the whole point of the two-char `-` escape; the tempting `-` -> `_` sanitize is **not** injective (`a--b` decodes back as `a_b`, and `a-_b`/`a_-b` collide onto one group name, which is a duplicate-group `SyntaxError` at registration). Pinned by `test/group-names.test.ts`, which brute-forces round-trip + injectivity over an adversarial alphabet. The output stays within `[A-Za-z0-9_]`, so it is a legal PCRE group name (pinned by `regexp.pcre.test.ts` via the shared fixtures).
- `fromGroupName()` is the inverse and also strips `UNNAMED_GROUP_PREFIX`; it is the single read-back point (`getMatchParams` in `operations/_utils.ts`, the compiler's `scanRegExpGroups` path, and `matchNamedGroup` in `regexp-to-route.ts`). Params therefore always surface under the **original** route name (`params["test-id"]`), and `regExpToRoute()` restores `:test-id` rather than leaking the escaped form.
- Emission sites: `getParamRegexp()` (`operations/add.ts`) and all four in `regexp.ts` (plain, mixed-segment, `:name?`/`+`/`*` modifier, `**:name`). Before this, any param with `-` or a leading digit threw `SyntaxError: Invalid capture group name` from `addRoute()`/`routeToRegExp()` as soon as it appeared in a regex-compiled position — whole-segment `:test-id` worked only because it stores the name as a plain string key (#8dfaa48 widened the name class to `[\w-]` but left group emission raw). Pinned in `find.test.ts` "param names that are not valid capture-group names" and the `_regexp-cases.ts` fixtures.
- The compiler emits `.groups.<name>` property accesses, which are only valid because every emitted name is now an identifier; its runtime `_normalizeGroups` fallback (used when `scanRegExpGroups` can't parse a name, e.g. a unicode group inside a constraint body) inlines a copy of the same decode and must stay in sync with `fromGroupName()`.
- Known (pre-existing) ambiguity, unrelated to the escape: unnamed captures key on `"0"`, `"1"`, … , so a route that mixes a digit-named param with an unnamed capture (`/w/:0/*`) has two params claiming key `"0"` and the later one wins. Same on `main` before the escape existed — the numeric unnamed-key space simply overlaps digit-only param names.

### Input path normalization

`normalizePath()` in `_utils.ts` resolves `.` and `..` segments in lookup paths (fast-path: skip if no `/.` found). Both `findRoute()` and `findAllRoutes()` normalize before matching. The compiler inlines equivalent logic in generated code.

### Empty segments (trailing vs middle)

Two different rules, and they must not be conflated:

- **Trailing** empties are canonicalized away at **registration**: `add`/`remove` split patterns with `splitRoute()` (`splitPath()` + pop *all* remaining trailing empties), so `/a//` ≡ `/a/` ≡ `/a` (#193). A single-pop split (the pre-#209 `splitPath()`) used to leave `/a//` as segments `["a", ""]` — the radix tree then matched only `/a///`, the `ctx.static` key was `/a/`, and the compiled static dispatch stripped to `/a`: three matchers, three answers. This mirrors the trailing-slash policy already documented for routes (`/a` ≡ `/a/`). Pinned in `find.test.ts` "route patterns with trailing empty segments (#193)".
- **Lookup paths** ignore **at most one** trailing slash (#209, breaking vs ≤0.9.x which ignored two): `findRoute`/`findAllRoutes` slice one trailing `/`, and `splitPath` keeps every remaining segment, so `/a/` reaches a `/a` route but `/a//` does not (a real empty last segment remains, which only a param/wildcard takes: `/a//` → `/a/:x` with `x: ""`). This matches Express/find-my-way/Hono non-strict defaults. The old rule (slice one **and** pop one trailing empty) stacked two tolerances and forced every matcher that must agree with the router (#200) to reproduce it. Do **not** reintroduce a pop in `splitPath` or the compiled prologue. Pinned in `find.test.ts` "at most one trailing slash is ignored (#209)".
- **Middle** empties are *meaningful* and preserved everywhere: `/a//b` is a static segment `""` in the tree and matches only the doubled-slash path, never `/a/b` (request paths keep their empty segments too, so collapsing would create the classic normalization-mismatch bypass; URLPattern also treats `//` literally). `routeToRegExpSegments()` used to `continue` on every empty segment, so `routeToRegExp("/a//b")` emitted `^\/a\/b\/?$` — matching the one path the router won't and missing the one it will. It now splits with `splitRoute()` and re-emits middle empties. Pinned by the `/path//sub` + `/path//:id` fixtures in `_regexp-cases.ts` (which assert tree and regex agree) and `find.test.ts` "routes with an empty middle segment".
- An empty segment directly before a wildcard (`/a//**`, `/a//*`, `/a//**:x`) agrees between regex and tree (covered by the `regexp.test.ts` property sweep).

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
