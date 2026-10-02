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
| `/files/*`                  | `/files/` or `/files/a/b`                | `{ "0": "" }` or `{ "0": "a/b" }`                    |
| `/files/*.png`              | `/files/icon.png` or `/files/a/icon.png` | `{ "0": "icon" }` or `{ "0": "a/icon" }`             |
| `/files/:path(.*)`          | `/files/` or `/files/a/b`                | `{ path: "" }` or `{ path: "a/b" }`                  |
| `/path/**`                  | `/path/foo/bar`                          | `{ "0": "foo/bar", _: "foo/bar" }` (`_` is deprecated) |
| `/path/**:rest`             | `/path/foo/bar`                          | `{ rest: "foo/bar" }`                                |
| `/**/_payload.json`         | `/_payload.json` or `/a/b/_payload.json` | `{}` or `{ "0": "a/b", _: "a/b" }`                   |
| `/**.md`                    | `/docs/intro.md`                         | `{ "0": "docs/intro" }`                              |
| `/book{s}?`                 | `/book` or `/books`                      | `{}`                                                 |
| `/blog/:id(\\d+){-:title}?` | `/blog/123` or `/blog/123-my-post`       | `{ id: "123" }` or `{ id: "123", title: "my-post" }` |
| `/files/:name.:ext`         | `/files/a.tar.gz`                        | `{ name: "a", ext: "tar.gz" }`                       |
| `/v:version?`               | `/v` or `/v2`                            | `{}` or `{ version: "2" }`                           |

> [!NOTE]
> In JavaScript strings a regex backslash is written twice: `"/users/:id(\\d+)"` is the pattern `/users/:id(\d+)`.

### Params

- **`:name`** matches one segment: `/users/:name`. It can also sit inside a segment: `/blog/:year-:month`. Several captures in one segment split like URLPattern: a `:name` takes as little as it can (`/:name.:ext` on `/a.tar.gz` gives `{ name: "a", ext: "tar.gz" }`).
- **`:name(regex)`** matches only when the regex does: `/users/:id(\\d+)`. The regex sees one segment and can't contain `/`. The exception is `:name(.*)`, which is a [`*`](#wildcards) captured into `name`.
- **`(regex)`** without a name captures into a numbered key (`"0"`, `"1"`, …): `/path/(\\d+)`. To group inside a regex, use `(?:…)`.
- **Modifiers** go after a param that fills its whole segment:
  - `:name?`: zero or one segment (also with a regex: `:id(\\d+)?`).
  - `:name+`: one or more segments. `/files/:path+` on `/files/a/b` gives `{ path: "a/b" }`.
  - `:name*`: zero or more segments. `/files/:path*` also matches `/files`.
  - As in URLPattern, the segments a `+` or `*` takes can't be empty: `/files/:path+` doesn't match `/files//a`. Use `/files/**` to accept empty segments.
