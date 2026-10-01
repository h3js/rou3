# Matching

## Tree

Node kinds: **static**, **param** (key `*`: `:id`, `*`, `:id(\d+)`, mid-segment captures like `*.png`), **wildcard** (key `**`: `**`, `**:rest`, `:x+`, `:x*`). Names and constraints live in the `MethodData` entry, not the node. Non-obvious `Node` fields:

- `suffix` (on a wildcard node): trie of the segments after `**`, stored **last segment first**. A separate field so forward walkers never read it as children.
- `hasSuffix`, `hasRegexParam`: pruning flags, never cleared on removal (cost only).

Lookup priority: static > param > wildcard, except on paths a suffix route matches (below).

**Results** are fresh `{ data, params? }` objects, never the stored `MethodData` (one shared object per route). Static matches and `params: false` have no `params` key; interpreter params are null-proto. An absent optional param has no key, also an in-place one (`*-:x?`: its group is unset, `getMatchParams` skips `undefined`). `addRoute` stores `data ?? null`, so falsy data round-trips.

Guard `index < segments.length` before any `node.static[...]` lookup: `undefined` must never coerce to the key `"undefined"`.

## Same-node siblings

Several entries in one node's `methods[method]` resolve by one model in all three matchers (`_selectMatcher` in `find.ts`, `pushSorted` in `find-all.ts`, the compiler): the highest weight among **fully matching** entries wins, ties go to the first-registered. Weight = +1 per passing regex param, +1 for a required last param on a dynamic (param/wildcard) terminal. A failing regex skips the entry (fall through to less specific siblings/nodes), never aborts. Absolute weights may differ per node by a constant (the compiler omits the end-of-path widening when no sibling has an optional last param), but the order must match. Keep `_selectMatcher`'s single-sibling/no-regex fast path.

## Method-agnostic (`""`) entries

A node's `methods[""]` entries compete with `methods[method]` in one pool: highest weight wins; on equal weight the method-scoped entry wins (`findRoute`) / comes after the `""` one (`findAllRoutes`, compiled matchAll); then registration order. A `""` lookup sees `methods[""]` only.

Never resolve a node with `methods[method] || methods[""]`: it hides `""` entries when the method one fails to match (a fail-open for guards registered method-agnostic, e.g. h3 `use()` middleware). Specificity-first is the rule across nodes and in `rankFromEnd` too, and keeps the ordering contract.

Implementation: `methodEntries()` (`operations/_utils.ts`) feeds `_findAll`/`pushSorted`, `collectSuffix`, `_collectEntries` (overlap); `_selectMatcher` walks the method list then the `""` list with a strict `>`; the compiler emits, inside each `if(m==="X")`, X's matchers plus the `""` ones weight-sorted together, and keeps an `else{""}` block. Tests: `test/method-agnostic.test.ts`.

## `findAllRoutes` ordering (public contract)

Least → most specific; interpreter and compiled matchAll agree exactly (`toEqual`).

- Across node kinds: traversal order wildcard → param → static → self.
- Same-node siblings: weight ascending, stable on ties, `""` before the method's on ties.
- Compiler: matchers sorted **descending**, emitted as `r.push(...)`, one `return r.reverse()`. In matchAll the matcher list is pre-reversed so ties keep insertion order; single-match must **not** pre-reverse (first `return` wins = first-registered).
- On paths a suffix route matches: re-sorted by `rankFromEnd`.

**Carve-out (known, do not "fix"):** tree entries are ordered, but `compareRoutes` compares whole patterns. A multi-expansion pattern (`:x?`, `:x*`, `{…}?`) can be the broader one only via an expansion that does not take part in the match, so no node-local weight can see it. Classes, pinned in `find-all.test.ts` ("optional-syntax carve-out") and README:

- **A1** identical expansion, registration order decides (`/admin` vs `/admin/:page?`).
- **A2** same node, the matched entry is narrower. No instance `compareRoutes` proves: a `:x*` needs a value, so `/api/*/:path*` vs `/api/*/**` is `partial` (`/api/v//`); the test pins that.
- **A3** different nodes, traversal decides (`/p/:id{/**}?` ⊇ `/p/:id/*`: on `/p/a` its `/p/:id` entry comes after the `*` child).

A3 can't be fixed by weights; a real fix is a global re-sort against `compareRoutes` (major design change).

## Segments after `**`

Segments after a `**` match from the **end** of the path; the `**` takes what is between (≥ 0 segments, ≥ 1 with a value for `**:name`). Mid-route `:x+` / `:x*` become `**:x` and keep the segments after them.

