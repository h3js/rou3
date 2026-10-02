# rou3 reference

The details behind the [README](../README.md): the pattern edge cases, how rou3 differs from URLPattern, the full ordering rules, and the internals of `routeToRegExp` / `regExpToRoute`. Start with the README; come here when a pattern or a result surprises you.

- [Route patterns](#route-patterns)
  - [Several captures in one segment](#several-captures-in-one-segment)
  - [Param naming rules](#param-naming-rules)
  - [Wildcards in detail](#wildcards-in-detail)
  - [Groups at the start of a pattern](#groups-at-the-start-of-a-pattern)
  - [Dot segments](#dot-segments)
  - [Percent-encoding](#percent-encoding)
  - [Invalid patterns](#invalid-patterns)
  - [Differences from URLPattern](#differences-from-urlpattern)
- [Matching](#matching)
  - [Trailing slashes and empty segments](#trailing-slashes-and-empty-segments)
  - [Path normalization](#path-normalization)
  - [Detailed ordering rules](#detailed-ordering-rules)
  - [Removing routes](#removing-routes)
- [Pattern overlap: precision and limits](#pattern-overlap-precision-and-limits)
- [Regular expressions](#regular-expressions)
  - [What `routeToRegExp` doesn't model](#what-routetoregexp-doesnt-model)
  - [Regex output and engine support](#regex-output-and-engine-support)
  - [What `regExpToRoute` accepts](#what-regexptoroute-accepts)

## Route patterns

### Several captures in one segment

As in URLPattern, a `:name` takes as little as it can, and a `*` or a regex constraint takes as much as it can (`/` included for a `*`):

| Pattern        | Path        | Params                         |
| -------------- | ----------- | ------------------------------ |
| `/:a-:b`       | `/x-y-z`    | `{ a: "x", b: "y-z" }`         |
| `/:name.:ext`  | `/a.tar.gz` | `{ name: "a", ext: "tar.gz" }` |
| `/*-:a`        | `/x-y-z`    | `{ "0": "x-y", a: "z" }`       |
| `/*-:a`        | `/x/y-z`    | `{ "0": "x/y", a: "z" }`       |
| `/*-:x?`       | `/--`       | `{ "0": "-" }`                 |
| `/:a(\\d+):b?` | `/12`       | `{ a: "12" }`                  |

A group holding only the param works the same: `/*-{:x}?` is `/*-:x?`.

The router matches such a segment in time linear in its length (before 0.12, `/blog/:year-:month-:day.html` on a long run of `-` took seconds). A regex constraint keeps its own cost and may still try its matches against the params after it (`/:a(\\d+):b:c.json`).

### Param naming rules

- A name starts with a letter or `_`, followed by letters, digits or `_` (`[A-Za-z_][A-Za-z0-9_]*`), as in URLPattern. `:v2` and `:_0` are names; `:0` and `:1st` throw.
- Any other ASCII character except `$` ends a name, `-` included. `/blog/:year-:month` has two params, and `/users/:user-id` is the param `user` followed by the text `-id` (write `:user_id` for one param).
- A non-ASCII character or `$` right after a name throws (`/:café`, `/:id$`), because URLPattern reads it as part of the name. To end the name before it, escape it: `/:caf\\é` is the param `caf` followed by `é`, and `/:id\\$` is `id` followed by `$`.
- A group's `{` or `}` also ends a name: `/:a{b}?` is the param `a` followed by an optional `b`. A regex right after a group is a separate unnamed capture, not the param's constraint: `/{:foo}(\\d+)` on `/a12` gives `{ foo: "a", 0: "12" }` (the param takes as little as it can, as in URLPattern).
- A name can appear only once per route: `/a/:x/:x` throws.
- A `:` must start a name. Write a literal colon as `\\:`.
- `+` and `*` only follow a param that fills its whole segment: `:id(\d+)+` and `pre-:x+` throw.
- A `?`, `+` or `*` right after a param, constraint, group or `*`, inside a following group, throws: `/{:foo}{*}`, `/{:foo}?*`, `/{:foo}(x)?`, `/:id(\\d+){?}`, `/*{*}`.
- Inside a regex constraint, group with `(?:…)`: a capturing group throws (`/:x((a))`, `/:x((?<n>a))`).

### Wildcards in detail

**`*`**

- A trailing `*` is optional also when it ends one variant of a route with optional parts: `/a/*/:x?` and `/a/*{.png}?` match `/a`, and `/a{/b/*}?` matches `/a/b`.
- Elsewhere, a `*` takes one or more segments: `/files/*/raw` doesn't match `/files/raw`.

**`(.*)` and `:name(.*)`** are the same as `*`, as in URLPattern.

- `/files/(.*)` is `/files/*`, also inside a segment (`/files/(.*).png`). Write `(.*)` where a `*` would read as a modifier: after a param or group (`/:id(\\d+)(.*)`, `/{:name}(.*)`).
- `:name(.*)` captures into `name` instead of a numbered key: `/files/:path(.*)` on `/files/a/b` gives `{ path: "a/b" }`. Unlike `:name+`, it can be empty: `/files/` gives `{ path: "" }`, and `/files` gives `{}`.
- Other regexes that can match `/` (`(.+)`, `(.*?)`, `([^x]*)`) stay within their segment.

**`**`**

- Over zero segments, it sets no key: `/docs/**` on `/docs` and `/docs/` gives `{}`. An empty segment is `""`: `/docs//` gives `{ "0": "", _: "" }`.
- At the end of a route, it matches the same paths as `*`. The one difference is the capture on `/docs/`: `*` gives `""`, `**` no key. Where both are registered, `*` wins.
- Before more of the route, it can match zero segments: `/docs/**/x` matches `/docs/x` (`/docs/*/x` doesn't).
- Followed by text in its segment, it reads as `*`, as in URLPattern: `/**.md` is `/*.md`, any path ending in `.md`. Anywhere else in a segment, `**` throws (`/a**b`, `/a/x**`): write `*`, or `\\*\\*` for a literal `**`.

**`**:name`** is the same as `:name+`: one or more segments into `name` (`/docs/**:path`). Like a `:name`, it needs a value, and so does each segment it takes: `/docs//` and `/docs/a//b` don't match (see [empty segments](#trailing-slashes-and-empty-segments)).

**One catch-all per route.** `*`, `**`, `**:name`, `(.*)`, `:name(.*)`, and a `:name+` / `:name*` that is not the last segment each count as one: `/*/x/*`, `/*/**`, `/file-*-*.png` and `/:a(.*)/(.*)` throw. Write `/:a/x/*` to capture one segment and the rest. A modifier on a catch-all throws too (`*?`, `(.*)?`, `:path(.*)?`).

**Numbered keys.** Unnamed captures (`*`, `**` and `(regex)`) are numbered in pattern order, as in URLPattern. A capture in an optional group still takes its number when the group is left out:

- `/(\\d+)/x/**` on `/1/x/b/c` gives `{ "0": "1", "1": "b/c", _: "b/c" }`.
- `/a{/(\\d+)}?/*` on `/a/x/y` gives `{ "1": "x/y" }`.

**The deprecated `_`.** It is the name rou3 0.11 and older used for a bare `**`'s capture, kept so `params._` still works. It is left out over zero segments (0.11 gave `""`), it can't be a param name next to a bare `**` (`/:_/**` throws), and `routeToRegExp` has no `_` group.

### Groups at the start of a pattern

- A group that starts with `/` is part of the path, as in URLPattern: `{/:lang}?/docs` matches `/docs` and `/en/docs`, and `{/:lang}?` matches `/` and `/en`.
- A pattern that doesn't start with `/` gets one: `users/:id` is `/users/:id`. So does each variant of a leading group without one: `{v2}?/api` matches `/v2/api` and `/api`.
- `/{/:lang}?/docs` starts with an empty segment: it matches `//docs` and `//en/docs`.
- Text right after a leading `{/…}?` throws (`{/a}?b`, `{/:id}?.png`, `{/a}?{.json}?`): without the group, the route would not start with `/`. Follow the group with `/`, another `{/…}` group, or nothing.

### Dot segments

`.` and `..` segments in a pattern are resolved like `new URL()` resolves a path, as in URLPattern: `/docs/../api/:id` is `/api/:id`, `/a/./b` is `/a/b`, and a `..` at the root stays there (`/../a` is `/a`). Percent-encoded dots count too (`%2e`, `.%2E`, `%2e%2e`). Escape a dot to keep the segment literal: `/raw/\\.\\./etc` matches `/raw/../etc` (lookup paths are never resolved unless you pass [`normalize`](#path-normalization)).

URLPattern resolves each part of a pattern on its own, so next to a param its result is no longer a path (`/:id/..` stays `/:id/`, `/a/../:id` becomes `//:id`). rou3 throws instead when:

- a `..` would remove a segment that isn't plain text (`/:id/..`, `/*/..`, `/a/{b}?/..`);
- a `.` or `..` comes right before a segment that starts with a param, a catch-all or a regex group (`/a/../:id`, `/a/./*`);
- a `.` or `..` segment is inside a `{...}` group or touches one (`/a{/..}?/b`, `/a/{..}/b`, `/a/..{x}?`).

### Percent-encoding

The literal text of a pattern is percent-encoded once, when the route is added, the same way URLPattern and `new URL()` encode a pathname. Lookup paths are **never** decoded or encoded, so pass the encoded pathname (`new URL(req.url).pathname`).

- **Encoded:** control characters, space, `"`, `#`, `<`, `>`, `?`, `^`, `` ` ``, `{`, `}`, and every non-ASCII character (as UTF-8, upper-case hex: `é` is `%C3%A9`). Escaped characters too: `\\?` matches `%3F`, `\\{` matches `%7B`.
- **Not encoded:** `%`, so an existing `%xx` stays as written (`/caf%c3%a9` matches only `/caf%c3%a9`, not `/caf%C3%A9`), and other ASCII characters (`/a|b[c]` stays as is).
- **Regex constraints are not encoded:** write `:x(%C3%A9)`, not `:x(é)`.
- A lone surrogate is encoded as U+FFFD (`%EF%BF%BD`), as in URLPattern.
- **Tab, newline (LF) and carriage return (CR) throw**, also in a regex constraint: URLPattern drops them from a pattern, so encoding them would match different paths. Write `%09`, `%0A` or `%0D`.
- `^` is encoded, following the URL spec (as Node.js and Bun do). Deno (2.9) leaves it as is in `new URL().pathname` (`/a^b`), so on Deno, encode it before a lookup (`pathname.replaceAll("^", "%5E")`) if a route has a literal `^`.

Every API sees the encoded text: `removeRoute`, `routeToRegExp`, `routeNodeKeys`, the overlap helpers and the compiler. `/café` and `/caf%C3%A9` are the same route, and so are `/café-:id` and `/caf%C3%A9-:id`. Regex constraints are not encoded, so `:x(é)` and `:x(%C3%A9)` stay different routes.

### Invalid patterns

`addRoute` throws a `rou3:` error that quotes the pattern when the syntax has no clear meaning, instead of silently matching something unexpected:

- An unclosed `(` or `{`, a nested group, or an empty group `()`.
- A modifier in the wrong place: `*?`, `**+`, `(.*)?`, `:x(.*)?`, `:x.png?`, `{...}+`, `{...}*`.
- A `?` after plain text (`/foo?`): lookup paths have no query string. Escape a literal `?` as `\\?`.
- A `**` in the middle of a segment (`/a**b`).
- An invalid or repeated param name: `/:0`, `/:café`, `/:id$`, `/a/:x/:x`.
- A second catch-all.
- A `\/`.
- Text right after a leading `{/…}?` group (`{/a}?b`).
- A tab, newline or carriage return (write `%09`, `%0A`, `%0D`).
- A `.` or `..` segment next to a param, catch-all or group (`/:id/..`, `/a/../:id`, `/a{/..}?/b`, see [dot segments](#dot-segments)).
- A character from U+FFFD to U+FFFF (used internally).
- In a regex constraint:
  - a capturing group, also in a class (`/:x((a))`, `/:x([(a)])`): use `(?:…)`, or escape a class paren (`[\\(]`);
  - a `--` or `&&` inside a class (`/([[a-z]--a])`, `/:x([\\w&&b])`): URLPattern reads it as a set operation (`v` flag), rou3's RegExp as plain chars. Escape a literal one (`[a\\-\\-b]`);
  - an anchor (`^`, `$`), a look-around or a numbered backreference (`\1`). The router tests a constraint against its segment alone, while `routeToRegExp` puts it inline, where it would see the rest of the path, so the two would match different paths.

### Differences from URLPattern

rou3 matches HTTP request paths segment by segment in a tree. That leads to a few intentional differences:

| Feature                                                       | URLPattern                                                   | rou3                                                                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trailing slash                                                | Part of the path (`/foo/*` on `/foo/a/` gives `{ 0: "a/" }`) | One trailing slash is ignored (`{ 0: "a" }`)                                                                                                                                       |
| Trailing `*` (`/api/*`, also `(.*)`, `:name(.*)`)             | Required: no match on `/api`                                 | Optional: matches `/api` (no key), so a middleware on `/api/*` covers `/api`. For a required one, use `/api/:path+`                                                                |
| Catch-alls per route                                          | Any number (`/*/x/*`)                                        | One (more throw): write `/:a/x/*`                                                                                                                                                  |
| Modifiers on a catch-all (`*?`, `(.*)?`)                      | Supported                                                    | Throw (a trailing `*` is optional anyway)                                                                                                                                          |
| Repeated groups (`{...}+`, `{...}*`)                          | Supported                                                    | Throw                                                                                                                                                                              |
| Class set operations (`/([[a-z]--a])`, `/([\\d&&[0-1]])`)     | Difference / intersection (`v` flag)                         | Throw: rou3 compiles without the `v` flag, where they would be plain chars. Escape a literal one (`[a\\-\\-b]`)                                                                    |
| Regexes that can match `/` (`(.+)`, `(.*?)`)                  | Can span segments                                            | Stay within their segment (`(.*)` is a `*`). `routeToRegExp` spans segments, see [Regular expressions](#regular-expressions)                                                       |
| Optional segment after a catch-all (`/*/:x?` on `/x/y`)       | The catch-all takes it: `{ 0: "x/y" }`                       | Segments after a catch-all match from the end: `{ 0: "x", x: "y" }`                                                                                                                |
| Optional segment before a trailing `*` (`/a/:x?/*` on `/a/b`) | The `*` takes it: `{ 0: "b" }` (as in rou3 0.11)             | The optional segment takes it: `{ x: "b" }` (`routeToRegExp` too)                                                                                                                  |
| Patterns without a leading `/` (`users/:id`)                  | Relative: never match a pathname                             | Read as `/users/:id`                                                                                                                                                               |
| `.` and `..` segments                                         | Resolved                                                     | Resolved in patterns (an escaped one is literal; next to a param or group they throw, see [dot segments](#dot-segments)). Not resolved in input paths unless `{ normalize: true }` |
| Case                                                          | Can be case-insensitive                                      | Always case-sensitive                                                                                                                                                              |
| Input paths                                                   | Any URL; percent-encoded for you                             | Must start with `/` and be percent-encoded already (`new URL().pathname`); never decoded                                                                                           |
| Param names                                                   | Unicode identifiers                                          | ASCII `[A-Za-z_]\w*`; a non-ASCII char or `$` right after one throws                                                                                                               |
| Tab, LF or CR in a pattern                                    | Dropped (`/a\tb` is `/ab`)                                   | Throw: write `%09`, `%0A` or `%0D`                                                                                                                                                 |

**Edge cases:**

| Case                                                                                  | URLPattern                                                     | rou3                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/foo/*` on `/foo//`                                                                  | `{ 0: "/" }`                                                   | `{ 0: "" }` (the trailing slash is ignored)                                                                                                                                            |
| `/foo/**` on `/foo/`                                                                  | `{ 0: "" }`                                                    | `{}` (zero segments). Elsewhere `**` gives the same key and value (and the deprecated `_`)                                                                                             |
| `/a/*{/b}?` on `/a/x/b` (optional group after a catch-all)                            | `{ 0: "x/b" }`                                                 | `{ 0: "x" }`; likewise `/:a+/:b?` on `/x/y` gives `{ a: "x", b: "y" }`                                                                                                                 |
| `{/:a}?/*` on `/b` (optional segment before a trailing `*`)                           | `{ 0: "b" }`                                                   | `{ a: "b" }`                                                                                                                                                                           |
| `/:x?/a/*` on `/a/a/b` (optional segment before a static one)                         | `{ x: "a", 0: "b" }` (left to right, as `routeToRegExp` gives) | `{ 0: "a/b" }`: a static segment beats a param, so the route without the optional one wins (`**` too)                                                                                  |
| `/\\.\\./bar` (escaped dot segment)                                                   | Resolved: `/bar`                                               | Literal: matches `/../bar` only. URLPattern can't write a literal dot segment (its input paths have none)                                                                              |
| `{v2}?/api` (leading group without `/`)                                               | Matches `/api` only (`v2/api` is relative)                     | Each variant gets a `/`: matches `/v2/api` and `/api`                                                                                                                                  |
| `/*{.webp}?` on `/a.webp` (optional text after a greedy capture)                      | `{ 0: "a.webp" }`                                              | `{ 0: "a" }`: the route with the group wins                                                                                                                                            |
| `/*-{:x}?(y)` on `/a--y` (group holding a param, before more of its segment)          | `{ 0: "a-", 1: "y" }`                                          | `{ 0: "a", x: "-", 1: "y" }`. A group holding only a param that ends its segment is that param, as in URLPattern (`/*-{:x}?` is `/*-:x?`, `/a/*{:x}?` is `/a/*:x?`)                    |
| `/:foo{x}?(.*)` on `/abx` (optional group before more of its segment)                 | `{ foo: "a", 0: "bx" }`                                        | `{ foo: "ab", 0: "" }`: the route with the group wins                                                                                                                                  |
| `/{:foo}{(\\d*)}?` on `/a` (optional group that can match nothing)                    | `{ foo: "a" }`                                                 | `{ foo: "a", 0: "" }`; `routeToRegExp` leaves it unset, like URLPattern                                                                                                                |
| `/{:foo}?{(\\d+)}?` on `/1` (several optional groups in a segment)                    | `{ foo: "1" }`                                                 | `{ 0: "1" }`: each variant is a route, and a regex param beats a plain `:foo`; `routeToRegExp` gives `{ foo: "1" }`                                                                    |
| `/a/(\\d*)`, `/a/*:x?`, `/a/*(\\d*)` on `/a/` (empty capture before a trailing slash) | Match with `""`                                                | No match: the trailing slash is ignored, so there is no segment left. Only a whole-segment `*` (`/a/*`, `/a/*{.png}?`) matches there. `/a//` matches (`/a/*(\\d*)`: `{ 0: "", 1: "" }`) |

## Matching

### Trailing slashes and empty segments

The rules are in the [README](../README.md#trailing-slashes-and-empty-segments). Side by side:

```js
addRoute(router, "GET", "/admin/:id", {});
addRoute(router, "GET", "/files/:path+", {});
addRoute(router, "GET", "/docs/:path*", {});
addRoute(router, "GET", "/raw/*", {});

findRoute(router, "GET", "/admin/"); // undefined (the trailing slash is ignored)
findRoute(router, "GET", "/admin//"); // undefined (an empty segment)
findRoute(router, "GET", "/files//"); // undefined
findRoute(router, "GET", "/files///"); // undefined (two empty segments)
findRoute(router, "GET", "/files/a//b"); // undefined (an empty segment inside the value)
findRoute(router, "GET", "/files/a/b/"); // params: { path: "a/b" } (the trailing slash is ignored)
findRoute(router, "GET", "/docs"); // matches, no `path`
findRoute(router, "GET", "/docs//"); // undefined
findRoute(router, "GET", "/raw"); // params: {} (a trailing `*` is optional)
findRoute(router, "GET", "/raw/"); // params: { "0": "" }
findRoute(router, "GET", "/raw//"); // params: { "0": "" } (the trailing slash is ignored)
```

### Path normalization

With `{ normalize: true }`, only literal `.` and `..` segments are resolved: percent-encoded dots (`%2e`, `%2E%2E`, `.%2e`) are left as they are, since lookup paths are never decoded. `new URL()` resolves those too (`/a/%2e%2e/b` is `/b`), so a `new URL().pathname` has none left.

As in `new URL()`, a last `.` or `..` leaves a trailing slash: `/foo/bar/..` is `/foo/`, which `/foo/*` matches (`{ "0": "" }`). An empty segment before it is kept: `/a//.` is `/a//`, which doesn't match `/a`, and `//.` and `//x/..` are `//`, which doesn't match `/`.

### Detailed ordering rules

The short version and the guarantee are in the [README](../README.md#result-ordering).

- **Across the tree:** at each level, catch-all (`*`, `**`) matches come first, then params (`:name`), then static segments. Broader and shallower routes come before more static and deeper ones.
- **Routes on the same tree node** (for example `/foo/:id` and `/foo/:id(\d+)`, or `/foo/**`, `/foo/*` and `/foo/**:rest`, see [Route node keys](../README.md#route-node-keys)):
  - Optional and unconstrained routes come before required and regex-constrained ones.
  - Among catch-alls: `**`, then a trailing `*` (it matches the same paths), then `**:name` (it needs a value).
  - Between segments that mix params and text (`/f/:name.:ext`), the one with more literal text comes last, then the one with more regex constraints, then the one with fewer captures that may be empty (a `*`, an optional `:x?`). On `/f/a.png`: `/f/:name.:ext`, `/f/:name.:ext(png|jpg)`, `/f/:name.png`, whatever the registration order.
  - Ties keep registration order.
  - Method-agnostic routes are sorted together with the method's own routes. On a tie, the method-agnostic one comes first, so `findRoute` picks the method's own.
  - An optional param inside a segment (`/e/:a:b?`) makes the segment one regex-constrained route. On its node it beats a plain `:id` sibling on every path, also on deeper routes (`/e/:a:b?/x` beats `/e/:id/x`, though both match the same paths), and it comes before `/e/:id(\d+)` (a constraint ranks higher).
- **Consistent with containment:** when no pattern uses optional syntax and each pattern contains the next (a `"superset"` per [`compareRoutes`](../README.md#pattern-overlap)), the result order is broadest first, except for the catch-all carve-out below.
- **Carve-out: optional syntax.** A pattern with `:name?`, `:name*` or `{...}?` registers one entry per variant, and results are ordered by the variant that matched (the one `findRoute` picks, when several do), not by the whole pattern. So a broader pattern can come **last**:

  ```js
  const router = createRouter();
  addRoute(router, "GET", "/admin", { name: "admin" });
  addRoute(router, "GET", "/admin/:page?", { name: "admin-page" }); // superset of "/admin"

  findAllRoutes(router, "GET", "/admin").map((m) => m.data.name);
  // ["admin", "admin-page"] (the broader pattern is last)
  ```

  Both routes match `/admin` with an identical entry, so registration order decides: adding `/admin/:page?` first swaps them. A pattern is also listed by the variant `findRoute` picks when a broader one matches too: `/p/*{/p}?` contains `/p/p/:x`, but on `/p/p/p` it comes after it, as `/p/*/p` (a literal last segment ranks higher, see below), not before it as `/p/*`. If you need a strict pattern-level order with optional syntax, sort the result with [`compareRoutes`](../README.md#pattern-overlap).

- **Carve-out: `:name+` vs. a param followed by a catch-all.** No segment of a `:name+`, `:name*` or `**:name` can be empty, so a route with a `:name` and then a `*` / `**` over the same segments is broader (`/p/:id/**` also takes `/p/a//b`). Wildcards still come before params, so the narrower route comes first and `findRoute` picks the broader one:

  ```js
  const router = createRouter();
  addRoute(router, "GET", "/p/:id/**", { name: "id-rest" }); // superset of "/p/:path+"
  addRoute(router, "GET", "/p/:path+", { name: "path" });

  findAllRoutes(router, "GET", "/p/a/b").map((m) => m.data.name);
  // ["path", "id-rest"] (the broader pattern is last)
  ```

  The same holds after a catch-all (`/**/:name/x` contains `/**:path/x`). Sort the result with [`compareRoutes`](../README.md#pattern-overlap) if you need the strict order.

- **Segments after a catch-all:** a route like `/**/_payload.json` or `/*.png` is anchored at the end of the path. On every path such a route matches, all matches are ranked **from the last segment backwards**:
  - A literal segment beats a regex-constrained param, which beats a plain param or a segment covered by `**`.
  - A segment of captures alone with at most one required `:name` (`*:a`, `:a:b?`, `*:x?`) restricts nothing more, so it ranks as a plain param: `/b/:id` beats `/**/:a:b?` on `/b/x`.
  - Ties fall back to the rules above.
  - Paths that no such route matches are not affected:

  ```js
  const router = createRouter();
  addRoute(router, "GET", "/blog/**", { name: "blog" });
  addRoute(router, "GET", "/blog/:slug", { name: "post" });
  addRoute(router, "GET", "/**/_payload.json", { name: "payload" });
  addRoute(router, "GET", "/blog/:slug/_payload.json", { name: "post-payload" });

  findAllRoutes(router, "GET", "/blog/_payload.json").map((m) => m.data.name);
  // ["blog", "post", "payload"]
  findAllRoutes(router, "GET", "/blog/hello/_payload.json").map((m) => m.data.name);
  // ["blog", "payload", "post-payload"]
  findRoute(router, "GET", "/blog/hello")?.data.name; // "post"
  ```

  This also applies between the other routes on those paths: with `/**/_payload.json` registered, `/:lang/_payload.json` wins over `/blog/:slug` on `/blog/_payload.json`, because it pins the last segment.

### Removing routes

- **Pass the pattern as you registered it.** Only spellings the tree can't tell apart are equivalent (`/a/` and `/a`, `/**.md` and `/*.md`, `/docs/../api` and `/api`): `/path/*` doesn't remove `/path/:name`, and `/ab` doesn't remove `/a{b}`.
- **Errors:** `removeRoute` throws the same `rou3:` error as `addRoute` for a reserved group or modifier: `{...}+` / `{...}*`, text right after a leading `{/…}?` (`{/a}?b`), a misplaced `+` / `*` (`/a/pre-:x+`), or a `.` / `..` segment next to a param or group (`/:id/..`). Other [invalid patterns](#invalid-patterns) can't have been added, so they remove nothing (`{oops/x`).

## Pattern overlap: precision and limits

How `routesOverlap`, `compareRoutes` and `findOverlappingRoutes` (see the [README](../README.md#pattern-overlap)) handle the harder cases:

- **Answers are safe, not always exact.** Whenever `compareRoutes` claims containment or disjointness, it is proven. When something can't be decided, it answers with a weaker verdict (usually `"partial"`), never a wrong one.
- **Regex constraints** are checked exactly against literal segments (`/user/:id(\d+)` does not overlap `/user/abc`). Two dynamic segments where at least one has a regex are assumed to overlap: `routesOverlap("/user/:id(\d+)", "/user/:name([a-z]+)")` returns `true` although no path matches both. For the same reason, two different regexes compare as `"partial"`, even when they are equivalent.
- **Segments mixing params and text** are compared piece by piece: `compareRoutes("/f/:name.:ext", "/f/:name.png")` and `compareRoutes("/f/:name.:ext(png|jpg)", "/f/:name.png")` are `"superset"`.
- An actually equal pair that is only provable in one direction reports that containment: `/u/:id(42)` vs `/u/42` is `"superset"`.
- **Segment counts:**
  - `**` and a trailing `*`: zero or more segments (so `/a/**` overlaps `/a`).
  - `**:name`: one or more, none of them empty (`compareRoutes("/a/**", "/a/**:x")` is `"superset"`, and so is `compareRoutes("/a/:x/**", "/a/:y+")`).
  - A `*` elsewhere: one or more.
  - `:name`: exactly one.
  - Segments after a `**` are aligned to the end of the path: `compareRoutes("/**/_payload.json", "/blog/:slug/_payload.json")` is `"superset"`.
- **Optional syntax:** a pattern with `:x?`, `:x*` or `{...}?` expands into several variants, and two patterns overlap when any pair of variants does. A `?` param after a capture in its segment (`/a/*-:x?`) is one regex instead, compared piece by piece (`"superset"` of `/a/*-:x`).
- In `findOverlappingRoutes`, different routes (another pattern or method) are always reported separately, even when they share the same `data`. Registering the same route twice with the same `data` reports it once. A route with segments after `**` comes right after the bare `**` it follows.

## Regular expressions

### What `routeToRegExp` doesn't model

- A constraint that can match `/` (`:x(.+)`, `:x([^.]+)`) can span several segments in the regex (`/a/:x(.+)` matches `/a/b/c`), while the router splits the path into segments first. A `(.*)` / `:x(.*)` is a `*`, matched exactly.
- The empty path `""`: the router treats it as `/` (with no trailing slash for a `*`: `/*` doesn't match it). The regex matches it only for root routes whose first segment is optional (`/**`, `/:x*`, `/:x?`), not for `/` itself.
- In PCRE and Perl, `$` also matches before a final `\n`, so there the regex also matches `<path>\n`.
- `.` and `..` in the path are not resolved (in the pattern they are, as in `addRoute`). Normalize the path first if your router uses `normalize: true`.

**Backtracking.** Params that share a segment are lazy, so a naive regex retries every split of the segment on a path that fails after it (`/:a-:b-:c` would be cubic in the segment's length, the class of path-to-regexp's CVE-2024-45296). Where the split can be pinned down without look-arounds, the regex spells it out, with the same matches and captures: a param followed by a separator and another param ends at the separator's first occurrence (`/:a-:b` is `^\/(?<a>[^/][^/-]*)-(?<b>[^/]+?)\/?$`, also for separators like `-to-`, `--` or `%20`), a param before an optional `{.:ext}?` ending its segment at the first separator with text after it, and the last param after a greedy `*` and same-char separators holds no separator but at its ends (`/*.:ext` is `^\/(?<_0>[\s\S]*)\.(?<ext>[^/.]*[^/])\/?$`). These fail any path in linear time. A few shapes still backtrack, quadratically in the length of a long failing segment (on Node.js 24, about 50 to 200 ms for a 16 KB one, four times that for 32 KB): a param right before a constraint (`/:a-:b(\d+)-:c`), separators of several kinds or chars after a `*` (`/*-:a.:b`, `/*-to-:a`), a lazy `*` before params (`/a{/*-:a}?`), a constraint that can match `/` (`/:a(.+)-:b`), and the look-ahead forms below. Separators that repeat their first char inside (`/:a-x-x-:b-x-x-:c`) keep the lazy form, polynomial in the number of params. Cap the path length where that matters (most servers already do).

**Params.** Unnamed captures are named `_0`, `_1`, … in the regex (`"0"`, `"1"`, … in the router). A regex can't capture one group under two names, so there is no group for the router's deprecated `_` alias of a bare `**`: read the numbered one. A `**:name` / `:name+` / `:name*` is `[^/]+(?:\/[^/]+)*`, as in URLPattern. When optional segments meet a constrained optional, or several optional segments follow a catch-all, the regex can assign a segment to a different param than the router (`/a/:x?/:y(\d+)?` on `/a/1` sets `x`, the router sets `y`). The set of matched paths is still the same.

**Errors.** Patterns that `addRoute` rejects throw the same error, and so does a route that declares the same param name twice (`/files/:path/**:path`; a bare `**` takes the name `_`, its deprecated alias).

### Regex output and engine support

The trailing-slash rule (at most one trailing slash, exactly one when the last segment is empty) is built into the end of each regex:

| Route                          | Regex                                                  |
| ------------------------------ | ------------------------------------------------------ |
| `/users/:id(\d+)`              | `^\/users\/(?<id>\d+)\/?$`                             |
| `/path/:id?`                   | `^\/path(?:\/(?<id>[^/]+))?\/?$`                       |
| `/path/:param`                 | `^\/path\/(?<param>[^/]+)\/?$`                         |
| `/users/:id/:tab?`             | `^\/users\/(?<id>[^/]+)(?:\/(?<tab>[^/]+))?\/?$`       |
| `/path/*`                      | `^\/path(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))?\/?$`        |
| `/path/*.png`                  | `^\/path\/(?<_0>[\s\S]*)\.png\/?$`                     |
| `/path/**`                     | `^\/path(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$`       |
| `/base/**:path`                | `^\/base\/(?<path>[^/]+(?:\/[^/]+)*)\/?$`              |
| `/**`                          | `^(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$`             |
| `/**/_payload.json`            | `^(?:\/(?<_0>[\s\S]*))?\/_payload\.json\/?$`           |
| `/path/**/suffix`              | `^\/path(?:\/(?<_0>[\s\S]*))?\/suffix\/?$`             |
| `/**/:file`                    | `^(?:\/(?<_0>[\s\S]*))?\/(?<file>[^/]+)\/?$`           |
| `/a/**/:page?`                 | `^\/a(?:\/(?<_0>[\s\S]*?))??(?:\/(?<page>[^/]+))?\/?$` |
| `/`                            | `^\/$`                                                 |
| `/path/:id(\d*)` (look-behind) | `^\/path\/(?<id>\d*)(?:(?<=\/)\/\|(?<!\/)\/?)$`        |

**Look-behind.** The suffix `(?:(?<=\/)\/|(?<!\/)\/?)$` is only used when the end of the path can't be decided otherwise, for example:

- a constraint at the end of the route whose match can end in `/` (`:name([^.]+)`, `:x(.+)`),
- a required last segment whose constraint can match empty (`/path/:id(\d*)`),
- optional segments side by side where an earlier one can be empty (`/a/:x(\d*)?/:y?`),
- a catch-all that can be empty combined with optional segments (`/a/x-*/:page?`, `/a//**/:n(\d+)?`, `/a/**/:y?{/b}?`; a `**:rest` can't end in `/`, so `/a/**:rest/:page?` needs none).

Fixed-length look-behinds work in JavaScript, PCRE and Perl, but not in RE2-family engines.

**Optional groups.** A single optional group that ends a segment is compiled inline as `(?:...)?`, so each param appears once:

```js
routeToRegExp("/blog/:id(\\d+){-:title}?");
// /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+?))?\/?$/
routeToRegExp("/files/:name{.:ext}?");
// /^\/files\/(?<name>[^/][^/.]*\.??)(?:\.(?<ext>[^/]+?))?\/?$/
routeToRegExp("/users{/:id}?/posts/:post");
// /^\/users(?:\/(?<id>[^/]+))?\/posts\/(?<post>[^/]+)\/?$/
```

- A param in a segment with other text is lazy (`[^/]+?`), as in the router, so `/files/:name{.:ext}?` splits `archive.tar.gz` into `name: "archive"` and `ext: "tar.gz"`.
- An optional param in a segment is compiled in place, as in the router: `/pre-:x?` is `^\/pre-(?:(?<x>[^/]+?))?\/?$`, and `/*-:x?` is `^\/(?<_0>[\s\S]*)-(?:(?<x>[^/][^/-]*))?\/?$` (see "Backtracking" above).
- An optional group that starts its segment before more of it is inlined too: `/x/{:id}?(\\d+)` is `^\/x\/(?:(?<id>[^/]+?))?(?<_0>\d+)\/?$`.
- When the group follows a regex constraint in its segment (`/blog/:id(\d+){-:title}?`), the constraint is kept from taking the group's text, with a look-ahead where needed (RE2-family engines reject it). After a `*` (`/files/*{.:ext}?/raw`), the regex is an alternation.

**Duplicate named groups.** Other optional combinations compile to an alternation that repeats a named group:

- several optional groups;
- an in-segment group followed by optional segments (`/:x{.:e}?/:y?`);
- an optional group after a capture that could take its text (`/media/*{.webp}?`, `/*-x{-x}?`, `/files/*{.:ext}?/raw`);
- an optional group before more of its segment that holds a capture or `*`, or is followed by a bare `:name` (`/{x(y)}?(\\d+)`, `/{*-}?(\\d+)`, `/{:foo}?:bar`);
- a group right after a catch-all (`/a/**{.png}?`);
- a `*` before optional segments where the segment before it can be empty (`/a//*/:y?`).

Duplicate named groups work in JavaScript engines that support them (Node.js 23+, Chrome 125+, Firefox 129+, Safari 17+) and in Perl, and need `PCRE2_DUPNAMES` in strict PCRE2 engines. On Node.js 22, `routeToRegExp` throws a `rou3:` `SyntaxError` for these routes, and `regExpToRoute` can't convert them back.

**Catch-all with optional segments.** With one optional segment right after a `**`, the regex picks the same route as the router (`/a/**/:n(\d+)?` gives `/a/b/1` to `n`). With several, it matches the same paths but may assign segments differently (`/docs/**/:page?/:lang(en|fr)?` on `/docs/en` sets `page`, the router sets `lang`).

### What `regExpToRoute` accepts

- The dialect `routeToRegExp` emits: `(?<name>...)` groups, `[^/]+?` params inside a segment (and their linear forms, such as `[^/][^/-]*`, where `routeToRegExp` emits them), `[\s\S]*` catch-alls (an unnamed one in a segment of its own or next to text is a `*`), `(?:/...)?` optional groups and the endings shown above. Unnamed groups such as `(\d+)` work too, and the regex inside a constraint is kept verbatim.
- Looser forms, as older versions emitted them: a plain `\/?` ending, `.*` / `.+` catch-alls, and `[^/]+` params, read as `:name`.
  - A `:name` inside a segment is lazy, so a hand-written greedy `(?<a>[^/]+)-(?<b>[^/]+)` comes back as `/:a-:b`, which splits `/x-y-z` as `x` and `y-z`.
  - An old catch-all inside an optional group is the exception: 0.9.2's regex for `/a{/:w*}?` throws, and its regex for `/a{/:w+}?` comes back as `/a/:w(.+)?` (the current regexes for both come back as `/a/:w*`, the same route).
  - A group right after a `:name` gives the name its own regex, so it isn't read as the name's constraint: `(?<a>[^/]+?)(?<_0>\d+)` (the regex for `/{:a}(\\d+)`) comes back as `/:a([^\\x2f]+?)(\\d+)`, the same route.
  - A catch-all group named `_` (how 0.11 and older emitted `**`) still reads as `**`.
  - An unnamed `[^/]*` (how 0.11 and older emitted a single-segment `*`) reads as the constraint `([^\x2f]*)`, which matches the same paths: 0.11's regex for `/foo/*` comes back as `/foo{/([^\x2f]*)}?`, and for `/*` as the leading group `{/([^\x2f]*)}?`.
  - Captures follow the router, which ranks a constraint above a plain `:x`: 0.11's regex for `/:x?/*` gives `{ x: "a" }` on `/a`, while the route it comes back as (`/:x?{/([^\x2f]*)}?`) gives `{ "0": "a" }`.
  - It throws where no route matches the same paths: a hand-written trailing `\/([^/]*)\/?$` (it matches `""` on `/foo/`), and 0.11's `*` after an empty segment (`/a//*`).
- Routes that compile to the same regex come back in one spelling: `/base/**:path` becomes `/base/:path+`, `/**.md` becomes `/*.md`, `/a{/*}?` becomes `/a/**`, `/a/pre-{:x}?` becomes `/a/pre-:x?`, `/a{/:x+}?` becomes `/a/:x*`, `/a{/**}?` becomes `/a/**` (0.11 read its regex as `/a/:_*`), `/a{/([\s\S]*)}?` becomes `/a/**`, and `/a/:x?/:y?` becomes `/a{/:x/:y?}?`. Percent-encoded text stays encoded: the regex for `/café` comes back as `/caf%C3%A9` (the same route).

It throws for:

- a regex not anchored with both `^` and `$`;
- look-arounds and backreferences;
- regex operators outside a constraint (`|`, `.`, `+`, `[…]`, …);
- a literal character outside a constraint that a route would [percent-encode](#percent-encoding) (`é`, a space, `\{`, `\?`, …), since no route matches it;
- the flags `i`, `m`, `s`, `u` and `v` (`g`, `y` and `d` are ignored);
- the duplicate-group alternations above;
- constraints that can't be written as a route (for example one containing `/`).
