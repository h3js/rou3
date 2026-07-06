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
  routesOverlap,
  compareRoutes,
  findOverlappingRoutes,
  routeToRegExp,
  regExpToRoute,
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
  routesOverlap,
  compareRoutes,
  findOverlappingRoutes,
  routeToRegExp,
  regExpToRoute,
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

**Match all routes, ordered least → most specific:**

```js
findAllRoutes(router, "GET", "/path/foo/bar/baz");
// [
//   { data: { payload: "wildcard route" } },
//   { data: { payload: "named wildcard route" }, params: { name: "bar/baz" } },
// ]
```

The result ordering is a documented contract — see [Result ordering](#result-ordering).

> [!IMPORTANT]
> Paths should **always begin with `/`**.

> [!IMPORTANT]
> Method should **always be UPPERCASE**.

> [!TIP]
> If you need to register a pattern containing literal `:` or `*`, you can escape them with `\\`. For example, `/static\\:path/\\*\\*` matches only the static `/static:path/**` route.

## Route Patterns

rou3 supports [URLPattern](https://developer.mozilla.org/en-US/docs/Web/API/URL_Pattern_API)-compatible syntax.

| Pattern                     | Example Match                      | Params                                               |
| --------------------------- | ---------------------------------- | ---------------------------------------------------- |
| `/path/to/resource`         | `/path/to/resource`                | `{}`                                                 |
| `/users/:name`              | `/users/foo`                       | `{ name: "foo" }`                                    |
| `/path/**`                  | `/path/foo/bar`                    | `{}`                                                 |
| `/path/**:rest`             | `/path/foo/bar`                    | `{ rest: "foo/bar" }`                                |
| `/files/*.png`              | `/files/icon.png`                  | `{ "0": "icon" }`                                    |
| `/files/file-*-*.png`       | `/files/file-a-b.png`              | `{ "0": "a", "1": "b" }`                             |
| `/users/:id(\\d+)`          | `/users/123`                       | `{ id: "123" }`                                      |
| `/files/:ext(png\|jpg)`     | `/files/png`                       | `{ ext: "png" }`                                     |
| `/path/(\\d+)`              | `/path/123`                        | `{ "0": "123" }`                                     |
| `/users/:id?`               | `/users` or `/users/123`           | `{}` or `{ id: "123" }`                              |
| `/files/:path+`             | `/files/a/b/c`                     | `{ path: "a/b/c" }`                                  |
| `/files/:path*`             | `/files` or `/files/a/b`           | `{}` or `{ path: "a/b" }`                            |
| `/book{s}?`                 | `/book` or `/books`                | `{}`                                                 |
| `/blog/:id(\\d+){-:title}?` | `/blog/123` or `/blog/123-my-post` | `{ id: "123" }` or `{ id: "123", title: "my-post" }` |

- **Named params** (`:name`) match a single segment.
- **Single-segment wildcards** (`*`) capture unnamed params (`0`, `1`, ...) and can be used as full or mid-segment tokens (for example `/*` or `/*.png`).
- **Wildcards** (`**`) match zero or more segments. Use `**:name` to capture.
- **Regex constraints** (`:name(regex)`) restrict matching. Constrained and unconstrained params can coexist on the same node (constrained checked first).
- **Unnamed groups** (`(regex)`) capture into auto-indexed keys `0`, `1`, etc.
- **Modifiers:** `:name?` (optional), `:name+` (one or more), `:name*` (zero or more). Can combine with regex: `:id(\d+)?`.
- **Non-capturing groups** (`{...}`): supported with inline (`/foo{bar}`) and optional (`/foo{bar}?`) forms.
- **Current limitation:** repeating non-capturing groups (`{...}+`, `{...}*`) are supported only within a single segment (no `/` inside the group body).
- **Backslash escaping** (`\`): escape special characters like `:`, `*`, `(`, `)`, `{`, `}` with a backslash (e.g., `/static\:path` matches literal `/static:path`).

### Differences from URLPattern

rou3 aims for URLPattern-compatible syntax but has intentional differences due to its radix-tree design:

| Feature                       | URLPattern                         | rou3                                                          |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `*` (single star)             | Greedy catch-all `(.*)` across `/` | Single-segment unnamed param `([^/]*)`                        |
| `**` (double star)            | Literal `**`                       | Catch-all wildcard (zero or more segments)                    |
| `(.*)` in segment             | Greedy match across `/`            | Segment-scoped (does not cross `/`)                           |
| `{...}+` / `{...}*` groups    | Cross-segment group repetition     | Only supported within a single segment (no `/` in group body) |
| Path normalization (`.`/`..`) | Resolves `.`/`..` in input paths   | Not done by default (opt-in with `{ normalize: true }`)       |
| Case sensitivity              | Can be case-insensitive            | Always case-sensitive                                         |
| Non-`/`-prefixed paths        | Supported                          | Paths must start with `/`                                     |
| Unicode param names           | Supports Unicode identifiers       | Params use `\w` (ASCII word chars only)                       |
| Percent-encoding              | Normalizes `%xx` sequences         | Does not decode percent-encoded input                         |

### Path normalization

By default, `findRoute` and `findAllRoutes` do **not** resolve `.`/`..` segments in input paths. If your input paths may contain relative segments, enable normalization:

```js
findRoute(router, "GET", "/foo/bar/../baz", { normalize: true });
// Matches "/foo/baz"

findAllRoutes(router, "GET", "/foo/./bar", { normalize: true });
// Matches "/foo/bar"
```

The compiled router also supports this via the `normalize` option:

```js
const match = compileRouter(router, { normalize: true });
match("GET", "/foo/bar/../baz"); // Matches "/foo/baz"
```

### Result ordering

`findAllRoutes` returns matches ordered **least → most specific**: the broadest scopes first, the most specific match last. The compiled `matchAll` (see [Compiler](#compiler)) returns the **exact same results in the exact same order**. This ordering is a **contract**, not incidental behavior — merge/fold-style consumers (e.g. route rules resolved by merging all matched layers, taking the last as the most specific) can rely on it, and it is pinned by tests. Any intentional change to it would be a breaking change.

```js
const router = createRouter();
addRoute(router, "GET", "/**", { name: "catch-all" });
addRoute(router, "GET", "/api/**", { name: "api" });
addRoute(router, "GET", "/api/:v/users/:id", { name: "user" });

findAllRoutes(router, "GET", "/api/v1/users/42").map((m) => m.data.name);
// ["catch-all", "api", "user"]
```

Precisely:

- **Across the tree:** at each level, wildcard (`**`) matches are emitted first, then single-segment params (`*`, `:name`), then static segments — so wilder/shallower routes come before more-static/deeper ones.
- **Same-node siblings** (multiple routes ending on the same dynamic node, e.g. `/foo/*` and `/foo/:id(\d+)`): ordered by ascending specificity — optional/unconstrained entries before required/regex-constrained ones — with **insertion order preserved on ties**.
- **Subsumption consistency:** when registered patterns are strictly ordered by containment (each a `"superset"` of the next per [`compareRoutes`](#pattern-overlap)), the result order agrees with the subsumption order (broader first).
- Registration order never affects the result order, except as the tiebreaker between equally specific same-node siblings.

[`findOverlappingRoutes`](#pattern-overlap) follows the same least → most specific order.

### Pattern overlap

`findRoute`/`findAllRoutes` match a **concrete path** against registered patterns. Sometimes you instead need to reason about **patterns against patterns** — e.g. to resolve an "effective" merged config over a whole scope, you need to know when two patterns can match a common concrete path.

Three utilities cover this:

```js
import { createRouter, addRoute, routesOverlap, compareRoutes, findOverlappingRoutes } from "rou3";

// Do two patterns share at least one concrete path? (pure, router-free)
routesOverlap("/**", "/protected/feed/**"); // true
routesOverlap("/a/**", "/b/**"); // false

// How do two patterns' match-sets relate? (pure, router-free)
compareRoutes("/api/**", "/api/admin/**"); // "superset"
compareRoutes("/api/admin/**", "/api/**"); // "subset"
compareRoutes("/a/:x", "/a/:y"); // "equal" (names don't matter)
compareRoutes("/a/*/c", "/a/b/*"); // "partial" (ambiguous specificity)

// Every registered route whose match-set intersects a *pattern* (a scope),
// ordered least -> most specific like findAllRoutes.
const router = createRouter();
addRoute(router, "GET", "/**", { isr: true });
addRoute(router, "GET", "/protected/**", { basicAuth: true });
addRoute(router, "GET", "/protected/feed/**", { isr: 60 });

findOverlappingRoutes(router, "GET", "/protected/feed/**");
// [ { data: { isr: true } },        // /**
//   { data: { basicAuth: true } },  // /protected/**
//   { data: { isr: 60 } } ]         // /protected/feed/**
```

- **`routesOverlap(patternA, patternB)`** — returns `true` if the two patterns' match-sets intersect (there **exists a concrete path matched by both**). This is _overlap_, not subset containment.
- **`compareRoutes(patternA, patternB)`** — classifies the relation between the two match-sets. Verdicts follow the ES2025 Set-method vocabulary (`isSupersetOf`/`isSubsetOf`/`isDisjointFrom`) and are directional — read them as "`patternA` is a … of `patternB`":
  - `"disjoint"` — provably no common path.
  - `"equal"` — provably the same paths. Param _names_ are ignored: `/a/:x` equals `/a/:y`, `/u/:id(\d+)` equals `/u/:x(\d+)`, and `/a/:x?` equals `/a/*`.
  - `"superset"` — `patternA` provably matches every path `patternB` matches (strict unless equality is undecidable).
  - `"subset"` — the mirror image (`patternA` ⊆ `patternB`).
  - `"partial"` — no containment proven; the sets _may_ intersect.

  Useful for ordering patterns by specificity and detecting ambiguous pairs where "most specific match" is undefined. Every verdict's containment claims are proofs, and undecidable cases degrade to a **weaker verdict, never a wrong claim**: containment between two different regex constraints falls back to `"partial"` (even when the sets are actually disjoint — see the over-approximation note below — or actually equal), and an actually-equal pair whose equality is only provable in one direction (e.g. `/u/:id(42)` vs `/u/42`) reports the proven containment instead of `"equal"`.


- **`findOverlappingRoutes(router, method, pattern)`** — like `findAllRoutes`, but the query is a **pattern** instead of a concrete path. Returns every registered route whose match-set intersects the pattern, ordered least → most specific, with the same method handling as `findAllRoutes` (falls back to the method-agnostic bucket). Matches carry only `data` — a scope has no single concrete path, so no `params` are resolved. A single route registered with optional/group syntax expands into several tree entries sharing one `data` reference and is reported once; distinct routes are always reported separately, even when they share an equal primitive `data` value (or none).

**Overlap semantics** are computed with rou3's own segment/radix rules, so they stay consistent with `findRoute`/`findAllRoutes`:

- Patterns are expanded through the same pipeline as `addRoute`, so groups (`{s}?`), optional/repeat modifiers (`:x?`/`:x+`/`:x*`), and escaping (`\:`, `\*`) are all respected. A pattern with optional syntax expands to several shapes; two patterns overlap when **any** pair of shapes overlaps.
- **Segment counts:** bare `**` matches **zero or more** segments (so `/a/**` overlaps `/a`), `**:name` matches **one or more**, a **trailing** bare `*` matches **zero or one**, and mid-pattern `*` / `:name` match **exactly one**.
- **Regex constraints** (`:id(\d+)`, unnamed groups, `*.png`) are matched **precisely against static literals** (`/user/:id(\d+)` does _not_ overlap `/user/abc`), but two dynamic segments where at least one is constrained are **over-approximated to "overlaps"** — `routesOverlap("/user/:id(\d+)", "/user/:name([a-z]+)")` returns `true` even though the sets are disjoint. Exact regex intersection is undecidable, and over-approximating toward "overlaps" is the safe conservative default.

### Regular expressions

`routeToRegExp(route)` converts a route pattern into an anchored `RegExp` with named capture groups, useful outside the router (validation, codegen, matching in other tools):

```js
import { routeToRegExp } from "rou3";

routeToRegExp("/users/:id(\\d+)");
// /^\/users\/(?<id>\d+)\/?$/  ->  "/users/123".match(re).groups // { id: "123" }
```

The output is **PCRE-compatible**: it uses `(?<name>...)` named groups and avoids JS-only constructs, so the generated `.source` also compiles in PCRE2 engines (`grep -P`, `rg -P`, `pcre2grep`, PHP `preg_*`) and Perl — not just JavaScript. In particular, trailing optional groups are compiled inline as `(?:...)?` instead of an alternation, so a param is never emitted twice as a duplicate named group (which PCRE2 rejects unless `PCRE2_DUPNAMES` is set):

```js
routeToRegExp("/blog/:id(\\d+){-:title}?");
// /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+))?\/?$/
```

> [!NOTE]
> Multi-group or mid-route optionals that cannot be inlined fall back to an alternation and may contain duplicate named groups. That output is valid in JavaScript (per the TC39 duplicate-named-groups proposal) and Perl, but requires `PCRE2_DUPNAMES` on strict PCRE2 engines.

`regExpToRoute(regexp)` is the inverse: it parses an anchored, PCRE-compatible `RegExp` (or its `source` string) back into a route pattern. Pass either a `RegExp` or a source string:

```js
import { regExpToRoute } from "rou3";

regExpToRoute(/^\/users\/(?<id>\d+)\/?$/); // "/users/:id(\\d+)"
regExpToRoute(/^\/path\/(?<param>[^/]+)\/?$/); // "/path/:param"
regExpToRoute(/^\/base\/?(?<path>.+)\/?$/); // "/base/**:path"
regExpToRoute("^\\/files\\/(?<_0>[^/]*)\\.png\\/?$"); // "/files/*.png"
```

It targets the dialect `routeToRegExp()` emits — named groups `(?<name>...)`, `[^/]+`/`[^/]*` segment matchers, `.*`/`.+` catch-alls, and `(?:/...)?` optional groups. Bare (unnamed) capturing groups such as `(\d+)` are accepted too, and arbitrary regex inside an inline constraint `(...)` is preserved verbatim. Every reversible output round-trips exactly: `routeToRegExp(regExpToRoute(regexp)).source === regexp.source`.

Anything outside that dialect throws a clear error rather than returning a corrupt pattern: structural look-arounds (`(?=…)`, `(?<=…)`) and backreferences, bare regex operators outside a constraint (`|`, `.`, `+`, `[…]`, …), match-affecting flags (`i`/`m`/`s`), the non-reversible alternation fallback described above, and inline constraints that can't be expressed as a route (e.g. one containing `/`).

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
