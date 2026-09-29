# Regex ↔ route

## `routeToRegExp` (`src/regexp.ts`)

**Contract:** `routeToRegExp(p).test(path)` ⟺ `findRoute(router with only p, "", path) !== undefined`, and captures follow the router. Consumers use the regex as a guard (h3 `use(route, mw)`), so an under-match is an auth bypass: the regex mirrors the **trie's** tolerances, not URLPattern's. Pinned by the router-vs-regex sweeps (see [testing.md](testing.md)).

**The one exception:** a constraint that can match `/` (`(.*)`, `[^a]`, `\D`) spans segments in the regex (`/foo/(.*)` matches `/foo/a/b`), while the tree splits first. That over-matches only (a guard still runs), and closing it means rewriting every construct that can match `/` in an opaque user regex, so it stays documented (README, JSDoc) and pinned by "over-matches only for constraints that can match `/`" and WPT `ROUTER_KNOWN_DIFFS`. Anything that would make the regex match *less* is rejected instead: anchors, look-arounds and numbered backreferences in a constraint, a `\/` (see [syntax.md](syntax.md)).

### Trailing slash and endings

A path matches iff the body matches it with one trailing `/` stripped. The general encoding is the look-behind suffix `(?:(?<=\/)\/|(?<!\/)\/?)$` (JS/PCRE; RE2, Go and Rust `regex` reject it). `withTrailingSlash()` (`src/_trailing-slash.ts`) rewrites the ending look-behind-free wherever possible: **its JSDoc is the spec** (open vs closed endings, catch-all tails, which shapes keep the look-behind, and the proof that closed endings must leave an empty segment unset). Supporting scans live in `_regexp-scan.ts` (`parseLevel`, `canBeEmpty`, `canEndInSlash`, `isOptionalGroups`). Rules to keep:

