# Pattern syntax

`addRoute` pipeline: `checkConstraints` → `expandGroupDelimiters` → `encodeEscapes` / `splitRoute` → `expandModifiers` → per segment `getParamRegexp` / `addName`. Each helper bails early when its trigger is absent (`\`, `�`, `{`, trailing `?`/`+`/`*`, `(`/`{`/`}`), so plain routes skip the scanners. Keep those guards.

## Escapes

Two systems; their placeholders must not collide:

1. **Router** (`operations/_utils.ts`): `encodeEscapes()` turns `\:` `\(` `\)` `\{` `\}` into U+FFFD + a placeholder (A–E) before splitting; `decodeEscaped()` restores them for static keys. Other `\x` (e.g. `\*`) are handled by `segment === "\\*"` checks.
2. **Regex** (`_escape.ts`): `replaceEscapesOutsideGroups()` replaces `\x` outside `(...)` with U+FFFE (so `\d` inside `(\d+)` survives); `resolveEscapePlaceholders()` makes them regex-safe literals. Used by `routeToRegExp` and `getParamRegexp`.

## Group delimiters `{…}`

`_group-delimiters.ts` expands `{…}` and `{…}?` before insert/remove/regexp. `scanFirstGroup()` is shared with `inlineOptionalGroup()` (`regexp.ts`) so both classify groups identically; it returns a `[pre, body, suf, mod]` tuple (smaller core bundle than an object).

## Reserved syntax

Syntax with no defined meaning throws `rou3: <what> (<route as written>)` (`invalidSyntax()`), so it can get a meaning later without a breaking change. Checks sit where the pipeline already looks:

- `checkConstraints` (route level): a `(` that does not close in its own segment, including a `/` inside a constraint (one message for both causes, bundle size); after dropping escapes and constraints, unbalanced or nested `{}`. A stray `)` is literal.
- `expandGroupDelimiters`: `{…}+`, `{…}*`.
- `expandModifiers`: `+` / `*` on anything but a whole-segment `:name` (`:x(\d+)?` and `pre-:x?` are fine).
- `getParamRegexp` (depth 0): `:` without a name; a group that is empty or starts with `?`; a raw `?` / `+` quantifier; a `*` right after a name or group (ambiguous with a modifier).
- `addName()` in `_add`: a name that is not `\w+(?:-\w+)*`; a name repeated within one expansion (a bare `**` counts as `_`): `rou3: duplicate param name "x" (…)`.

`routeToRegExp` validates by calling `addRoute` on a throwaway router, so every error is the router's. Deliberately accepted: `pre-:x?` (drops the whole segment), `:x:y`, mid-segment `**` (`a**b`), stray `)`, `?`/`+` in static segments (`/c++`), digit names (`/w/:0/*`: collides with unnamed key `"0"`, later wins). Known gap: `(`/`)` inside a class in a constraint (`:x([(])`) is mis-parsed.

Pinned by `RESERVED_SYNTAX_ROUTES` (`test/_regexp-cases.ts`, against `addRoute`, `routeToRegExp`, `routeNodeKeys`), the accepted list in `regexp.test.ts`, and WPT `RESERVED_PATTERNS`.

## Param names and capture-group names

Name grammar everywhere: `\w+(?:-\w+)*` (a `-` only between word chars; `:x\-suf` ends a name before `-`). Sites to keep in sync: `addName`, `getParamRegexp` and `_add` (`add.ts`), `expandModifiers`, every `regexp.ts` site, `ExtractParams` / `TakeName` (`types.ts`).

Named capture groups need identifiers, so every regex-emitting path goes through `_group-names.ts`:

- `toGroupName()`: valid identifiers pass unchanged; anything else, plus names in the `__rou3_` space and `_N`-shaped ones, becomes `__rou3_esc_` + (`_` → `__`, `-` → `_h`). It is a prefix code, hence injective; a `-` → `_` sanitize is not (collisions → duplicate-group `SyntaxError`). Output is `[A-Za-z0-9_]` (PCRE-legal).
- `fromGroupName()`: the single inverse (also strips the unnamed prefix), used by `getMatchParams`, the compiler's `scanRegExpGroups`, `regExpToRoute`. The compiler's runtime `_normalizeGroups` fallback inlines a copy; keep it in sync.
- Emission sites: `getParamRegexp()` and the four in `regexp.ts` (plain, mixed segment, modifier, `**:name`).
