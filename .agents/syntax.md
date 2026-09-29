# Pattern syntax

`addRoute` pipeline: `checkConstraints` → `expandGroupDelimiters` → `encodeEscapes` / `splitRoute` → `expandModifiers` (`:x+` → `**:x`, `:x*` → `**:\uFFFFx` + the route without it, see [matching.md](matching.md#empty-segments-and-normalization)) → per segment `getParamRegexp` / `addName`. Each helper bails early when its trigger is absent (`\`, `�`, `{`, trailing `?`/`+`/`*`, `(`/`{`/`}`), so plain routes skip the scanners. Keep those guards.

## Escapes

Any `\x` outside a constraint is a literal `x`, as in URLPattern (`/foo\.bar` matches `/foo.bar`, `\\` is a `\`). Inside a constraint it is regex (`(\d+)`). One escape model, in `operations/_utils.ts`, used by the router and `routeToRegExp` alike (#227):

- `encodeEscapes()` hides `\:` `\(` `\)` `\{` `\}` `\\` behind U+FFFD + their index in `ESCAPABLE` before splitting, so no scan reads them as syntax; `\\` is one of them so pairs read left to right (`\\:x` is `\` + `:x`). This also applies inside constraints (`\)` doesn't close one).
- Static keys (`segmentKey`): other `\x` → `x`, then `decodeEscapes(s, "")`.
- Dynamic segments (`getParamRegexp`): other `\x` outside a group → U+FFFE + `x` (`\*` stays an escape so it is no wildcard); placeholders decode to U+FFFE + char after params and groups are named; U+FFFE pairs then become regex-safe literals. Unescaped regex chars outside a group (`. ^ $ | [ ] ) { }`) are literals too, as in a static segment (`/api/*$`, `/x/^:id`, a stray `)`). A `:` inside a group becomes U+FFFE + `:`, so a `(?:…)` inside a constraint or unnamed group is never read as a param (the name replace skips it with a look-behind).
- `routeToRegExp` classifies segments with `segmentKey(encodeEscapes(s))`, reads modifiers from the encoded text too (`\:x?` has none), emits static keys regex-escaped and dynamic segments through `getParamRegexp` (with `_N` unnamed keys), so escapes can't drift between the two.

## Group delimiters `{…}`

`_group-delimiters.ts` expands `{…}` and `{…}?` before insert/remove/regexp. `scanFirstGroup()` is shared with `inlineOptionalGroup()` (`regexp.ts`) so both classify groups identically; it returns a `[pre, body, suf, mod]` tuple (smaller core bundle than an object).

## Reserved syntax

Syntax with no defined meaning throws `rou3: <what> (<route as written>)` (`invalidSyntax()`), so it can get a meaning later without a breaking change. Checks sit where the pipeline already looks:

- `checkConstraints` (route level): a U+FFFD-U+FFFF char, the internal placeholders (`encodeEscapes`' `\uFFFD`, `getParamRegexp`'s `\uFFFE`, the `:name*` marker `\uFFFF`), which a route could otherwise write as syntax (`/a/\uFFFD0x` was an escaped `:`, `/a/**:\uFFFFx` a `:x*`; checked in the same early bail); a `(` that does not close in its own segment, including a `/` inside a constraint (one message for both causes, bundle size); a `^` / `$` outside a class, a look-around or a numbered backreference (`\1`) in a constraint (the tree tests the segment alone, so they see its ends and count its groups; the inline regex sees the rest of the path and all its groups); a capturing group inside a constraint, unnamed or `(?<name>…)` (`/:x((a))`, `/a/((b)c)`, `/:n/:x((?<n>a))`: a stray param that could collide with a route param or unnamed key; groups are removed innermost-out and a capturing one leaves a `\0`, like a backreference, that its enclosing group trips on). Only `(?:…)` may sit inside a constraint. The compiler's `_normalizeGroups` fallback (a non-identifier group name) is now unreachable through `addRoute` and kept as a defensive path, pinned in `compiler.test.ts` with a hand-patched entry. Escapes are replaced by `_` (a backreference by `\0`) first, so `\(?=` is no look-ahead; after dropping escapes and constraints, a `\` that escapes nothing (`\/`, a trailing `\`) and unbalanced or nested `{}`. A stray `)` is literal.
- `expandGroupDelimiters`: `{…}+`, `{…}*`.
- `expandModifiers`: `+` / `*` on anything but a whole-segment `:name` (`:x(\d+)?` and `pre-:x?` are fine), and a `?` on a `**:name` (the `**` is no text before the param).
- `getParamRegexp` (depth 0): an invalid name after `:` (it reads the `\w` and non-ASCII run, so `:`, `:0`, `:1st` and `:café` all throw `invalid param name`); a group that is empty or starts with `?`; a raw `?` / `+` quantifier; a `*` right after a name, group or `*` (ambiguous with a modifier; `a**b`, `x**`: a mid-segment `**`, while a segment starting with `**` is split by `splitRoute`, `/**.md` = `/**\/*.md`).
- `_add`, static segment: an unescaped `?` (`/foo?`, `/a/b?/c`, `\:x?`): lookup paths never hold a query string, so it could never match. `\?` is a literal; `+` / `*` stay literal in a static segment (`/c++`). Shares `MISPLACED_MODIFIER` (which names the escape) with the modifier errors and the mid-segment `**` (one message, bundle size).
- `addName()`: a name that is not `[A-Za-z_]\w*`; a name repeated within one expansion (a bare `**` counts as `_`): `rou3: duplicate param name "x" (…)`. `getParamRegexp` records its names here while scanning, before any regex is built.

`routeToRegExp` validates by calling `addRoute` on a throwaway router, so every error is the router's. Deliberately accepted: stray `)`, `+` / `*` in static segments (`/c++`), `\b` / `\B` in a constraint (a segment end and a `/` are both non-word). Known gap: `(`/`)` inside a class in a constraint (`:x([(])`) is mis-parsed.

Pinned by `RESERVED_SYNTAX_ROUTES` (`test/_regexp-cases.ts`, against `addRoute`, `routeToRegExp`, `routeNodeKeys`), the accepted list in `regexp.test.ts`, and WPT `RESERVED_PATTERNS`.

## Params sharing a segment

URLPattern semantics, so the same pattern splits a segment the same way everywhere:

- **Lazy `:name`:** `getParamRegexp` emits `[^/]+?` for an unconstrained `:name` (it only sees segments that aren't a lone `:name`), so the first of several params takes as little as possible: `:a-:b` on `x-y-z` is `x` + `y-z`, `:name.:ext` on `a.tar.gz` is `a` + `tar.gz`, `:a:b` on `xyz` is `x` + `yz`. With one param the literals around it fix its value, so lazy vs greedy only shows with several. A `*` stays greedy `[^/]*` (URLPattern's `*` is a greedy `(.*)`): `*-:a` on `x-y-z` is `x-y` + `z`. A constraint keeps the user's quantifiers. The compiler reuses the tree's RegExps and `routeToRegExp` the same `getParamRegexp` source.
- **`pre-:x?`** (a `?` on a param that does not start its segment, `pre-:x(\d+)?` too) makes only the param optional: `expandModifiers` expands it to `pre-:x` and `pre-` (the text before the param, not a dropped segment), as `pre-{:x}?` would. A whole-segment `:x?` keeps its meaning (an optional segment); `/{pre-:x}?` is the way to drop the whole segment. `+` / `*` there still throw. `routeToRegExp` compiles it in place where it can (see [regexp.md](regexp.md#emission-rules)). This is URLPattern's reading, except where a greedy capture before the param could take its text: rou3 prefers the route with the param (`/*-:x?` on `/--` is `{0:"", x:"-"}`, URLPattern gives `{0:"-"}`).

## Param names and capture-group names

Name grammar everywhere: `[A-Za-z_]\w*`, as in URLPattern restricted to ASCII: a `-` ends a name (`:test-id` is `:test` + `-id`, `:year-:month` two params), a digit can't start one (`:0` would collide with the unnamed key `"0"`), and a non-ASCII char right after one throws (it may be part of the name in URLPattern; `:caf\é` is a literal). Sites to keep in sync: `addName`, `getParamRegexp` and `_add` (`add.ts`), `expandModifiers`, every `regexp.ts` site, `paramName()` / the name-extending-literal escape in `reverseSegment` (`regexp-to-route.ts`), `ExtractParams` / `TakeName` (`types.ts`; `ExtractParams` skips the `:` of `(?:`).

Named capture groups need identifiers, so every regex-emitting path goes through `_group-names.ts`:

- `toGroupName()`: valid identifiers pass unchanged; names in the `__rou3_` space and `_N`-shaped ones (the only route names that need it now) become `__rou3_esc_` + (`_` → `__`, `-` → `_h`). The `-` / non-identifier handling is kept so the codec stays total and injective for any string (older regexes, `regExpToRoute` input): a prefix code, unlike a `-` → `_` sanitize. Output is `[A-Za-z0-9_]` (PCRE-legal).
- `fromGroupName()`: the single inverse (also strips the unnamed prefix), used by `getMatchParams`, the compiler's `scanRegExpGroups`, `regExpToRoute`. The compiler's runtime `_normalizeGroups` fallback inlines a copy; keep it in sync.
- Emission sites: `getParamRegexp()` and the four in `regexp.ts` (plain, mixed segment, modifier, `**:name`).
