# Migrating from rou3 0.9 to 0.12

rou3 0.10, 0.11 and 0.12 align the route pattern syntax with [URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API) and make the router, the compiled matchers and `routeToRegExp` match exactly the same paths. This guide combines the migration notes of all three releases, so every "Before" column shows **0.9** behavior and every "After" column shows **0.12** behavior. Changes that a later release undid or replaced are left out.

Each section names the release that made the change. The full notes are in the GitHub releases: [v0.10.0](https://github.com/h3js/rou3/releases/tag/v0.10.0), [v0.11.0](https://github.com/h3js/rou3/releases/tag/v0.11.0), [v0.12.0](https://github.com/h3js/rou3/releases/tag/v0.12.0).

- [Checklist](#checklist)
- [Lookup paths](#lookup-paths)
  - [Pass the encoded pathname](#pass-the-encoded-pathname)
  - [Only one trailing slash is ignored](#only-one-trailing-slash-is-ignored)
  - [Named params never match an empty segment](#named-params-never-match-an-empty-segment)
  - [`.` / `..` segments in patterns are resolved](#---segments-in-patterns-are-resolved)
- [Wildcards](#wildcards)
  - [`*` is a greedy catch-all](#-is-a-greedy-catch-all)
  - [`**` has a numbered key, and `_` is deprecated](#-has-a-numbered-key-and-_-is-deprecated)
  - [Segments after a catch-all are matched](#segments-after-a-catch-all-are-matched)
  - [`(.*)` and `:name(.*)` are catch-alls](#-and-name-are-catch-alls)
  - [One catch-all per route](#one-catch-all-per-route)
- [Params](#params)
  - [A `-` ends a param name](#a---ends-a-param-name)
  - [Several captures in one segment](#several-captures-in-one-segment)
  - [`prefix-:param?` makes only the param optional](#prefix-param-makes-only-the-param-optional)
  - [Backslash escapes mean a literal character](#backslash-escapes-mean-a-literal-character)
  - [Regex constraints](#regex-constraints)
  - [Groups](#groups)
- [Patterns that now throw](#patterns-that-now-throw)
- [Router API](#router-api)
- [Types](#types)
- [Compiler](#compiler)
- [`routeToRegExp` and `regExpToRoute`](#routetoregexp-and-regexptoroute)
- [Overlap and `routeNodeKeys`](#overlap-and-routenodekeys)
- [Runtime](#runtime)

## Checklist

Most apps need only the first few items:

1. Look up routes with the raw, encoded pathname (`new URL(req.url).pathname`). Don't decode it first.
2. Check every `*` in your routes. It now spans segments: `/admin/*` matches `/admin/a/b`. Use `:name` for exactly one segment.
3. Replace `params._` with a named catch-all (`/**:path` → `params.path`) or `params["0"]`.
4. Rename params that contain `-` (`:user-id` → `:userId`).
5. Start your app once. Pattern syntax that used to be accepted with a surprising meaning now throws a `rou3:` error at `addRoute`, quoting the route. Fix each one using [Patterns that now throw](#patterns-that-now-throw).
6. If you use `routeToRegExp` as a guard, update snapshots and re-check: its output now matches exactly the paths the router matches.
7. Run on Node.js 20.19 or later.

## Lookup paths

### Pass the encoded pathname

_0.12 ([#231](https://github.com/h3js/rou3/pull/231))_

`addRoute` percent-encodes a pattern's literal text once, like URLPattern. Lookup paths are never decoded or encoded, so pass the pathname as it appears in the URL.

| Pattern | Path         | 0.9      | 0.12     |
| ------- | ------------ | -------- | -------- |
| `/café` | `/caf%C3%A9` | no match | match    |
| `/café` | `/café`      | match    | no match |
| `/a b`  | `/a%20b`     | no match | match    |

- Regex constraints are not encoded: write `:x(%C3%A9)`, not `:x(é)`.
- `routeToRegExp`, `routeNodeKeys` and the compiled matchers use the encoded text too (`routeToRegExp("/café")` is `^\/caf%C3%A9\/?$`).
- Param values are returned as they appear in the path (`/users/:id` on `/users/a%20b` gives `{ id: "a%20b" }`), as in 0.9. Decode them in your handler if you need to.

**Migrate:** stop calling `decodeURI()` / `decodeURIComponent()` on the path before `findRoute`.

### Only one trailing slash is ignored

_0.10 ([#210](https://github.com/h3js/rou3/pull/210))_

Lookup ignores **at most one** trailing slash, like the non-strict defaults of Express, find-my-way and Hono.

| Pattern      | Path           | 0.9              | 0.12             |
| ------------ | -------------- | ---------------- | ---------------- |
| `/users/:id` | `/users/123/`  | `{ id: "123" }`  | `{ id: "123" }`  |
| `/users/:id` | `/users/123//` | `{ id: "123" }`  | no match         |
| `/about`     | `/about//`     | match            | no match         |
| `/`          | `//`           | match            | no match         |

**Migrate:** to accept repeated trailing slashes, collapse them before lookup, e.g. `path.replace(/\/{2,}$/, "/")`.

### Named params never match an empty segment

_0.11 ([#230](https://github.com/h3js/rou3/pull/230)), 0.12 ([#232](https://github.com/h3js/rou3/pull/232), [#241](https://github.com/h3js/rou3/pull/241))_

A `:name` needs a value, and every segment a `:name+`, `:name*` or `**:name` takes needs one too (URLPattern's `[^/]+(?:/[^/]+)*`). Handlers no longer need to guard against `""` for these params.

| Pattern        | Path        | 0.9                | 0.12            |
| -------------- | ----------- | ------------------ | --------------- |
| `/foo/:bar/x`  | `/foo//x`   | `{ bar: "" }`      | no match        |
| `/a/:x*`       | `/a//`      | `{}`               | no match        |
| `/foo/:bar+`   | `/foo/a//b` | `{ bar: "a//b" }`  | no match        |
| `/foo/**:bar`  | `/foo//a`   | `{ bar: "/a" }`    | no match        |
| `/foo/:bar+`   | `/foo/a/b/` | `{ bar: "a/b" }`   | `{ bar: "a/b" }` (one trailing slash is still ignored) |

These paths now fall through to a less specific route, or to no match. `*`, `**`, `:name(.*)` and regex constraints may still take empty segments.

**Migrate:** to accept empty segments, use `*`, `**`, `:name(.*)`, or a constraint that allows empty, such as `:id(\d*)`.

### `.` / `..` segments in patterns are resolved

_0.12 ([#246](https://github.com/h3js/rou3/pull/246))_

`.` and `..` segments in a pattern (including `%2e` forms) are resolved when the route is added, the way `new URL()` resolves a path.

| Pattern       | Path          | 0.9      | 0.12     |
| ------------- | ------------- | -------- | -------- |
| `/foo/../bar` | `/bar`        | no match | match    |
| `/foo/../bar` | `/foo/../bar` | match    | no match |
| `/\.\./bar`   | `/../bar`     | no match | match (escaped dots stay literal) |
| `/:id/..`     |               | accepted | throws   |

- A dot segment next to a param, catch-all or group throws.
- `removeRoute` resolves dot segments too: `removeRoute(router, "GET", "/docs/../api")` removes `/api`.
- Lookup paths are unchanged. They are resolved only with `normalize: true`, which now drops a `..` that would go above the root (`/x/../../foo` → `/foo`, 0.10) and keeps the trailing slash after a trailing `.` / `..` like WHATWG URL (`/a//.` → `/a//`, 0.12).

**Migrate:** escape the dots (`\.\.`) to match a literal `..` segment.

## Wildcards

### `*` is a greedy catch-all

_0.12 ([#240](https://github.com/h3js/rou3/pull/240))_

`*` used to match one segment (`[^/]*`). It is now URLPattern's `*` (`(.*)`) and matches across `/`, also inside a segment. A trailing `/foo/*` still matches `/foo`.

| Pattern     | Path       | 0.9         | 0.12             |
| ----------- | ---------- | ----------- | ---------------- |
| `/foo/*`    | `/foo/a`   | `{ 0: "a" }` | `{ 0: "a" }`    |
| `/foo/*`    | `/foo/a/b` | no match    | `{ 0: "a/b" }`   |
| `/foo/*`    | `/foo/`    | `{}`        | `{ 0: "" }`      |
| `/foo/*`    | `/foo`     | `{}`        | `{}`             |
| `/*/x`      | `/a/b/x`   | no match    | `{ 0: "a/b" }`   |
| `/*.png`    | `/a/b.png` | no match    | `{ 0: "a/b" }`   |
| `/a/:x?/*`  | `/a/b`     | `{ 0: "b" }` | `{ x: "b" }`    |

- Rules keyed by a trailing `*` now apply at every depth: `"/admin/*": { auth: false }` covers `/admin/a/b`, not just `/admin/a`.
- A `*` before more of the route (`/*/x`) needs at least one segment, so it does not match `/x`.
- On the same node, `**` < `*` < `**:name` in `findAllRoutes` order.

**Migrate:**

- To match exactly one segment, use `/users/:id` (or `/users/:id?` to also match `/users`). For 0.9's exact behavior, use `/users{/([^\x2f]*)}?`.
- Inside a segment, replace `*` with `([^\x2f]*)`: `/*.png` becomes `/([^\x2f]*).png`.

### `**` has a numbered key, and `_` is deprecated

_0.12 ([#234](https://github.com/h3js/rou3/pull/234))_

A bare `**` is an unnamed capture, as in URLPattern. It is keyed `"0"`, `"1"`, … together with `*` and unnamed `(…)` groups, in pattern order across the whole pattern.

| Pattern   | Path       | 0.9            | 0.12                       |
| --------- | ---------- | -------------- | -------------------------- |
| `/foo/**` | `/foo/a/b` | `{ _: "a/b" }` | `{ 0: "a/b", _: "a/b" }`   |
| `/foo/**` | `/foo`     | `{ _: "" }`    | `{}`                       |

- `params._` still works but is **deprecated**.
- A `**` that matches zero segments leaves its key out (it used to set `_: ""`).
- Unnamed keys after a `**` shift up, and so do keys after an optional group holding unnamed captures (a left-out group still uses up its numbers): `/x{(\d+)}?/*` on `/x/b` gives `{ 1: "b" }`.
- In `routeToRegExp` output, the `**` group is named `_0`, `_1`, … instead of `_`.

**Migrate:** name the capture (`/foo/**:path` → `params.path`), or read `params["0"] ?? ""`.

### Segments after a catch-all are matched

_0.10 ([#216](https://github.com/h3js/rou3/pull/216))_

Segments after `**` used to be silently dropped, so `/a/**/b` behaved like `/a/**`. They are now matched from the end of the path.

| Pattern             | Path                       | 0.9                              | 0.12                               |
| ------------------- | -------------------------- | -------------------------------- | ---------------------------------- |
| `/**/_payload.json` | `/blog/post/_payload.json` | `{ _: "blog/post/_payload.json" }` | `{ 0: "blog/post", _: "blog/post" }` |
| `/a/**/b`           | `/a/x/y`                   | `{ _: "x/y" }`                   | no match                           |
| `/a/:x+/b`          | `/a/x/y`                   | `{ x: "x/y" }`                   | no match                           |
| `/**.md`            | `/a/b.md`                  | `{ _: "a/b.md" }`                | `{ 0: "a/b" }`                     |

- `/a/**/b` also matches `/a/b` (`**` over zero segments).
- `removeRoute(router, "GET", "/a/**/b")` no longer removes `/a/**`.
- On paths that a route with segments after a catch-all matches, matches are ranked from the last segment backwards (literal > regex param > param > catch-all). Routers without such routes rank as before.

**Migrate:** if you relied on the trailing segments being ignored, register `/a/**` instead.

### `(.*)` and `:name(.*)` are catch-alls

_0.12 ([#242](https://github.com/h3js/rou3/pull/242))_

A written `(.*)` is the same as `*`, and `:name(.*)` is a `*` keyed by `name`. Both match across segments, as `routeToRegExp` already did.

| Pattern       | Path       | 0.9      | 0.12           |
| ------------- | ---------- | -------- | -------------- |
| `/foo/(.*)`   | `/foo/a/b` | no match | `{ 0: "a/b" }` |
| `/foo/:p(.*)` | `/foo/a/b` | no match | `{ p: "a/b" }` |
| `/foo/:p(.*)` | `/foo/`    | no match | `{ p: "" }`    |

- `:p(.*)?`, `(.*)+` and other modifiers on these groups throw, as they do on `*`.
- Other constraints that can match `/` (`(.+)`, `(.*?)`, `([^x]*)`) still stay within one segment.

**Migrate:** for a single-segment value, use `:p` or `:p([^\x2f]*)`.

### One catch-all per route

_0.10 ([#216](https://github.com/h3js/rou3/pull/216)), 0.12 ([#240](https://github.com/h3js/rou3/pull/240), [#242](https://github.com/h3js/rou3/pull/242))_

A route can hold only one of `*`, `**`, `:x+`, `:x*`, `(.*)` or `:x(.*)`. A second one throws `rou3: a route can have only one ...`.

| Pattern                       | 0.9 on the path                              | Write instead                                    |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------ |
| `/**/**`, `/a/:x+/b/:y+`      | accepted                                     | one catch-all                                    |
| `/**/*.png`                   | `{ _: "a/b.png" }` on `/a/b.png`             | `/**/:file.png`                                  |
| `/file-*-*.png`               | `{ 0: "a", 1: "b" }` on `/file-a-b.png`      | `/file-:a-*.png`, or `([^\x2f]*)` for one of them |
| `/*/x/*`, `/*/**`, `/*/:p+`   | accepted                                     | a named `:param` for all but one                 |

## Params

### A `-` ends a param name

_0.11 ([#222](https://github.com/h3js/rou3/pull/222), [#230](https://github.com/h3js/rou3/pull/230))_

Param names are `[A-Za-z_]\w*`, as in URLPattern. A `-`, `{` or `}` ends a name.

| Pattern               | Path            | 0.9                                  | 0.12                              |
| --------------------- | --------------- | ------------------------------------ | --------------------------------- |
| `/api/:test-id`       | `/api/abc`      | `{ "test-id": "abc" }`               | no match                          |
| `/api/:test-id`       | `/api/abc-id`   | `{ "test-id": "abc-id" }`            | `{ test: "abc" }`                 |
| `/blog/:year-:month`  | `/blog/2024-05` | `{ "year-": "2024-0", month: "5" }`  | `{ year: "2024", month: "05" }`   |
| `/blog/:id{-:title}?` | `/blog/1-hi`    | `{ "id-": "1-h", title: "i" }`       | `{ id: "1", title: "hi" }`        |
| `/:a{b}?`             | `/xb`           | `{ ab: "xb" }`                       | `{ a: "x" }`                      |

`InferRouteParams` reads names the same way, so the types change too.

**Migrate:** rename params that contain `-`, e.g. `:test-id` → `:testId` or `:test_id`.

### Several captures in one segment

_0.11 ([#230](https://github.com/h3js/rou3/pull/230)), 0.12 ([#233](https://github.com/h3js/rou3/pull/233), [#236](https://github.com/h3js/rou3/pull/236), [#238](https://github.com/h3js/rou3/pull/238))_

As in URLPattern, a `:name` takes as little as it can, and a `*` or a regex constraint takes as much as it can. An optional `:name?` after a capture in the same segment is matched in place, so the capture before it takes what it can.

| Pattern        | Path        | 0.9                               | 0.12                              |
| -------------- | ----------- | --------------------------------- | --------------------------------- |
| `/:name.:ext`  | `/a.tar.gz` | `{ name: "a.tar", ext: "gz" }`    | `{ name: "a", ext: "tar.gz" }`    |
| `/:a-:b`       | `/x-y-z`    | `{ "a-": "x-y-", b: "z" }`        | `{ a: "x", b: "y-z" }`            |
| `/:a(\d+):b?`  | `/12`       | `{ a: "1", b: "2" }`              | `{ a: "12" }`                     |
| `/*-:x?`       | `/--`       | `{ 0: "", x: "-" }`               | `{ 0: "-" }`                      |

- After plain text nothing changes: `pre-:x?` matches `pre-` and `pre-<value>`.
- Constrained and literal in-segment params rank above plain ones on the same node, whatever the registration order: `/f/:name.png` and `/f/:name.:ext(png|jpg)` both beat `/f/:name.:ext` on `/f/a.png`.
- These segments now match in time linear in their length (closes the ReDoS class of CVE-2024-45296).

**Migrate:** to keep the old split, constrain the capture: `/:name.:ext(\w+)` gives `{ name: "a.tar", ext: "gz" }`, and `/:a(\d):b?` gives `{ a: "1", b: "2" }`.

### `prefix-:param?` makes only the param optional

_0.11 ([#230](https://github.com/h3js/rou3/pull/230))_

A `?` on a param that does not start its segment makes only that param optional, not the whole segment.

| Pattern      | Path       | 0.9        | 0.12           |
| ------------ | ---------- | ---------- | -------------- |
| `/a/pre-:x?` | `/a/pre-b` | `{ x: "b" }` | `{ x: "b" }` |
| `/a/pre-:x?` | `/a/pre-`  | no match   | match (no `x`) |
| `/a/pre-:x?` | `/a`       | match      | no match       |

**Migrate:** to make the whole segment optional, write `/a/{pre-:x}?`.

### Backslash escapes mean a literal character

_0.11 ([#228](https://github.com/h3js/rou3/pull/228))_

Outside a regex constraint, `\x` is a literal `x`, as in URLPattern. 0.9 kept the backslash in static segments, while `routeToRegExp` dropped it.

| Pattern     | Path       | 0.9      | 0.12         |
| ----------- | ---------- | -------- | ------------ |
| `/foo\.bar` | `/foo.bar` | no match | match        |
| `/a\*b`     | `/a*b`     | no match | match        |
| `/a/\(:x`   | `/a/(1`    | no match | `{ x: "1" }` |

`\\` is a literal backslash. A `\/` or a trailing `\` throws.

**Migrate:** if a route really needs a backslash in the path, write `\\`.

### Regex constraints

_0.11 ([#226](https://github.com/h3js/rou3/pull/226), [#228](https://github.com/h3js/rou3/pull/228)), 0.12 ([#245](https://github.com/h3js/rou3/pull/245))_

The router tests a constraint against one segment while `routeToRegExp` puts it inside a whole-path regex, so constructs that behave differently in the two now throw.

| Pattern                         | Problem                                        | Write instead                                                       |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `/:slug((?!admin)\w+)`          | look-around                                    | `/:slug(\w+)` plus a static `/admin` route (a static route always wins) |
| `/:x(^\d+$)`                    | anchor                                         | `/:x(\d+)` (constraints already match the whole segment)            |
| `/:x((a))`                      | capturing group inside a constraint            | `/:x((?:a))`                                                        |
| `/a/()`, `/a/(?:a\|b)`, `/a/(?<n>x)` | empty or `(?` group                       | `/a/:x((?:a\|b))`, `/a/:n(x)`                                       |
| `/:x([[a-z]--a])`               | `--` / `&&` in a class (URLPattern's `v`-flag set operations) | escape them: `[a\-\-z]`, `[a\&\&b]`                    |

Look-arounds have no direct replacement: register the excluded paths as their own routes, or check the value in your handler.

### Groups

_0.12 ([#236](https://github.com/h3js/rou3/pull/236), [#239](https://github.com/h3js/rou3/pull/239))_

A regex group right after a `{…}` group that ends in a param is an unnamed capture next to the param, not the param's constraint. A pattern that starts with a `{/…}` group no longer gets an extra `/` in front.

| Pattern       | Path         | 0.9                    | 0.12                         |
| ------------- | ------------ | ---------------------- | ---------------------------- |
| `/{:foo}(.*)` | `/foobarbaz` | `{ foo: "foobarbaz" }` | `{ foo: "f", 0: "oobarbaz" }` |
| `{/:a}?/b`    | `/b`         | no match               | `{}`                         |
| `{/:a}?/b`    | `/x/b`       | no match               | `{ a: "x" }`                 |
| `{/:a}?/b`    | `//b`        | `{}`                   | no match                     |

- `/{:foo}?(…)`, `/:foo{}(…)` and `/:foo{(x)}?` change the same way. Write the constraint on the param instead: `/:foo(.*)`.
- A `{:name}?` group that follows text and ends its segment is read as `:name?`: `/a/*{:x}?` is `/a/*:x?`.
- Text right after a leading `{/…}?` (`{/a}?b`, `{/:a}?.png`) throws.

## Patterns that now throw

`addRoute` (and `routeToRegExp`) throw `rou3: <what> (<route as written>)` for syntax that 0.9 accepted with a surprising meaning, so these show up at startup. Besides the catch-all, constraint, dot-segment and group cases above:

| Pattern                                  | 0.9                                                   | Write instead                                        |
| ---------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `/a/:x(\d+)+`, `/a/pre-:x+`              | dropped the constraint or prefix (`/a/:x(\d+)+` matched `/a/1/2` as `{ x: "1/2" }`) | `+` / `*` only after a whole-segment `:name` (`/a/:x+`) |
| `/a/**?`, `/a/*+`, `/:x??`, `/p/**:x?`   | accepted, with an unclear meaning                     | `/p/:x*` for an optional catch-all                   |
| `/foo?`                                  | never matched (lookup paths have no query)            | `/foo\?` for a literal `?`                           |
| `/a**b`                                  | read as two wildcards                                 | `/a*b`, or `/a\*\*b` for literal stars               |
| `/a/**:x.json`, `/a/**:x(\d+)`           | param named `"x.json"` / `"x(\d+)"`                   | a plain `**:name` as the whole last segment          |
| `/:0`, `/:1st`, `/:café`, `/:id$`        | accepted as names                                     | `/:v1`, `/:_1`, `/:cafe`, `/:id\$`                   |
| `/a/:`, `/a/x:`                          | literal `:`                                           | `/a/\:`                                              |
| `/a/:x/:x`, `/a/:x.:x`                   | later value won, or a raw `SyntaxError`               | unique names                                         |
| `/files/:path/**:path`, `/a/:_/**`       | duplicate name, raw `SyntaxError` in `routeToRegExp`  | unique names                                         |
| `/a/{b`, `/a/b}`, `/a/{{b}}`             | literal or mis-parsed braces                          | `\{` / `\}` for literal braces, no nested groups     |
| `/a/{b}+`, `/a{/b}*`                     | threw a non-`rou3:` error                             | not supported (only `{…}` and `{…}?`)                |
| `/a/(b` (a `(` that does not close in its segment) | threw a raw `SyntaxError`                   | close it, or escape it as `\(`                       |
| `/{:foo}{*}`, `/{:foo}?*`, `/{:foo}(x)?`, `/*{*}` | accepted                                     | write the modifier or constraint on the param        |
| a raw tab, LF or CR (`"/a\tb"`)          | accepted                                              | `%09`, `%0A`, `%0D` (or `\t`, `\n`, `\r` inside a constraint) |
| U+FFFD–U+FFFF in a pattern               | accepted                                              | not allowed (used internally)                        |

See [invalid patterns](./reference.md#invalid-patterns) for the full list.

## Router API

**Method-agnostic routes are no longer hidden by method routes** (0.11, [#223](https://github.com/h3js/rou3/pull/223)). A route added with method `""` could disappear when a route for a specific method landed on the same tree node, even if that route didn't match. Both are now always considered, and the more specific one wins. On a tie, the method route still wins.

```js
addRoute(router, "", "/u/*", "any");
addRoute(router, "GET", "/u/:id(\\d+)", "get");

findRoute(router, "GET", "/u/abc"); // 0.9: undefined    0.12: "any"
findAllRoutes(router, "GET", "/u/42"); // 0.9: ["get"]   0.12: ["any", "get"]
```

A `""` middleware or auth route is no longer silently dropped from `findAllRoutes` (or compiled `matchAll`), and a more specific `""` route now beats a broader method route.

**`removeRoute` removes only the route you pass** (0.10, [#202](https://github.com/h3js/rou3/pull/202)). Removing `/a/:id` used to also remove `/a/:userId`, and removing `/a/**` also removed `/a/**:rest`. If you relied on that, call `removeRoute` once per registered pattern.

**`findAllRoutes` lists each `addRoute` call once** (0.12). `/a/:x?/:y?` on `/a/b` used to be returned twice (`{ x }` and `{ y }`); it is now returned once, with the variant `findRoute` picks.

**Results** (0.11, [#219](https://github.com/h3js/rou3/pull/219)):

- `findRoute` and `findAllRoutes` return a fresh `{ data, params }` object on every call. Static matches no longer expose internal fields (such as `paramsRegexp`), and mutating a result no longer affects later lookups.
- Falsy route data (`0`, `false`, `""`) is returned as-is instead of `null`. Missing data is still `null`.

`RouterContext` properties are marked `@internal` (0.12). Don't read or write the router's tree directly.

## Types

- `InferRouteParams` types optional params (`:id?`, `:id*`) and a trailing whole-segment `*`, `(.*)` or `:name(.*)` as `string | undefined` (0.10, [#198](https://github.com/h3js/rou3/pull/198); 0.12). Handle `undefined`, e.g. `params.id ?? ""`.
- Names are read like the router: constraints and modifiers are stripped (`:id(\d+)` → `id`), and `-` ends a name (`/blog/:year-:month` → `{ year, month }`).
- A bare `**` key is `string | undefined`, plus a deprecated `_?: string`. `**<text>` is one key.
- `compileRouter<T>(router, { matchAll: true })` is typed as returning an array (0.11).
- `RouterCompilerOptions` is deprecated in favor of `CompileRouterToStringOptions` and `CompileRouterOptions` (0.11).

## Compiler

_0.11 ([#225](https://github.com/h3js/rou3/pull/225))_

`compileRouterToString` takes an options object: `compileRouterToString(router, { functionName, matchAll, serialize })`. The `(router, "name", opts)` form still works but is deprecated.

Route data in the generated code always goes through `JSON.stringify`, so the output is always valid code:

| Route data                                          | 0.9 output                              | 0.12 output                       |
| --------------------------------------------------- | --------------------------------------- | --------------------------------- |
| `new Date(0)`                                       | invalid code                            | `"1970-01-01T00:00:00.000Z"`      |
| `{ toJSON: () => ({ a: 1 }) }`                      | invalid code                            | `{ a: 1 }`                        |
| `{ toJSON: () => "code" }`                          | emitted `code` as raw JS                | the string `"code"`               |
| a function, symbol or bigint (anywhere in the data) | silently dropped, or a raw `TypeError`  | throws a `rou3:` error            |

**Migrate:** if your data contains functions or used `toJSON()` to emit code, pass `serialize: (data) => "<js expression>"`.

## `routeToRegExp` and `regExpToRoute`

`routeToRegExp(p)` now matches exactly the paths `findRoute` matches on a router holding only `p`, so it is safe to use as a guard. If you use it for scope or permission checks, upgrade.

- `/api/**` no longer matches `/apifoo` (0.10).
- Catch-alls match line terminators the way the router does (0.10). In 0.9, `/admin/**:p` didn't match `/admin/x\ry`, which the router routed.
- Segments after `**` are kept (0.10).
- All the router changes above apply: `*` spans segments, literal text is percent-encoded, `:name+` / `:name*` / `**:name` use `[^/]+(?:/[^/]+)*`, and `**` groups are named `_0`, `_1`, … instead of `_`.
- **The regex text changed for almost every route.** Update snapshots and string comparisons. Most routes no longer use look-behind, so the regexes also compile in RE2, Go `regexp` and Rust `regex`. Output for segments with several params no longer backtracks polynomially.
- An empty required segment at the end (`/a/:x` on `/a//`) used to leave its group `undefined`; the route no longer matches at all.
- On engines without duplicate named groups (Node 20 / 22), a group right before or after a trailing `*` that can't be inlined throws `rou3: the regex for "…" repeats a named group…` (`/{b}?/*`, `/files/*{.:ext}?/raw`).

`regExpToRoute` (0.11, [#218](https://github.com/h3js/rou3/pull/218); 0.12):

| Input                        | 0.9                 | 0.12     |
| ---------------------------- | ------------------- | -------- |
| `/\/users\/(?<id>\d+)/`      | `/users/:id(\d+)`   | throws (unanchored) |
| `/^\/users/`                 | `/users`            | throws (unanchored) |
| `/^\/a\/(?<x>\p{L}+)$/u`     | `/a/:x(\p{L}+)`     | throws (`u` / `v` flag) |
| `/^\/users$/`                | `/users`            | `/users` |

- It reads regexes from older `routeToRegExp` versions (old `_` groups included), except output for patterns that now throw, such as `:x(\d+)+`. Some routes come back in an equivalent form, e.g. `/a/:x?/:y?` → `/a{/:x/:y?}?`, and an unnamed catch-all comes back as `**`.
- It throws on a literal char that a route would encode, on a raw tab/LF/CR or `--` / `&&` inside a constraint class, and on a hand-written trailing `\/([^/]*)\/?$`, which no route matches anymore.

**Migrate:** anchor hand-written regexes with `^…$` and drop the `u` / `v` flags.

## Overlap and `routeNodeKeys`

- `findOverlappingRoutes` reports a route with optional parts once, and reports distinct routes separately even when they share the same data object (0.11, [#220](https://github.com/h3js/rou3/pull/220)).
- `compareRoutes("/a/*", "/a/**")` is `"equal"` (it was `"subset"`), since `*` is now a catch-all. `/a/:x*` equals `/a{/**:y}?` and is a subset of `/a/**` (0.12).
- `routeNodeKeys("/a/*")` gives `["/a/**"]`, and param segments are keyed `:_0`, `:_1`, … (0.12).

## Runtime

`package.json` declares `"engines": { "node": ">=20.19.0" }` (0.11, [#224](https://github.com/h3js/rou3/pull/224)).