- Root `/` is `^\/$` (`//` is an empty segment).
- Trailing catch-all tails (`ANY_TAIL` / `SOME_TAIL`) are greedy up to the last non-slash char and lazy only over the trailing-slash run, so a capture never holds the stripped slash. Keep them greedy (lazy `.*?` endings were several times slower).
- `starStar` (route ends in a bare `**`, third element of `routeToRegExpSegments`' result) keeps `**`'s group greedy and selects the root `/**` form. Don't key it on the group name `_`: a param named `_` must stay lazy.
- After a whole-segment `:x?` / `*`, later optionals nest inside its group (the `nest` counter).
- **Capture trade-off (inherent):** a closed ending leaves the group unset where the router reports `""` (`/a//` for `/a/:x`). The capture sweep accepts exactly this via `isRequiredSegmentGap()`.

### Emission rules

- Segments are classified like the tree (`segmentKey(encodeEscapes(s))`). Static keys are regex-escaped; dynamic segments (and the base of a `?`-modified one) are the tree's own `getParamRegexp` source with `_N` unnamed keys, so escapes and literal chars can't drift (see [syntax.md](syntax.md#escapes)).
- Catch-alls (`**`, `**:x`, `:x+`, `:x*`) use `[\s\S]` (`ANY`), not `.`: the router splits on `/` only, and `.` skips line terminators (under-match). A user `.` inside a constraint keeps its JS meaning, so a trailing `(.*)` constraint gets lazy `.*?` / `.+?` tails.
- The separator before a catch-all is never a bare `\/?` after a prefix (`/api/**` must not match `/apifoo`). Only root `/**` keeps `^\/?`. `**:name` and `:name+` emit identical regexes.
- Whole-segment `:name` / `:name?` → `[^/]*` (a param takes `""`); inside a mixed segment `[^/]+` (mirrors `getParamRegexp`).
- A trailing `*` is optional, also when only `?`/`*`-modified segments follow.
- A root-level optional is `(?:/X)?` with no leading `/`, via the `ownSeparator` flag of `routeToRegExpSegments` (no in-band sentinel char).
- Middle empty segments are re-emitted (`splitRoute()`).
- **Segments after `**`** follow the catch-all (`pushCatchAll`), so they take the end of the path. `**` after a prefix → `(?:/(?<_>[\s\S]*))?`; at the root `/?(?<_>[\s\S]*)`; `**:x` → `/(?<x>[\s\S]*)`; mid-route `:x*` → lazy `(?:/(?<x>[\s\S]*))??`. With **one** optional after the catch-all, `lazyCatchAll()` compares segment kinds like `rankFromEnd` to choose lazy vs greedy; with several, the regex matches the same paths but may capture another expansion (`OTHER_EXPANSION`). A lone `:y?` after `**` / `:x*` nests the catch-all in one optional group. A second catch-all throws `addRoute`'s error (`oneCatchAll()`).
- **Router-order expansion** (`needsModifierExpansion`): shapes the inline form can't express (an empty segment followed only by optionals, `/docs/{v2}?/:page?`; a `:x*` followed by a `*` that is optional without it) expand through the router's own `expandModifiers` after group expansion, as an alternation. Identical branches are deduped.

### Optional group inlining (`inlineOptionalGroup`)

The tree expands `{…}?` into two routes, but `routeToRegExp` inlines a single optional group as `(?:…)?` to avoid repeating named groups across alternation branches (PCRE2 and Node 22 reject duplicates). The group must end a segment; both expansions (`routeToRegExpSegments`) must line up as shared head + one differing segment (or added whole segments) + shared tail; with a tail, the head must pass `isFixedSegment()`. When the base segment ends in its only capture, `mergeCapture()` emits a look-ahead so the capture splits like the router (`archive.tar.gz` → `archive.tar` + `gz`), unless a `\d`/`\w` run can't take the group's first char. Look-ahead forms are RE2-incompatible and not reversible (`LOOKAHEAD_ROUTES`). Falls back to alternation for multi-group routes, groups inside a segment, non-aligning expansions, a mid-segment optional after a greedy open capture (`/media/*{.webp}?`), and router-order expansion shapes.

### Duplicate names

`addRoute` rejects duplicate param names per expansion; the alternation fallback may still repeat a name across branches. On engines without duplicate named groups (V8 < 12.5 / Node 22) `routeToRegExp` rethrows that `SyntaxError` as `rou3: the regex for "<route>" repeats a named group across alternatives…` with the engine error as `cause`.

### Not modeled

- Constraints that can match `/` (`:x(.+)`): the tree splits first, the regex doesn't (over-match only, see the exception above).
- The empty path `""` (router treats it as `/`).
- `normalize: true` (`.`/`..` resolved before matching).
- PCRE/Perl `$` also matches before a final `\n` (over-match only).

### Perf

Matching stays linear in path length except look-ahead-held params (quadratic on long failing segments; JS has no atomic groups). The trailing-slash-run step is the price of avoiding look-behind.

## `regExpToRoute` (`src/regexp-to-route.ts`)

Inverse of `routeToRegExp`: parses an anchored, PCRE-compatible regex (or source) back to a route. Tree-shakeable.

- **Endings** are normalized structurally, exact shapes only (`ROOT_REPEAT`, `plainBody()` for closed endings, `TRAILING_CATCH_ALL`, `TRAILING_DOT`), then the look-behind suffix, the legacy two-slash suffix or a plain `\/?` is stripped. No generic `.*?` rewrite, so lazy quantifiers inside user constraints survive.
- **Body walk** recognizes `\/` separators, optional units `(?:…)?` / `(?:…)??`, nested optionals, catch-alls (greedy `(?:\/(?<_>[\s\S]*))?` → `**`, lazy → `:_*`, `\/(?<x>[\s\S]*)` → `:x+`, root forms, `NESTED_CATCH_ALL`). `.*` / `.+` still read as catch-alls (legacy output), unless the regex has a lazy user-`.` ending.
- **Segments:** `(?<x>[^/]*)` / legacy `[^/]+` → `:x`; unnamed `[^/]*` → `*`; `(pat)` → `(pat)`; `(?<x>pat)` → `:x(pat)`; route-syntax literals re-escaped; a word char or `-word` after a bare `:name` is escaped (`:x\-suf`). Optional units classify by inner shape into `:x?` / `:x*` / `*` / merged `{…}?` groups. Equivalent outputs come back in one spelling (`/a{/**}?` → `/a/:_*`).
- **Reject by default:** `reverseSegment()` is a whitelist; look-arounds and other `(?…)` constructs, backreferences / metaclass escapes outside a constraint, bare regex operators, constraint bodies with `/`, flags `i`/`m`/`s`/`u`/`v` (`g`/`y`/`d` ignored), unanchored input, and group names that decode to no valid param name all throw. Constraint bodies are opaque and kept verbatim.
- **Legacy inputs** (older look-behind, pre-trailing-slash-change two-slash, 0.9.x `\/?` endings with `.*` / `.+` catch-alls) are accepted; pinned in `regexp-to-route.test.ts`.
- **Round-trip:** `routeToRegExp(regExpToRoute(re)).source === re.source` for every non-fallback fixture, and the reversed route must route like the original. Alternation fallbacks and look-ahead forms throw. Known non-equivalences are listed in `KNOWN_NON_EQUIVALENT` (stale-guarded).
- Known gaps: 0.9.2's `(?:\/(?<w>.+))?` reverses to `/a/:w(.+)?`; a doubly nested `(?:(?:\/(?<w>.*))?)?` throws; a hand-written whole-segment `.*` reads as a catch-all; an ending without `\/?` gains the router's one-trailing-slash tolerance.