- **Syntax:** one catch-all per route (`**`, `:x+`, `:x*`); `_add` throws `rou3: a route can have only one ...` quoting the input as written (threaded through expansion as `input`). `splitRoute()` rewrites a `**<rest>` segment (rest not starting with `:`, `{`, `}`) into `**` + `*<rest>`, so `/**.md` ≡ `/**/*.md` everywhere. A `*` after `**` is required.
- **Params:** `MethodData.suffix = [wildcard index w, suffix length n]`; a param at route index `k` after the `**` maps to `index - w - 1 + (n - k)` at match time (`getMatchParams`, `collectSuffix`, compiled `s[l-j]`).
- **Ranking** (`rankFromEnd`, `operations/_suffix.ts`): when a suffix route matches (`hasSuffixMatch`, pruned by `hasSuffix`), `findRoute` collects all matches (`_findAll(…, reverse = true)`) and stable-sorts comparing from the last segment backwards: literal 3 > regex param 2 > plain param or `**`-covered 0 (a plain param must be 0, or `/**/:y` beats the narrower `/b/**`). `kindAt` returns a covered segment as `~start` of its `**`, so comparisons jump over ranges both `**` cover (cost ∝ segments around the `**`, not path length). Ties keep tree order; `reverse` makes the last match the first-registered. `findAllRoutes` applies the same sort when a suffix route is among its matches. Paths no suffix route matches are untouched. Known (README): the from-end ranking also applies between non-suffix routes on those paths. Pinned by the `suffix.test.ts` sweep "never picks a strictly broader route".
- **Within a suffix trie** (`collectSuffix`): shallower first, then param child, then static child; same-node entries by weight (passing regexes + 1 for `**:name`), ties insertion order.
- **Compiler:** see [compiler.md](compiler.md#suffix-routes).

## Removal

`removeRoute` splices entries by the registration identity `_add` stamps on them (`MethodData.route`), never the whole bucket, so same-node siblings survive.

- Plain pattern: identity = the rewritten segment join (static keys via `segmentKey`, suffix included), the same string `ctx.static` is keyed by. Spellings the tree can't distinguish remove each other (`/a/` ≡ `/a`, `\)` ≡ `)`, `/**.md` ≡ `/**/*.md`).
- Expanding pattern (groups, modifiers): every entry gets the pre-expansion text normalized by `expandedRouteId()`, so the `/admin` entry of `/admin/:page?` never collides with a separately registered `/admin`.
- All entries with that identity go (duplicates together). An emptied static node deletes its `ctx.static` key via the join accumulated during the walk (no value scan).
- Removal is by registered pattern: `/x/*` does not remove `/x/:id`; `:id(\d+)` and `:x(\d+)` are distinct.
- Suffix routes: `_removeSuffix` walks back from the last segment, prunes empty trie nodes, then `wildcard.suffix`, then the wildcard (`_isEmptyNode` counts `suffix`).

## Empty segments and normalization

- **Pattern** trailing empties: `splitRoute()` pops all of them (`/a//` ≡ `/a/` ≡ `/a`).
- **Lookup** paths: at most **one** trailing `/` is ignored and `splitPath` keeps every other segment, so `/a//` has an empty last segment that only a `*`, `**` or a constraint takes (`0: ""`). Do not add a pop to `splitPath` or the compiled prologue; the regexp and compiler rely on this rule.
- **`:name` / `**:name` need a value** (URLPattern): `emptyParam()` (`operations/_utils.ts`) rejects an entry that gives a `:name` an empty segment or a `**:name` an empty value (exactly one empty segment; `/a///` gives `/`). It tells them apart in `paramsMap`: a `*` is digit-named (no param name starts with a digit), a constraint is a RegExp and decides itself (`:id(\d*)` takes `""`, as in URLPattern), a bare `**` is `optional`. `:name+`, `:name*`, `:name?` and `{/:x}?` follow from their expansions: `:x+` is `**:x`, `:x*` is `**:x` plus the route without it (`{/:x+}?`), so on `/a//` a `/a/:x*` falls through like a `/a/:x+` (URLPattern: no match), and still matches `/a`. Empty segments *inside* a longer value stay (`/a/:x*` on `/a//b` is `x: "/b"`, URLPattern rejects it; README differences).
  - Interpreter: `findRoute` sends paths with an empty segment (`segments.includes("")`, rare) through `_findRanked` (`find-all.ts`: `findAllRoutes`' walk, filtered by `emptyParam`, ranked from the end when a suffix route is among them), whose last match is `_lookupTree`'s pick (same traversal, weights and ties), so `_lookupTree` / `_selectMatcher` / `collectSuffix` never check. Paths without one pay a single `includes("")`; paths with one take this slower path (~2× in `findRoute`: it collects every match, so its cost is bounded by the matches found).
  - Compiler: see [compiler.md](compiler.md#codegen-invariants). Pinned by the "empty segments (compiled parity, sweep)" in `find.test.ts`.
- **Middle** empties are real static `""` segments: `/a//b` matches only the doubled-slash path. Never collapse them (normalization-mismatch bypass).
- `normalizePath()` resolves `.` / `..` before matching (skipped when no `/.`); the compiler inlines the same logic.
- **Percent-encoding:** lookup paths are the encoded pathname (`new URL().pathname`) and are never decoded; a route's literal text is encoded at insert instead (see [syntax.md](syntax.md#percent-encoding)). Do not add decoding to the hot path.

## Unnamed captures

An unescaped `*` inside a segment (`/*.png`, `/file-*-*.png`) is an unnamed capture keyed `"0"`, `"1"`, … (URLPattern style), numbered together with unnamed regex groups in the route.
