# 🌳 rou3

<!-- automd:badges codecov bundlejs -->

[![npm version](https://img.shields.io/npm/v/rou3)](https://npmjs.com/package/rou3)
[![npm downloads](https://img.shields.io/npm/dm/rou3)](https://npm.chart.dev/rou3)
[![bundle size](https://img.shields.io/bundlejs/size/rou3)](https://bundlejs.com/?q=rou3)
[![codecov](https://img.shields.io/codecov/c/gh/h3js/rou3)](https://codecov.io/gh/h3js/rou3)

<!-- /automd -->

Lightweight and fast router for JavaScript.

- 🌲 **Tree-based lookups**, one node per path segment, with a fast path for static routes.
- 🧩 **URLPattern-like syntax**: params, regex constraints, optional segments, groups and wildcards.
- ⚡ **Compiler** that turns a router into one optimized function, at runtime or at build time.
- 🧪 **Utilities** to compare patterns, find overlapping routes and convert routes to and from `RegExp`.
- 📦 **Zero dependencies**, tree-shakeable, typed.

## Install

```sh
# ✨ Auto-detect
npx nypm install rou3
```

rou3 is ESM only. It runs on Node.js 20.19+, Bun, Deno and modern browsers.

## Quick start

```js
import { createRouter, addRoute, findRoute, findAllRoutes, removeRoute } from "rou3";

const router = createRouter();

addRoute(router, "GET", "/about", { page: "about" });
addRoute(router, "GET", "/users/:id", { page: "user" });
addRoute(router, "GET", "/docs/**", { page: "docs" });
```

`findRoute` returns the best match, or `undefined`:

```js
findRoute(router, "GET", "/about");
// { data: { page: "about" } }

findRoute(router, "GET", "/users/42");
// { data: { page: "user" }, params: { id: "42" } }

findRoute(router, "GET", "/docs/guide/intro");
// { data: { page: "docs" }, params: { "0": "guide/intro", _: "guide/intro" } }

findRoute(router, "GET", "/missing");
// undefined
```

`findAllRoutes` returns every match, from the least to the most specific:

```js
addRoute(router, "GET", "/docs/:section/intro", { page: "intro" });

findAllRoutes(router, "GET", "/docs/guide/intro");
// [
//   { data: { page: "docs" }, params: { "0": "guide/intro", _: "guide/intro" } },
//   { data: { page: "intro" }, params: { section: "guide" } },
// ]
```

`removeRoute` removes a route by the pattern it was added with:

```js
removeRoute(router, "GET", "/users/:id");
```

Route data can be anything: a handler, a config object, an id. rou3 stores it and hands it back on a match.

## Route patterns

rou3 supports [URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API)-like syntax. A **segment** is the part of a path between two `/`.

| Pattern                     | Example match                            | Params                                               |
| --------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| `/path/to/resource`         | `/path/to/resource`                      | `{}`                                                 |
| `/users/:name`              | `/users/foo`                             | `{ name: "foo" }`                                    |
| `/users/:id(\\d+)`          | `/users/123`                             | `{ id: "123" }`                                      |
| `/files/:ext(png\|jpg)`     | `/files/png`                             | `{ ext: "png" }`                                     |
| `/path/(\\d+)`              | `/path/123`                              | `{ "0": "123" }`                                     |
| `/users/:id?`               | `/users` or `/users/123`                 | `{}` or `{ id: "123" }`                              |
| `/files/:path+`             | `/files/a/b/c`                           | `{ path: "a/b/c" }`                                  |
| `/files/:path*`             | `/files` or `/files/a/b`                 | `{}` or `{ path: "a/b" }`                            |
| `/files/*.png`              | `/files/icon.png`                        | `{ "0": "icon" }`                                    |
| `/files/file-*-*.png`       | `/files/file-a-b.png`                    | `{ "0": "a", "1": "b" }`                             |
| `/path/**`                  | `/path/foo/bar`                          | `{ "0": "foo/bar", _: "foo/bar" }` (`_` is deprecated) |
| `/path/**:rest`             | `/path/foo/bar`                          | `{ rest: "foo/bar" }`                                |
| `/**/_payload.json`         | `/_payload.json` or `/a/b/_payload.json` | `{}` or `{ "0": "a/b", _: "a/b" }`                   |
| `/**.md`                    | `/docs/intro.md`                         | `{ "0": "docs", "1": "intro", _: "docs" }`           |
| `/book{s}?`                 | `/book` or `/books`                      | `{}`                                                 |
| `/blog/:id(\\d+){-:title}?` | `/blog/123` or `/blog/123-my-post`       | `{ id: "123" }` or `{ id: "123", title: "my-post" }` |
| `/files/:name.:ext`         | `/files/a.tar.gz`                        | `{ name: "a", ext: "tar.gz" }`                       |
| `/v:version?`               | `/v` or `/v2`                            | `{}` or `{ version: "2" }`                           |

> [!NOTE]
> In JavaScript strings a regex backslash is written twice: `"/users/:id(\\d+)"` is the pattern `/users/:id(\d+)`.

### Params

- **Named params** `:name` match one segment: `/users/:name`. They can also sit inside a segment: `/blog/:year-:month`. When several params share a segment, each one takes as little as it can, as in URLPattern: `/:a-:b` on `/x-y-z` gives `{ a: "x", b: "y-z" }`, and `/:name.:ext` on `/a.tar.gz` gives `{ name: "a", ext: "tar.gz" }`. A `*` takes as much as it can: `/*-:a` on `/x-y-z` gives `{ "0": "x-y", a: "z" }`.
- **Regex constraints** `:name(regex)` only match when the regex does: `/users/:id(\\d+)`. The regex applies to one segment and can't contain `/`.
- **Unnamed groups** `(regex)` capture into numbered keys `"0"`, `"1"`, …: `/path/(\\d+)`. Inside a regex, group with `(?:…)`: a capturing group there throws (`/:x((a))`, `/:x((?<n>a))`).
- **Modifiers** go at the end of a whole-segment param:
  - `:name?` optional (also works with a regex: `:id(\\d+)?`)
  - `:name+` one or more segments
  - `:name*` zero or more segments: like `:name+`, or no segment at all (`/files/:path*` matches `/files`)
- **`?` inside a segment** makes only the param optional: `/pre-:x?` matches `/pre-` and `/pre-a`, but not `/`. Use a group for an optional segment: `/{pre-:x}?`. After a `*` or a regex constraint, the capture takes what it can first, as in URLPattern: `/*-:x?` on `/--` gives `{ "0": "-" }`, and `/:a(\\d+):b?` on `/12` gives `{ a: "12" }`. An absent param has no key. A group holding only the param is the same (`/*-{:x}?` is `/*-:x?`).

<details>
<summary>Param naming rules</summary>

- A name starts with a letter or `_` and goes on with word characters (`[A-Za-z_][A-Za-z0-9_]*`), as in URLPattern: `:v2` and `:_0` are names, `:0` and `:1st` throw.
- Any other ASCII character but `$` ends a name, `-` included: `/blog/:year-:month` has two params, and `/users/:user-id` is the param `user` followed by a literal `-id` (write `:user_id` for one param). A group's `{` or `}` ends one too: `/:a{b}?` is the param `a` followed by an optional `b`, and a regex group after one is an unnamed capture, not the param's constraint: `/{:foo}(\\d+)` on `/a12` gives `{ foo: "a", 0: "12" }` (the param is lazy, as in URLPattern). A group starting with `?`, `+` or `*` right after a param, constraint, group or `*` throws (`/{:foo}{*}`, `/{:foo}?*`, `/{:foo}(x)?`, `/:id(\\d+){?}`, `/*{*}`).
- A non-ASCII character or `$` right after a name throws (`/:café`, `/:id$`: URLPattern reads them as part of the name). To end a name early, escape the next character: `/:caf\\é` gives `{ caf }` followed by a literal `é`, and `/:id\\$` gives `{ id }` followed by a literal `$`.
- A name can appear only once per route: `/a/:x/:x` throws.
- A `:` must start a name. Write a literal colon as `\\:`.
- `+` and `*` only repeat a whole-segment `:name` (`:id(\d+)+` and `pre-:x+` throw).

</details>

### Wildcards

- **`*`** matches one segment, or part of one, and captures it into a numbered key: `/files/*`, `/files/*.png`.
- **`**`** matches zero or more segments and captures them into a numbered key, like `*`: `/docs/**` on `/docs/a/b` gives `{ "0": "a/b", _: "a/b" }`. Unnamed captures (`*`, `**` and unnamed groups) are numbered in pattern order over the whole pattern, as in URLPattern, also those in an optional group that is left out: `/*/x/**` on `/a/x/b/c` gives `{ "0": "a", "1": "b/c", _: "b/c" }`, and `/a{/(\\d+)}?/**` on `/a/x/y` gives `{ "1": "x/y", _: "x/y" }`. Over zero segments both keys are left out (`/docs/**` on `/docs` gives `{}`), and an empty segment is `""` (`/docs//` gives `{ "0": "", _: "" }`).
  - **Deprecated:** `_` is the same capture under the name rou3 0.11 and older used, so `params._` keeps working. Unlike 0.11 it is left out over zero segments (it used to be `""`). `_` can't be a param name next to a bare `**` (`/:_/**` throws). Read the numbered key instead: `_` will be removed in a future version. `routeToRegExp` has no `_` group.
- **`**:name`** matches one or more segments and captures them into `name`: `/docs/**:path`. Like `:name`, `:name+` and `:name*`, it needs a value: `/docs//` doesn't match (see [empty segments](#trailing-slashes-and-empty-segments)).
- **Segments after `**`** are matched from the **end** of the path, and the `**` takes whatever is in between. `/**/_payload.json` matches `_payload.json` in any directory, and `/blog/**:path/og.png` matches `og.png` anywhere under `/blog`.
- **`**` followed by text** is short for `**/*<text>`: `/**.md` matches any path whose last segment ends in `.md`. Anywhere else in a segment, `**` throws (`/a**b`, `/a/x**`): write `*` for one capture or `\\*\\*` for a literal.

A route can have only one catch-all. `**`, `**:name`, and a `:name+` / `:name*` that is not the last segment all count as one.

### Groups

`{...}` groups part of a pattern without capturing it. Add `?` to make it optional:

- `/book{s}?` matches `/book` and `/books`.
- `/users{/:id}?/posts` matches `/users/posts` and `/users/42/posts`.

Groups can't be nested or repeated (`{...}+` and `{...}*` throw).

### Escaping

Escape `:`, `*`, `?`, `+`, `(`, `)`, `{` and `}` with a backslash to match them literally (a literal `?`, `{` or `}` is then [percent-encoded](#percent-encoding), like other literal text). Outside a regex constraint, any escaped character is a literal (`\\.` is `.`, `\\\\` is `\`), as in URLPattern. A `\` can't escape `/` or end a segment.

```js
addRoute(router, "GET", "/static\\:path/\\*\\*", {}); // matches only "/static:path/**"
addRoute(router, "GET", "/files/\\(2024\\)", {}); // matches only "/files/(2024)"
```

### Percent-encoding

The literal text of a pattern is percent-encoded once, when the route is added, the same way URLPattern and `new URL()` encode a pathname. Lookup paths are not decoded or encoded, so pass the encoded pathname (`new URL(req.url).pathname`):

```js
addRoute(router, "GET", "/café/:id", {});
findRoute(router, "GET", "/caf%C3%A9/1"); // { data: {}, params: { id: "1" } }
findRoute(router, "GET", "/café/1"); // undefined
```

- Encoded: control characters (tab and newline too, which URLPattern drops), space, `"`, `#`, `<`, `>`, `?`, `^`, `` ` ``, `{`, `}`, and every non-ASCII character (as UTF-8, upper-case hex: `é` is `%C3%A9`). This covers escaped characters too: `\\?` matches `%3F`, `\\{` matches `%7B`.
- Not encoded: `%`, so an existing `%xx` stays as written (`/caf%c3%a9` matches only `/caf%c3%a9`, not `/caf%C3%A9`), and other ASCII characters (`/a|b[c]` stays as is).
- Regex constraints are regex and are not encoded: write `:x(%C3%A9)`, not `:x(é)`.
- A lone surrogate is encoded as U+FFFD (`%EF%BF%BD`), as in URLPattern.
- `^` follows the URL spec, as Node.js and Bun do. Deno (2.9) leaves it unencoded in `new URL().pathname` (`/a^b`), so on Deno encode it before a lookup (`pathname.replaceAll("^", "%5E")`) for routes with a literal `^`.

`removeRoute`, `routeToRegExp`, `routeNodeKeys`, the overlap helpers, and the compiler see the encoded text too: `/café` and `/caf%C3%A9` are the same route, and so are `/café-:id` and `/caf%C3%A9-:id` (a regex constraint is not encoded, so `:x(é)` and `:x(%C3%A9)` stay different routes).

### Invalid patterns

`addRoute` throws a `rou3:` error that quotes the pattern when the syntax has no meaning, instead of silently matching something unexpected. For example: an unclosed `(` or `{`, a nested group, an empty group `()`, a modifier in the wrong place (`*?`, `**+`, `:x.png?`), a `?` after plain text (`/foo?`: lookup paths have no query string, escape a literal one as `\\?`), a `**` in the middle of a segment (`/a**b`), an invalid or repeated param name (`/:0`, `/:café`, `/:id$`, `/a/:x/:x`), a second catch-all, a `\/`, a capturing group inside a regex constraint (`/:x((a))`, use `(?:…)`), or an anchor (`^`, `$`), look-around or numbered backreference (`\1`) in a regex constraint, or a character from U+FFFD to U+FFFF (used internally). The router tests a constraint against its segment alone, while `routeToRegExp` puts it inline, where it would see the rest of the path, so the two would match different paths.

### Differences from URLPattern

rou3 matches paths segment by segment in a tree, which leads to a few intentional differences:

| Feature                       | URLPattern                         | rou3                                            |
| ----------------------------- | ---------------------------------- | ----------------------------------------------- |
| `*` (single star)             | Greedy catch-all `(.*)` across `/` | One segment (or part of one), `([^/]*)`         |
| Trailing `*`                  | Required (`/foo/*` doesn't match `/foo`) | Optional (`/foo/*` matches `/foo`), so `use("/api/*")`-style scopes cover `/api` too |
| `**` (double star)            | `*` with a `*` modifier: a numbered capture across `/`, unset over zero segments (`/foo/**` on `/foo` is `{}`) | Same key and value (also as the deprecated `_`), but over whole segments (`/**.md` is `/**/*.md`), and one per route. One trailing slash is ignored, so `/foo/**` on `/foo/` is `{}` too (URLPattern: `{ 0: "" }`) |
| `(.*)` in a segment           | Greedy match across `/`            | Stays within the segment                        |
| `{...}+` / `{...}*` groups    | Group repetition                   | Not supported (throws)                          |
| Path normalization (`.`/`..`) | Resolved in input paths            | Opt-in with `{ normalize: true }`               |
| Case sensitivity              | Can be case-insensitive            | Always case-sensitive                           |
| Non-`/`-prefixed paths        | Supported                          | Paths must start with `/`                       |
| Optional group with text after a greedy capture in its segment (`/*{.webp}?`) | The capture takes what it can (`/a.webp`: `{ 0: "a.webp" }`) | The route with the group wins (`/a.webp`: `{ 0: "a" }`); a group holding only a param is that param, as in URLPattern (`/*-{:x}?` is `/*-:x?`, and `/a/*{:x}?`, which is `/a/*:x?`: its segment is required, no match on `/a`, and `/a/b` gives `{ 0: "b" }`, not `{ 0: "", x: "b" }`), except before more of its segment, where it stays a group (`/*-{:x}?(y)` on `/a--y`: `{ 0: "a", x: "-", 1: "y" }`, URLPattern `{ 0: "a-", 1: "y" }`) |
| Optional group before more of its segment (`/:foo{x}?(.*)`) | The param takes as little as it can (`/abx`: `{ foo: "a", 0: "bx" }`) | The route with the group wins (`/abx`: `{ foo: "ab", 0: "" }`) |
| Optional group that can match empty text (`/{:foo}{(\\d*)}?`) | Unset where it matches nothing (`/a`: `{ foo: "a" }`) | The router gives `""` (`/a`: `{ foo: "a", 0: "" }`); `routeToRegExp` leaves it unset |
| Several optional groups in a segment (`/{:foo}?{(\\d+)}?`) | One regex (`/1`: `{ foo: "1" }`) | They expand to separate routes, and a regex param outranks a plain `:foo` whatever the order (`/1` matches `/(\\d+)` and `/:foo`: `{ 0: "1" }`); `routeToRegExp` gives URLPattern's `{ foo: "1" }` |
| Optional segment after `:name+` / `:name*` (`/:a+/:b?`) | The repeated param takes what it can (`/x/y`: `{ a: "x/y" }`) | Segments after a catch-all match from the end (`/x/y`: `{ a: "x", b: "y" }`) |
| Param names                   | Unicode identifiers                | `[A-Za-z_]\w*`; a non-ASCII char or `$` right after one throws |
| Empty segments in `:name+` | Every repeated segment needs a value (`/foo/:bar+` doesn't match `/foo//a`) | The value as a whole needs one, empty segments inside it are kept (`/foo/:bar+` on `/foo//a` is `{ bar: "/a" }`; a `:name*` too, `/foo/:bar*` on `/foo/a//` is `{ bar: "a/" }`) |
| Percent-encoding              | Encodes the pattern's literal text and the input | Encodes the pattern's literal text; the input must already be encoded (`new URL().pathname`) and is never decoded |

## Matching

### Methods and paths

The paths you look up must start with `/` and the methods must be **UPPERCASE** (`"GET"`, not `"get"`). rou3 does not normalize lookup input, so do it before calling `findRoute`. Paths must be percent-encoded, as `new URL().pathname` gives them: a route's literal text is encoded (see [percent-encoding](#percent-encoding)).

### Routes for any method

Register a route with the method `""` to match every method. It's useful for things like middleware or auth checks:

```js
addRoute(router, "", "/users/*", { auth: true }); // any method
addRoute(router, "GET", "/users/:id(\\d+)", { handler: "user" });

findAllRoutes(router, "GET", "/users/42").map((m) => m.data);
// [{ auth: true }, { handler: "user" }]

findRoute(router, "GET", "/users/42")?.data; // { handler: "user" }
findRoute(router, "GET", "/users/me")?.data; // { auth: true }
findRoute(router, "POST", "/users/42")?.data; // { auth: true }
```

A lookup sees the routes for its method and the method-agnostic ones together, and the most specific one wins. When two routes are equally specific, the one registered for the method wins over the method-agnostic one (and comes after it in `findAllRoutes`). A lookup with the method `""` only sees method-agnostic routes.

### Trailing slashes and empty segments

- **At most one trailing slash** is ignored: `/users/foo/` matches `/users/:name`, `/users/foo//` does not.
- In patterns, trailing slashes are ignored: `/users/`, `/users//` and `/users` are the same route.
- **Empty segments in the middle are real**: `/a//b` does not match `/a/b`.
- A `:name`, `:name+`, `:name*` or `**:name` needs a value, as in URLPattern: it never captures `""` (a `:name*` can match no segment instead). A `*`, `**` or a regex constraint that can match empty (`:id(\\d*)`) takes an empty segment:

```js
addRoute(router, "GET", "/admin/:id", {});
addRoute(router, "GET", "/files/:path+", {});
addRoute(router, "GET", "/docs/:path*", {});
addRoute(router, "GET", "/raw/*", {});

findRoute(router, "GET", "/admin/"); // undefined (the trailing slash is ignored)
findRoute(router, "GET", "/admin//"); // undefined (an empty segment)
findRoute(router, "GET", "/files//"); // undefined
findRoute(router, "GET", "/files///"); // params: { path: "/" } (two empty segments)
findRoute(router, "GET", "/docs"); // matches, no `path`
findRoute(router, "GET", "/docs//"); // undefined
findRoute(router, "GET", "/raw//"); // params: { "0": "" }
```

### Path normalization

`.` and `..` segments are **not** resolved by default. If your input paths may contain them, enable `normalize`:

```js
findRoute(router, "GET", "/foo/bar/../baz", { normalize: true }); // matches "/foo/baz"
findAllRoutes(router, "GET", "/foo/./bar", { normalize: true }); // matches "/foo/bar"
```

The [compiler](#compiler) accepts the same option: `compileRouter(router, { normalize: true })`.

### Skipping params

If you only need the route data, pass `{ params: false }` to skip building the params object:

```js
findRoute(router, "GET", "/docs/guide", { params: false });
// { data: { page: "docs" } }
```

### Result ordering

`findAllRoutes` returns matches from the **least to the most specific**, and `findRoute` returns the most specific one. This order is part of the public API: you can rely on it, for example to merge all matched route rules so that the most specific one wins.

```js
const router = createRouter();
addRoute(router, "GET", "/**", { name: "catch-all" });
addRoute(router, "GET", "/api/**", { name: "api" });
addRoute(router, "GET", "/api/:v/users/:id", { name: "user" });

findAllRoutes(router, "GET", "/api/v1/users/42").map((m) => m.data.name);
// ["catch-all", "api", "user"]
```

The [compiled](#compiler) `matchAll` function returns exactly the same results in the same order.

In short: static segments beat params, and params beat wildcards. Among routes that end on the same kind of segment, a constrained or required param beats an optional or unconstrained one. Registration order only breaks exact ties.

<details>
<summary>Detailed ordering rules</summary>

- **Across the tree:** at each level, wildcard (`**`) matches come first, then single-segment params (`*`, `:name`), then static segments. Broader and shallower routes come before more static and deeper ones.
- **Routes on the same tree node** (for example `/foo/*` and `/foo/:id(\d+)`, see [Route node keys](#route-node-keys)): optional and unconstrained routes come before required and regex-constrained ones. Ties keep registration order. Method-agnostic routes are sorted together with the method's own routes, and on a tie the method-agnostic one comes first (so `findRoute` picks the method's own).
  - An optional param compiled in place in its segment (`/e/:a:b?`, `/a/*-:x?`) is one regex-constrained route: on its node it beats a plain `:id` sibling on every path, also on deeper routes (`/e/:a:b?/x` over `/e/:id/x`, though both match the same paths), and ties `/e/:id(\d+)` (registration order decides).
- **Consistent with containment:** when no pattern uses optional syntax or a bare `*` segment and each pattern contains the next (a `"superset"` per [`compareRoutes`](#pattern-overlap)), the result order is broadest first.
- **Exception — bare `*` segment:** a `*` segment may match an empty segment, or no segment at the end of the path, and the order does not account for that. `/p/*/**` contains `/p/**:rest` but comes after it. A `*` that isn't the last segment, or that follows a `**`, ties with a `:name` in its place (`/p/*/x` and `/p/:id/x`, `/**/*` and `/**/:name`), so registration order decides. `findRoute` can pick the broader route in these cases too.
- **Carve-out — optional syntax:** a pattern with `:name?`, `:name*` or `{...}?` registers one entry per variant, and results are ordered by the variant that matched, not by the whole pattern. A broader pattern can therefore come **last**:

  ```js
  const router = createRouter();
  addRoute(router, "GET", "/admin", { name: "admin" });
  addRoute(router, "GET", "/admin/:page?", { name: "admin-page" }); // superset of "/admin"

  findAllRoutes(router, "GET", "/admin").map((m) => m.data.name);
  // ["admin", "admin-page"] (the broader pattern is last)
  ```

  Both routes match `/admin` with an identical entry, so registration order decides: adding `/admin/:page?` first swaps them. If you need a strict pattern-level order with optional syntax, sort the result with [`compareRoutes`](#pattern-overlap).

- **Segments after a wildcard:** a route like `/**/_payload.json` is anchored at the end of the path. On every path such a route matches, all matches are ranked **from the last segment backwards**: a literal segment beats a regex-constrained param, which beats a plain param or a segment covered by `**`. A segment of captures alone with at most one required `:name` (`*:a`, `:a:b?`, `*:x?`) restricts nothing more, so it ranks as a plain param here: `/b/:id` beats `/**/:a:b?` and `/**/*:a` on `/b/x`. Ties fall back to the rules above. Paths that no such route matches are not affected:

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

</details>

### Removing routes

`removeRoute(router, method, pattern)` removes everything that the matching `addRoute` call added, including all variants of an optional pattern and duplicate registrations. Other routes are left alone, even ones that share a tree node:

```js
addRoute(router, "GET", "/path/:id", { a: true });
addRoute(router, "GET", "/path/:name", { b: true });

removeRoute(router, "GET", "/path/:name"); // "/path/:id" is still registered
```

Pass the pattern as you registered it. Spellings that the tree can't tell apart are equivalent (`/a/` and `/a`, `/**.md` and `/**/*.md`), but `/path/*` does not remove `/path/:name`, and `/ab` does not remove `/a{b}`.

## Compiler

For the fastest lookups, compile a router into a single function. The compiled function returns the same results as `findRoute` (or `findAllRoutes` with `matchAll: true`).

- **`compileRouter`** compiles at runtime (JIT) with `new Function()`.
- **`compileRouterToString`** generates code ahead of time (AOT), for example into a build output. It needs no `eval` and no rou3 at runtime.

Both are imported from `rou3/compiler`.

<!-- automd:jsdocs src="./src/compiler.ts" -->

### `compileRouter(router, opts?)`

Compiles the router instance into a faster route-matching function.

**IMPORTANT:** `compileRouter` requires eval support with `new Function()` in the runtime for JIT compilation (not allowed under a CSP without `unsafe-eval`: use `compileRouterToString` at build time there).

The compiled function is a **snapshot** of the router: routes added or removed afterwards are not seen, compile again after changing it. Route data is kept by reference. It returns what `findRoute` returns (with `matchAll: true`, what `findAllRoutes` returns), except that `params` is a plain object where `findRoute`'s has a null prototype.

**Example:**

```ts
import { createRouter, addRoute } from "rou3";
import { compileRouter } from "rou3/compiler";
const router = createRouter();
// [add some routes]
const findRoute = compileRouter(router);
const matchAll = compileRouter(router, { matchAll: true });
findRoute("GET", "/path/foo/bar");
```

### `compileRouterToString(router, opts?, legacyOpts?)`

Compile the router instance into a compact runnable code (ahead of time, e.g. into a build output).

The output is a self-contained JavaScript expression (or a `const <functionName>=…;` statement): no imports, no runtime dependency on rou3, and no `eval` / `new Function()`, so it runs under a strict CSP. It needs ES2018 (named capture groups, object spread). Like `compileRouter`, it is a **snapshot** of the router at compile time.

**IMPORTANT:** The exact generated code is **not** stable across rou3 versions: generate it at build time with the installed rou3, don't commit, patch or parse it.

**IMPORTANT:** Route data is emitted with `JSON.stringify` (`toJSON()` applies at every depth, as in JSON). Data containing a function, symbol or bigint throws: pass `opts.serialize` to emit each route's data as a JavaScript expression of your own instead.

**Example:**

```ts
import { createRouter, addRoute } from "rou3";
import { compileRouterToString } from "rou3/compiler";
const router = createRouter();
// [add some routes with serializable data]
const compilerCode = compileRouterToString(router, { functionName: "findRoute" });
// "const findRoute=(m, p) => {}"
// Route data as code (e.g. handler imports)
compileRouterToString(router, { serialize: (data) => `{handler:${data.importName}}` });
```

<!--/automd -->

## Pattern utilities

`findRoute` and `findAllRoutes` match a **path** against patterns. The utilities below compare **patterns against patterns**, for example to check whether two route rules can apply to the same URL. They are tree-shaken away when you don't import them.

### Pattern overlap

```js
import { createRouter, addRoute, routesOverlap, compareRoutes, findOverlappingRoutes } from "rou3";

// Can the two patterns match a common path?
routesOverlap("/**", "/protected/feed/**"); // true
routesOverlap("/a/**", "/b/**"); // false

// How do the sets of paths they match relate?
compareRoutes("/api/**", "/api/admin/**"); // "superset"
compareRoutes("/api/admin/**", "/api/**"); // "subset"
compareRoutes("/a/:x", "/a/:y"); // "equal" (param names don't matter)
compareRoutes("/a/*/c", "/a/b/*"); // "partial"
compareRoutes("/a/**", "/b/**"); // "disjoint"

// Which registered routes can match a path that the pattern matches?
const router = createRouter();
addRoute(router, "GET", "/**", { isr: true });
addRoute(router, "GET", "/protected/**", { basicAuth: true });
addRoute(router, "GET", "/protected/feed/**", { isr: 60 });

findOverlappingRoutes(router, "GET", "/protected/feed/**");
// [
//   { data: { isr: true } },       // /**
//   { data: { basicAuth: true } }, // /protected/**
//   { data: { isr: 60 } },         // /protected/feed/**
// ]
```

- **`routesOverlap(a, b)`** returns `true` if at least one path is matched by both patterns.
- **`compareRoutes(a, b)`** reads as "`a` is … of `b`":
  - `"equal"`: both match the same paths.
  - `"superset"`: `a` matches every path `b` matches, and more.
  - `"subset"`: `b` matches every path `a` matches, and more.
  - `"disjoint"`: no path matches both.
  - `"partial"`: none of the above could be proven. The patterns may share some paths.
- **`findOverlappingRoutes(router, method, pattern)`** works like `findAllRoutes`, but takes a pattern instead of a path. It returns every registered route that can match a path the pattern matches, in the same least to most specific order and with the same method handling. Matches only have `data` (there is no single path to extract params from). A route that was registered with optional syntax is reported once.

These utilities understand the full pattern syntax (groups, modifiers, escapes) using the same rules as the router, so their answers agree with `findRoute`.

<details>
<summary>Precision and limits</summary>

- **Answers are safe, not always exact.** Whenever `compareRoutes` claims containment or disjointness, it is proven. When something can't be decided, it answers with a weaker verdict (usually `"partial"`), never a wrong one.
- **Regex constraints** are checked exactly against literal segments (`/user/:id(\d+)` does not overlap `/user/abc`). Two dynamic segments where at least one has a regex are assumed to overlap: `routesOverlap("/user/:id(\d+)", "/user/:name([a-z]+)")` returns `true` although no path matches both. For the same reason, two different regexes compare as `"partial"`, even when they are equivalent.
- An actually equal pair that is only provable in one direction reports that containment: `/u/:id(42)` vs `/u/42` is `"superset"`.
- **Segment counts:** `**` matches zero or more segments (so `/a/**` overlaps `/a`), `**:name` one or more, a trailing `*` zero or one, and `*` or `:name` elsewhere exactly one. Segments after a `**` are aligned to the end of the path: `compareRoutes("/**/_payload.json", "/blog/:slug/_payload.json")` is `"superset"`.
- **Optional syntax:** a pattern with `:x?`, `:x*` or `{...}?` expands into several variants, and two patterns overlap when any pair of variants does. A `?` param after a capture in its segment (`/a/*-:x?`) is one regex instead, so it compares as `"partial"` with its variants (`/a/*-:x`).
- In `findOverlappingRoutes`, different routes (another pattern or method) are always reported separately, even when they share the same `data`. Registering the same route twice with the same `data` reports it once. A route with segments after `**` comes right after the bare `**` it follows.

</details>

### Route node keys

Different patterns can end on the **same node** of the route tree: `/users/:id` and `/users/*` both mean "any single segment under `/users`". `routeNodeKeys(pattern)` returns the node(s) a pattern lands on:

```js
import { routeNodeKeys } from "rou3";

routeNodeKeys("/users/:id"); // ["/users/*"]
routeNodeKeys("/users/*"); // ["/users/*"] (same node as /users/:id)
routeNodeKeys("/admin/**:rest"); // ["/admin/**"]
routeNodeKeys("/**:path/og.png"); // ["/**/og.png"]
routeNodeKeys("/a/:x?"); // ["/a", "/a/*"] (optional syntax lands on two nodes)
```

Routes on the same node compete: for a given path, `findRoute` returns at most one of them. If you keep your own per-route metadata (route rules, middleware, auth) in a map keyed by pattern text, `/users/*` and `/users/:id` look unrelated. Key the map by `routeNodeKeys` instead, to merge metadata per node or warn when one route shadows another.

> `routeNodeKeys(a)` and `routeNodeKeys(b)` share a key **if and only if** `a` and `b` share a node.

- The result is a deduplicated array, since optional syntax registers on several nodes (`/x{/a}?{/b}?` registers on 4).
- Each key is itself a valid pattern for its node: `routeNodeKeys(key)` is `[key]`.
- Invalid patterns throw exactly like `addRoute`.

> [!IMPORTANT]
> Sharing a node does **not** mean matching the same paths. Keys drop regex constraints and widen `**:name` to `**`, so `/u/:id(\d+)` and `/u/:slug([a-z]+)` share the key `/u/*` but never match the same path. To compare which paths two patterns match, use [`compareRoutes`](#pattern-overlap).

### Regular expressions

`routeToRegExp(route)` converts a pattern into an anchored `RegExp` with named groups for the params:

```js
import { routeToRegExp } from "rou3";

const re = routeToRegExp("/users/:id(\\d+)");
// /^\/users\/(?<id>\d+)\/?$/

"/users/123".match(re).groups; // { id: "123" }
```

The regex matches **exactly the paths `findRoute` matches** on a router that only holds that route, including the router's tolerances (one optional trailing slash, empty segments, an optional trailing `*`, segments after `**` matched from the end). That makes it safe to use as a guard or scope check outside the router. Like `findRoute` without `normalize`, it compares paths as-is.

The one exception is a regex constraint that can match `/`, such as `(.*)`: the router applies it to one segment, but in the regex it can span several, so `routeToRegExp("/foo/(.*)")` also matches `/foo/a/b`. The regex then matches more paths than the router, never fewer, so a guard built on it still runs.

The output is **PCRE-compatible**, so its `.source` also works in `grep -P`, `rg -P`, PHP `preg_*` and Perl. Most routes also compile without look-behind, so they work in RE2-family engines (RE2, Go `regexp`, Rust `regex`).

`regExpToRoute(regexp)` goes the other way. It accepts a `RegExp` or its source string:

```js
import { regExpToRoute } from "rou3";

regExpToRoute(/^\/users\/(?<id>\d+)\/?$/); // "/users/:id(\\d+)"
regExpToRoute(/^\/path\/(?<param>[^/]+)\/?$/); // "/path/:param"
regExpToRoute(/^\/path(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$/); // "/path/**"
regExpToRoute("^\\/files\\/(?<_0>[^/]*)\\.png\\/?$"); // "/files/*.png"
regExpToRoute(/^(?:\/(?<_0>[\s\S]*))?\/_payload\.json\/?$/); // "/**/_payload.json"
```

It understands the regexes `routeToRegExp` emits, and every one of them round-trips exactly: `routeToRegExp(regExpToRoute(re)).source === re.source`. Anything else throws a `rou3:` error instead of returning a wrong pattern.

<details>
<summary>What <code>routeToRegExp</code> doesn't model</summary>

- A constraint that can match `/` (`:x(.+)`, `:x([^.]+)`) can span several segments in the regex (`/a/:x(.+)` matches `/a/b/c`), while the router splits the path into segments first.
- The empty path `""`: the router treats it as `/`. The regex matches it only for root routes whose first segment is optional (`/**`, `/:x*`, `/:x?`, `/*`), not for `/` itself.
- In PCRE and Perl, `$` also matches before a final `\n`, so there the regex also matches `<path>\n`.
- `.` and `..` are not resolved. Normalize the path first if your router uses `normalize: true`.

**Params.** Unnamed captures are named `_0`, `_1`, … in the regex (`"0"`, `"1"`, … in the router). A regex can't capture one group under two names, so there is no group for the router's deprecated `_` alias of a bare `**`: read the numbered one. The regex leaves a group **unset** where the router reports a value in two cases: a `**:name` / `:name+` / `:name*` at the end whose value is two empty segments (`/a///` on `/a/**:x`, where the router reports `/`), and a `*` after a `**` on an empty last segment (`/a//` on `/**/*`, where the router reports `""`). When optional segments meet a `*` or a constrained optional, or several optional segments follow a `**`, the regex can assign a segment to a different param than the router (`/a/:x?/*` on `/a/b` sets `x`, the router sets `*`). The set of matched paths is still the same.

**Errors.** Patterns that `addRoute` rejects throw the same error, and so does a route that declares the same param name twice (`/files/:path/**:path`; a bare `**` takes the name `_`, its deprecated alias).

</details>

<details>
<summary>Regex output and engine support</summary>

The trailing-slash rule (at most one trailing slash, exactly one when the last segment is empty) is built into the end of each regex:

| Route                          | Regex                                                            |
| ------------------------------ | ---------------------------------------------------------------- |
| `/users/:id(\d+)`              | `^\/users\/(?<id>\d+)\/?$`                                       |
| `/path/:id?`                   | `^\/path(?:\/(?<id>[^/]+))?\/?$`                                 |
| `/path/:param`                 | `^\/path\/(?<param>[^/]+)\/?$`                                    |
| `/users/:id/:tab?`             | `^\/users\/(?<id>[^/]+)(?:\/(?<tab>[^/]+))?\/?$`                  |
| `/path/**`                     | `^\/path(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$`                |
| `/base/**:path`                | `^\/base\/(?:\/\/\|(?<path>(?:[\s\S]*[^/]\|\/\/)\/*?)\/?)$`      |
| `/**`                          | `^(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$`                        |
| `/**/_payload.json`            | `^(?:\/(?<_0>[\s\S]*))?\/_payload\.json\/?$`                      |
| `/path/**/suffix`              | `^\/path(?:\/(?<_0>[\s\S]*))?\/suffix\/?$`                       |
| `/**/:file`                    | `^(?:\/(?<_0>[\s\S]*))?\/(?<file>[^/]+)\/?$`                       |
| `/a/**/:page?`                 | `^\/a(?:\/(?<_0>[\s\S]*?))??(?:\/(?<page>[^/]+))?\/?$`            |
| `/`                            | `^\/$`                                                           |
| `/path/:id(\d*)` (look-behind) | `^\/path\/(?<id>\d*)(?:(?<=\/)\/\|(?<!\/)\/?)$`                  |

**Look-behind.** The suffix `(?:(?<=\/)\/|(?<!\/)\/?)$` is only used when the end of the path can't be decided otherwise, for example:

- a constraint at the end of the route whose match can end in `/` (`:name([^.]+)`, `:x(.+)`),
- a required last segment whose constraint can match empty (`/path/:id(\d*)`),
- optional segments side by side where an earlier one can be empty (`/a/:x(\d*)?/:y?`),
- a catch-all combined with optional segments (`/a/**:rest/:page?`, `/a/*/**/:n(\d+)?`, `/a/**/:y?{/b}?`).

Fixed-length look-behinds work in JavaScript, PCRE and Perl, but not in RE2-family engines.

**Optional groups.** A single optional group that ends a segment is compiled inline as `(?:...)?`, so each param appears once:

```js
routeToRegExp("/blog/:id(\\d+){-:title}?");
// /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+?))?\/?$/
routeToRegExp("/files/:name{.:ext}?");
// /^\/files\/(?<name>[^/]+?)(?:\.(?<ext>[^/]+?))?\/?$/
routeToRegExp("/users{/:id}?/posts/:post");
// /^\/users(?:\/(?<id>[^/]+))?\/posts\/(?<post>[^/]+)\/?$/
```

A param in a segment with other text is lazy (`[^/]+?`), like in the router, so `/files/:name{.:ext}?` splits `archive.tar.gz` into `name: "archive"` and `ext: "tar.gz"`, and `/pre-:x?` compiles to `^\/pre-(?:(?<x>[^/]+?))?\/?$` (an optional param in a segment is compiled in place, as in the router: `/*-:x?` is `^\/(?<_0>[^/]*)-(?:(?<x>[^/]+?))?\/?$`). An optional group that starts its segment before more of it is inlined too: `/x/{:id}?(\\d+)` compiles to `^\/x\/(?:(?<id>[^/]+?))?(?<_0>\d+)\/?$`. When the group follows a `*` or a regex constraint in its segment (`/files/*{.:ext}?/raw`), a look-ahead gives the capture the same value as the router. RE2-family engines reject that output.

**Duplicate named groups.** Other optional combinations compile to an alternation: several groups, an in-segment group followed by optional segments (`/:x{.:e}?/:y?`), an optional group after a capture that could take its text (`/media/*{.webp}?`, `/*-x{-x}?`), an optional group before more of its segment that holds a capture or `*`, or is followed by a bare `:name` (`/{x(y)}?(\\d+)`, `/{*-}?(\\d+)`, `/{:foo}?:bar`), `/a/:rest*/b/*` and `/a/**{.png}?`. The alternation repeats a named group. That works in JavaScript engines with duplicate named groups (Node.js 23+, Chrome 125+, Firefox 129+, Safari 17+) and Perl, and needs `PCRE2_DUPNAMES` in strict PCRE2 engines. On Node.js 22, `routeToRegExp` throws a `rou3:` `SyntaxError` for these routes, and `regExpToRoute` can't convert them back.

**Catch-all with optional segments.** With one optional segment right after a `**`, the regex picks the same route as the router (`/a/**/:n(\d+)?` gives `/a/b/1` to `n`). With several, it matches the same paths but may assign segments differently (`/docs/**/:page?/:lang(en|fr)?` on `/docs/en` sets `page`, the router sets `lang`).

</details>

<details>
<summary>What <code>regExpToRoute</code> accepts</summary>

- The dialect `routeToRegExp` emits: `(?<name>...)` groups, `[^/]*` segments and `[^/]+?` params inside one, `[\s\S]*` catch-alls, `(?:/...)?` optional groups and the endings shown above. Unnamed groups such as `(\d+)` work too, and the regex inside a constraint is kept verbatim.
- Looser forms, as older versions emitted: a plain `\/?` ending, `.*` / `.+` catch-alls and `[^/]+` params, read as `:name`. A `:name` inside a segment is lazy, so a hand-written greedy `(?<a>[^/]+)-(?<b>[^/]+)` comes back as `/:a-:b`, which splits `/x-y-z` as `x` and `y-z`. A group right after a `:name` gives the name its own regex, so it isn't read as its constraint: `(?<a>[^/]+?)(?<_0>\d+)` (the regex for `/{:a}(\\d+)`) comes back as `/:a([^\\x2f]+?)(\\d+)`, the same route. An old catch-all inside an optional group is the exception: 0.9.2's regex for `/a{/:w*}?` throws, and its regex for `/a{/:w+}?` comes back as `/a/:w(.+)?` (the current regexes for both come back as `/a/:w*`, the same route). A catch-all group named `_` (how 0.11 and older emitted `**`) still reads as `**`.
- Routes that compile to the same regex come back in one spelling: `/base/**:path` becomes `/base/:path+`, `/**.md` becomes `/**/*.md`, `/a/pre-{:x}?` becomes `/a/pre-:x?`, `/a{/:x+}?` becomes `/a/:x*`, `/a{/**}?` becomes `/a/**` (0.11 read its regex as `/a/:_*`), `/a{/([\s\S]*)}?` becomes `/a/**`, and `/a/:x?/:y?` becomes `/a{/:x/:y?}?`. Percent-encoded text stays encoded: the regex for `/café` comes back as `/caf%C3%A9` (the same route).

It throws for: a regex not anchored with both `^` and `$`, look-arounds and backreferences, regex operators outside a constraint (`|`, `.`, `+`, `[…]`, …), a literal character a route would [percent-encode](#percent-encoding) outside a constraint (`é`, a space, `\{`, `\?`, …: no route matches it), the flags `i`, `m`, `s`, `u` and `v` (`g`, `y` and `d` are ignored), the duplicate-group alternations above, and constraints that can't be written as a route (for example one containing `/`).

</details>

## TypeScript

Route data is typed through the router, and `InferRouteParams` gives you the params of a pattern:

```ts
import { createRouter, addRoute, findRoute, type InferRouteParams } from "rou3";

const router = createRouter<{ page: string }>();
addRoute(router, "GET", "/users/:id", { page: "user" });

findRoute(router, "GET", "/users/42")?.data.page; // string

type Params = InferRouteParams<"/users/:id/:tab?">;
// { id: string; tab: string | undefined }
```

## License

Published under the [MIT](https://github.com/h3js/rou3/blob/main/LICENSE) license.