- **`?` inside a segment** makes only the param optional, not the segment: `/pre-:x?` matches `/pre-` and `/pre-a`, but not `/`. To make the whole segment optional, use a group: `/{pre-:x}?`.
- A param that didn't match has no key in `params`.
- Names are ASCII identifiers (`[A-Za-z_][A-Za-z0-9_]*`), and `-` ends one: `/users/:user-id` is the param `user` followed by `-id`. See the [param naming rules](./docs/reference.md#param-naming-rules).

### Wildcards

| Syntax                 | Matches                            | Key                       | Empty segments |
| ---------------------- | ---------------------------------- | ------------------------- | -------------- |
| `*`                    | the rest of the path, `/` included | `"0"`, `"1"`, …           | allowed        |
| `(.*)`                 | same as `*`                        | `"0"`, `"1"`, …           | allowed        |
| `:name(.*)`            | same as `*`                        | `name`                    | allowed        |
| `**`                   | zero or more segments              | `"0"`, `"1"`, … (and `_`) | allowed        |
| `**:name` (= `:name+`) | one or more segments               | `name`                    | not allowed    |

- **`*`** matches the rest of the path, `/` included, like URLPattern's `*`: `/files/*` on `/files/a/b` gives `{ "0": "a/b" }`. Inside a segment it takes the rest of that segment and everything after it: `/files/*.png` on `/files/a/icon.png` gives `{ "0": "a/icon" }`. For exactly one segment, use a `:name`.
- **At the end of a route, a `*` is optional**, as in rou3 0.11 (URLPattern requires it). `/files/*` also matches `/files` (no key) and `/files/` (`{ "0": "" }`), so a middleware on `/api/*` also covers `/api`. To require at least one segment, use `/files/:path+`.
- **`**`** matches zero or more segments: `/docs/**` matches `/docs` (no key) and `/docs/a/b` (`{ "0": "a/b", _: "a/b" }`), and `/docs/**/x` also matches `/docs/x`.
- **Segments after a catch-all** are matched from the **end** of the path, and the catch-all takes whatever is in between: `/**/_payload.json` matches `_payload.json` in any directory, and `/blog/**:path/og.png` matches `og.png` anywhere under `/blog`.
- **One catch-all per route**: `/*/x/*` throws. Write `/:a/x/*` to capture one segment and the rest.
- **Unnamed captures** (`*`, `**` and `(regex)`) are numbered in pattern order, as in URLPattern.

See [wildcards in detail](./docs/reference.md#wildcards-in-detail) for `(.*)`, empty segments and numbered keys in optional groups.

> [!WARNING]
> **`_` is deprecated.** It is the name rou3 0.11 and older used for a bare `**`'s capture, kept so `params._` still works. Read the numbered key instead: `_` will be removed in a future version.

### Groups

`{...}` groups part of a pattern without capturing it. Add `?` to make it optional:

- `/book{s}?` matches `/book` and `/books`.
- `/users{/:id}?/posts` matches `/users/posts` and `/users/42/posts`.
- `{/:lang}?/docs` matches `/docs` and `/en/docs` (see [groups at the start of a pattern](./docs/reference.md#groups-at-the-start-of-a-pattern)).

Groups can't be nested or repeated (`{...}+` and `{...}*` throw).

### Escaping and encoding

Escape `:`, `*`, `?`, `+`, `(`, `)`, `{` and `}` with a backslash to match them literally. Outside a regex constraint, any escaped character is literal (`\\.` is `.`), as in URLPattern.

```js
addRoute(router, "GET", "/static\\:path/\\*\\*", {}); // matches only "/static:path/**"
addRoute(router, "GET", "/files/\\(2024\\)", {}); // matches only "/files/(2024)"
```

The literal text of a pattern is percent-encoded once, when the route is added, as URLPattern does. Lookup paths are **never** decoded or encoded, so pass the encoded pathname (`new URL(req.url).pathname`):

```js
addRoute(router, "GET", "/café/:id", {});
findRoute(router, "GET", "/caf%C3%A9/1"); // { data: {}, params: { id: "1" } }
findRoute(router, "GET", "/café/1"); // undefined
```

Regex constraints are not encoded: write `:x(%C3%A9)`, not `:x(é)`. See [percent-encoding](./docs/reference.md#percent-encoding) for exactly what is encoded.

`.` and `..` segments in a pattern are resolved like `new URL()` resolves a path: `/docs/../api/:id` is `/api/:id` (see [dot segments](./docs/reference.md#dot-segments)).

### Invalid patterns and URLPattern differences

`addRoute` throws a `rou3:` error that quotes the pattern when the syntax has no clear meaning (an unclosed `(` or `{`, a misplaced modifier, a repeated param name, a second catch-all, …), instead of silently matching something unexpected. The full list is in [invalid patterns](./docs/reference.md#invalid-patterns).

rou3 matches HTTP request paths segment by segment in a tree, so it differs from URLPattern in a few intentional ways: one trailing slash is ignored, a trailing `*` is optional, a route has at most one catch-all, and matching is always case-sensitive. See [differences from URLPattern](./docs/reference.md#differences-from-urlpattern) for the full table and edge cases.

## Matching

### Methods and paths

rou3 doesn't normalize lookup input, so do it before calling `findRoute`:

- **Paths** must start with `/`. For other input, `findRoute` and the compiled matcher may answer differently.
- **Paths** must be percent-encoded, as `new URL().pathname` gives them, since a route's literal text is encoded (see [escaping and encoding](#escaping-and-encoding)).
- **Methods** must be UPPERCASE: `"GET"`, not `"get"`.

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

- A lookup sees the routes for its method and the method-agnostic ones together, and the most specific one wins.
- When two routes are equally specific, the one registered for the method wins over the method-agnostic one (and comes after it in `findAllRoutes`).
- A lookup with the method `""` only sees method-agnostic routes.

### Trailing slashes and empty segments

- **One trailing slash is ignored** in lookup paths: `/users/foo/` matches `/users/:name`, `/users/foo//` doesn't. The only route that sees the slash is one ending in `*`: `/users/*` gives `{ "0": "" }` on `/users/` (as in URLPattern) and no key on `/users`.
- **Trailing slashes in patterns are ignored**: `/users/`, `/users//` and `/users` are the same route.
- **Empty segments in the middle count**: `/a//b` doesn't match `/a/b`.
- **Named params need a value**, as in URLPattern: a `:name` never captures `""`, and no segment a `:name+`, `:name*` or `**:name` takes can be empty (a `:name*` can match no segment instead).
- **Wildcards and constraints can be empty**: a `*`, a `**`, or a regex constraint that can match empty (`:id(\\d*)`) takes an empty segment.

See [the examples](./docs/reference.md#trailing-slashes-and-empty-segments) side by side.

### Path normalization

`.` and `..` segments in input paths are **not** resolved by default. If your input paths may contain them, enable `normalize`:

```js
findRoute(router, "GET", "/foo/bar/../baz", { normalize: true }); // matches "/foo/baz"
findAllRoutes(router, "GET", "/foo/./bar", { normalize: true }); // matches "/foo/bar"
```

Only literal `.` and `..` segments are resolved, not percent-encoded ones (see [path normalization](./docs/reference.md#path-normalization)). The [compiler](#compiler) accepts the same option: `compileRouter(router, { normalize: true })`.

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

In short:

- Static segments beat params, and params beat wildcards.
- On the same kind of segment, a constrained or required param beats an optional or unconstrained one.
- In a segment mixing params and text, more literal text wins (`/f/:name.png` beats `/f/:name.:ext`).
- Segments after a catch-all (`/**/_payload.json`) are ranked from the end of the path.
- Registration order only breaks exact ties: `findRoute` returns the first-registered of the tied routes, and `findAllRoutes` lists them in registration order (so there the winner is not the last entry).

Each route is listed once, even when several variants of an optional pattern match the path. It gets the params `findRoute` would give it, and its position is that variant's. Registering the same pattern twice adds two routes, and both are listed:

```js
const router = createRouter();
addRoute(router, "GET", "/shop/:category?/:product?", { name: "shop" });

// Both `/shop/:category` and `/shop/:product` match
findAllRoutes(router, "GET", "/shop/shoes");
// [{ data: { name: "shop" }, params: { category: "shoes" } }]
```

Because optional syntax is ordered by the variant that matched, a broader optional pattern can come after a narrower one. See the [detailed ordering rules](./docs/reference.md#detailed-ordering-rules) for the full rules and their carve-outs.

### Removing routes

`removeRoute(router, method, pattern)` removes everything that the matching `addRoute` call added, including all variants of an optional pattern and duplicate registrations. Other routes are left alone, even ones that share a tree node:

```js
addRoute(router, "GET", "/path/:id", { a: true });
addRoute(router, "GET", "/path/:name", { b: true });

removeRoute(router, "GET", "/path/:name"); // "/path/:id" is still registered
```

Pass the pattern as you registered it: `/path/*` doesn't remove `/path/:name` (see [removing routes](./docs/reference.md#removing-routes)).

## Compiler

For the fastest lookups, compile a router into a single function. The compiled function returns the same results as `findRoute` (or `findAllRoutes` with `matchAll: true`).

- **`compileRouter`** compiles at runtime (JIT) with `new Function()`.
- **`compileRouterToString`** generates code ahead of time (AOT), for example into a build output. It needs no `eval` and no rou3 at runtime.

Both are imported from `rou3/compiler`.

<!-- automd:jsdocs src="./src/compiler.ts" -->

### `compileRouter(router, opts?)`

Compile the router into one fast matching function, at runtime (JIT).

**IMPORTANT:** `compileRouter` uses `new Function()`, which a CSP without `unsafe-eval` blocks. Use `compileRouterToString` at build time there.

The compiled function is a **snapshot**: routes added or removed afterwards aren't seen, so compile again after changing the router. Route data is kept by reference. It returns what `findRoute` returns (with `matchAll: true`, what `findAllRoutes` returns), except that `params` is a plain object instead of a null-prototype one.

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

Compile the router into JavaScript code, ahead of time (for example into a build output).

The output is a self-contained expression (or a `const <functionName>=…;` statement): no imports, no rou3 at runtime, and no `eval` / `new Function()`, so it runs under a strict CSP. It needs ES2018 (named capture groups, object spread). Like `compileRouter`, it is a **snapshot** of the router.

**IMPORTANT:** The generated code is **not** stable across rou3 versions: generate it at build time with the installed rou3, and don't commit, patch or parse it.

**IMPORTANT:** Route data is emitted with `JSON.stringify` (`toJSON()` applies at every depth). Data containing a function, symbol or bigint throws: pass `opts.serialize` to emit each route's data as your own JavaScript expression instead.

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
- **`findOverlappingRoutes(router, method, pattern)`** works like `findAllRoutes`, but takes a pattern instead of a path: it returns every registered route that can match a path the pattern matches. The order and the method handling are the same as in `findAllRoutes`. Matches only have `data`, since there is no single path to read params from. A route registered with optional syntax is reported once.

These utilities understand the full pattern syntax (groups, modifiers, escapes) using the same rules as the router, so their answers agree with `findRoute`. Answers are safe, not always exact: a containment or disjointness claim is proven, and anything that can't be decided (such as two different regex constraints) comes back as `"partial"`. See [precision and limits](./docs/reference.md#pattern-overlap-precision-and-limits).

### Route node keys

Different patterns can end on the **same node** of the route tree: `/users/:id` and `/users/:name` both mean "any single segment under `/users`", and `/users/*`, `/users/**` and `/users/**:rest` are catch-alls under `/users`. `routeNodeKeys(pattern)` returns the node(s) a pattern lands on, naming a param segment `:_0`, `:_1`, … and a catch-all `**`:

```js
import { routeNodeKeys } from "rou3";

routeNodeKeys("/users/:id"); // ["/users/:_0"]
routeNodeKeys("/users/:name"); // ["/users/:_0"] (same node as /users/:id)
routeNodeKeys("/users/*"); // ["/users/**"] (same node as /users/**)
routeNodeKeys("/**:path/og.png"); // ["/**/og.png"]
routeNodeKeys("/a/:x?"); // ["/a", "/a/:_0"] (optional syntax lands on two nodes)
```

Routes on the same node compete: for a given path, `findRoute` returns at most one of them. If you keep your own per-route metadata (route rules, middleware, auth) in a map keyed by pattern text, `/users/*` and `/users/**:rest` look unrelated. Key the map by `routeNodeKeys` instead, to merge metadata per node or warn when one route shadows another.

> `routeNodeKeys(a)` and `routeNodeKeys(b)` share a key **if and only if** `a` and `b` share a node.

- The result is a deduplicated array, since optional syntax registers on several nodes (`/x{/a}?{/b}?` registers on 4).
- Each key is itself a valid pattern for its node: `routeNodeKeys(key)` is `[key]`.
- Invalid patterns throw exactly like `addRoute`.

> [!IMPORTANT]
> Sharing a node does **not** mean matching the same paths. Keys drop regex constraints and widen `**:name` and `*` to `**`, so `/u/:id(\d+)` and `/u/:slug([a-z]+)` share the key `/u/:_0` but never match the same path. To compare which paths two patterns match, use [`compareRoutes`](#pattern-overlap).

### Regular expressions

`routeToRegExp(route)` converts a pattern into an anchored `RegExp` with named groups for the params:

```js
import { routeToRegExp } from "rou3";

const re = routeToRegExp("/users/:id(\\d+)");
// /^\/users\/(?<id>\d+)\/?$/

"/users/123".match(re).groups; // { id: "123" }
```

The regex matches **exactly the paths `findRoute` matches** on a router that only holds that route, including the router's tolerances (one optional trailing slash, empty segments, an optional trailing `*`, segments after a catch-all matched from the end). That makes it safe to use as a guard or scope check outside the router. Like `findRoute` without `normalize`, it compares paths as-is.

The one exception is a regex constraint that can match `/`, such as `(.+)`: the router applies it to one segment, but in the regex it can span several, so `routeToRegExp("/foo/(.+)")` also matches `/foo/a/b`. The regex then matches more paths than the router, never fewer, so a guard built on it still runs.

The output is **PCRE-compatible**, so its `.source` also works in `grep -P`, `rg -P`, PHP `preg_*` and Perl. Most routes also compile without look-behind, so they work in RE2-family engines (RE2, Go `regexp`, Rust `regex`). A few shapes of params sharing a segment can still backtrack on long failing paths; cap the path length where that matters (most servers already do).

`regExpToRoute(regexp)` goes the other way. It accepts a `RegExp` or its source string:

```js
import { regExpToRoute } from "rou3";

regExpToRoute(/^\/users\/(?<id>\d+)\/?$/); // "/users/:id(\\d+)"
regExpToRoute(/^\/path\/(?<param>[^/]+)\/?$/); // "/path/:param"
regExpToRoute("^\\/files\\/(?<_0>[\\s\\S]*)\\.png\\/?$"); // "/files/*.png"
```

It understands the regexes `routeToRegExp` emits, and every one of them round-trips exactly: `routeToRegExp(regExpToRoute(re)).source === re.source`. It also reads the looser regexes older rou3 versions emitted. Anything else throws a `rou3:` error instead of returning a wrong pattern.

The [reference](./docs/reference.md#regular-expressions) has what the regex doesn't model, backtracking, the regex for each kind of route, engine support and the forms `regExpToRoute` accepts.

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
