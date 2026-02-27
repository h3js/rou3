# 🌳 rou3

<!-- automd:badges codecov bundlejs -->

[![npm version](https://img.shields.io/npm/v/rou3)](https://npmjs.com/package/rou3)
[![npm downloads](https://img.shields.io/npm/dm/rou3)](https://npm.chart.dev/rou3)
[![bundle size](https://img.shields.io/bundlejs/size/rou3)](https://bundlejs.com/?q=rou3)
[![codecov](https://img.shields.io/codecov/c/gh/h3js/rou3)](https://codecov.io/gh/h3js/rou3)

<!-- /automd -->

Lightweight and fast router for JavaScript.

## Usage

**Install:**

```sh
# ✨ Auto-detect
npx nypm install rou3
```

**Import:**

<!-- automd:jsimport cdn src="./src/index.ts"-->

**ESM** (Node.js, Bun, Deno)

```js
import {
  createRouter,
  addRoute,
  findRoute,
  removeRoute,
  findAllRoutes,
  routeToRegExp,
  NullProtoObj,
} from "rou3";
```

**CDN** (Deno and Browsers)

```js
import {
  createRouter,
  addRoute,
  findRoute,
  removeRoute,
  findAllRoutes,
  routeToRegExp,
  NullProtoObj,
} from "https://esm.sh/rou3";
```

<!-- /automd -->

**Create a router instance and insert routes:**

```js
import { createRouter, addRoute } from "rou3";

const router = createRouter(/* options */);

addRoute(router, "GET", "/path", { payload: "this path" });
addRoute(router, "POST", "/path/:name", { payload: "named route" });
addRoute(router, "GET", "/path/foo/**", { payload: "wildcard route" });
addRoute(router, "GET", "/path/foo/**:name", {
  payload: "named wildcard route",
});
```

**Match route to access matched data:**

```js
// Returns { payload: 'this path' }
findRoute(router, "GET", "/path");

// Returns { payload: 'named route', params: { name: 'fooval' } }
findRoute(router, "POST", "/path/fooval");

// Returns { payload: 'wildcard route' }
findRoute(router, "GET", "/path/foo/bar/baz");

// Returns undefined (no route matched for/)
findRoute(router, "GET", "/");
```

> [!IMPORTANT]
> Paths should **always begin with `/`**.

> [!IMPORTANT]
> Method should **always be UPPERCASE**.

> [!TIP]
> If you need to register a pattern containing literal `:` or `*`, you can escape them with `\\`. For example, `/static\\:path/\\*\\*` matches only the static `/static:path/**` route.

## Route Patterns

rou3 supports a variety of route patterns, including [URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API)-compatible syntax.

### Static

```
/path/to/resource
```

### Named Parameters

`:name` matches a single path segment.

```
/users/:name        →  /users/foo        → { name: "foo" }
```

### Wildcards

`**` matches zero or more segments. Use `**:name` to capture the matched path.

```
/path/**            →  /path/foo/bar     → {}
/path/**:rest       →  /path/foo/bar     → { rest: "foo/bar" }
```

### Regex Constraints

`:name(regex)` restricts a named parameter to match only the given pattern.

```
/users/:id(\d+)          →  /users/123     → { id: "123" }
                          →  /users/abc     → (no match)
/files/:ext(png|jpg|gif) →  /files/png     → { ext: "png" }
                          →  /files/pdf     → (no match)
```

Regex-constrained and unconstrained params can coexist on the same path node (constrained routes are checked first):

```
/users/:id(\d+)   +   /users/:slug
  /users/123  → { id: "123" }
  /users/abc  → { slug: "abc" }
```

### Unnamed Regex Groups

`(regex)` without a parameter name captures into auto-indexed keys `_0`, `_1`, etc.

```
/path/(\d+)              →  /path/123      → { _0: "123" }
/files/(png|jpg|gif)     →  /files/png     → { _0: "png" }
```

### Modifiers

- `:name?` — optional (zero or one segment)
- `:name+` — one or more segments
- `:name*` — zero or more segments

```
/users/:id?              →  /users/123     → { id: "123" }
                          →  /users         → {}
/files/:path+            →  /files/a/b/c   → { path: "a/b/c" }
                          →  /files         → (no match)
/files/:path*            →  /files/a/b/c   → { path: "a/b/c" }
                          →  /files         → {}
```

Modifiers can be combined with regex constraints:

```
/users/:id(\d+)?         →  /users/123     → { id: "123" }
                          →  /users         → {}
                          →  /users/abc     → (no match)
```

## Compiler

<!-- automd:jsdocs src="./src/compiler.ts" -->

### `compileRouter(router, opts?)`

Compiles the router instance into a faster route-matching function.

**IMPORTANT:** `compileRouter` requires eval support with `new Function()` in the runtime for JIT compilation.

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

### `compileRouterToString(router, functionName?, opts?)`

Compile the router instance into a compact runnable code.

**IMPORTANT:** Route data must be serializable to JSON (i.e., no functions or classes) or implement the `toJSON()` method to render custom code or you can pass custom `serialize` function in options.

**Example:**

```ts
import { createRouter, addRoute } from "rou3";
import { compileRouterToString } from "rou3/compiler";
const router = createRouter();
// [add some routes with serializable data]
const compilerCode = compileRouterToString(router, "findRoute");
// "const findRoute=(m, p) => {}"
```

<!--/automd -->

## License

<!-- automd:contributors license=MIT author="pi0" -->

Published under the [MIT](https://github.com/h3js/rou3/blob/main/LICENSE) license.
Made by [@pi0](https://github.com/pi0) and [community](https://github.com/h3js/rou3/graphs/contributors) 💛
<br><br>
<a href="https://github.com/h3js/rou3/graphs/contributors">
<img src="https://contrib.rocks/image?repo=h3js/rou3" />
</a>

<!-- /automd -->

<!-- automd:with-automd -->

---

_🤖 auto updated with [automd](https://automd.unjs.io)_

<!-- /automd -->
