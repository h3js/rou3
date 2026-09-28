# Migrating from 0.9 to 1.0

This lists the behavior changes since rou3 0.9.2 that can affect existing code. Most shipped in 0.10.x, see [CHANGELOG.md](./CHANGELOG.md) for the full history. What 1.0 promises from here on is described in [Stability](./README.md#stability).

## Router

- **`removeRoute` removes by registered pattern** ([#202](https://github.com/h3js/rou3/pull/202)). It removes the entries that one `addRoute` call created, and leaves other routes on the same tree node alone. Before, it dropped the whole node bucket, so removing `/a/:id` also removed `/a/:name`, and a pattern that reached the same node removed routes registered under another spelling. Now `removeRoute(router, "GET", "/x/*")` does not remove `/x/:id`, and `/ab` does not remove `/a{b}`: pass the pattern as it was registered.

- **Segments after `**` are matched** ([#216](https://github.com/h3js/rou3/pull/216)). `**` used to be terminal and anything after it was silently dropped: `/a/**/b` behaved as `/a/**`. Now the segments after a `**` are matched from the end of the path:
  - `/a/**/b` no longer matches `/a/x`, and on `/a/x/b` captures `_: "x"` (was `"x/b"`).
  - A `:name+` / `:name*` before the last segment is a `**:name` and keeps the segments after it, as in URLPattern: `/a/:x+/b` requires the trailing `/b`.
  - `**<rest>` is short for `**/*<rest>`: `/**.md` only matches paths whose last segment ends in `.md` (was: any path under `/`), and captures `{ _: "docs", "0": "intro" }` on `/docs/intro.md`.
  - `removeRoute(router, method, "/a/**/b")` no longer removes `/a/**`.

- **A second catch-all throws** ([#216](https://github.com/h3js/rou3/pull/216)). A route may have one catch-all (`**`, `**:name`, `:name+` or `:name*`): `/a/**/b/**`, `/a/**/b/:y+` and `/a/:x+/b/:y+` throw `rou3: a route can have only one ...` from `addRoute`, `routeToRegExp` and the overlap / node-key helpers.

- **An unclosed `(` throws a `rou3:` error** (0.10.2). A `(` must close in its own segment: `/files/(2024` and a constraint containing `/` (`/a/:id([^/]+)`) now throw `rou3: a \`(\` must close in its own segment ...` instead of a raw `SyntaxError: Invalid regular expression`. Escape a literal one as `\(`.

- **Routes with segments after `**` rank from the end** ([#216](https://github.com/h3js/rou3/pull/216)). On a path that such a route matches, `findRoute` and `findAllRoutes` rank every match from the last segment backwards (literal > regex param > plain param / `**`). With `/blog/**`, `/blog/:slug` and `/**/_payload.json`, `/blog/_payload.json` now finds `/**/_payload.json` (0.9: `/blog/:slug`). Paths no such route matches are unaffected. See [Result ordering](./README.md#result-ordering).

- **Lookup ignores at most one trailing slash** ([#209](https://github.com/h3js/rou3/issues/209), [#210](https://github.com/h3js/rou3/pull/210)). `/a/` still matches `/a`, but `/a//` no longer does. A path that ends in an empty segment after that one slash is a real segment: `/a//` matches `/a/:x` with `x: ""` (0.9: no match). This matches Express, find-my-way and Hono. See [Trailing slashes and empty segments](./README.md#trailing-slashes-and-empty-segments).

- **Types:** a trailing `*` param is typed `string | undefined` ([#198](https://github.com/h3js/rou3/pull/198)), since `/a/*` also matches `/a`.

## `routeToRegExp`

- **The regex matches exactly the paths `findRoute` matches** ([#200](https://github.com/h3js/rou3/issues/200), [#211](https://github.com/h3js/rou3/pull/211)). 0.9's output both over- and under-matched: `/api/**` matched `/apifoo`, catch-alls missed paths with line terminators, and `/a/:x` rejected `/a//`. Code that used the regex as a guard now gets the router's answer. Documented exceptions are listed under [Regular expressions](./README.md#regular-expressions).
- **The regex source changed** for most routes (look-behind-free endings, `[\s\S]` catch-alls, the separator anchored to its prefix). Regenerate stored regexes, and from 1.0 on do not persist them: the source is not covered by semver.
- **A duplicate param name throws a `rou3:` error** (`/files/:path/**:path`, `/a/:x/:x?`; a bare `**` counts as `_`) instead of a raw `SyntaxError: Invalid regular expression`.

## `regExpToRoute`

- **`**:name` comes back as `:name+`**: both compile to the same regex now, so `regExpToRoute(routeToRegExp("/base/**:path"))` is `/base/:path+` (0.9: `/base/**:path`). Likewise `/a{/**}?` comes back as `/a/:_*`.
- `regExpToRoute` is **experimental** in 1.0 and not covered by semver. Regexes produced by 0.9.x are accepted best-effort.

## Pending for 1.0

- (pending v1 PRs: find-result isolation, param-name grammar, reserved syntax, method-agnostic fallback, compiler API; each adds its entry here.)

## Coming from 0.7 or earlier

Unnamed captures (`*` segments and unnamed groups like `(\d+)`) are keyed `"0"`, `"1"`, ... like URLPattern, since 0.8.0 ([#178](https://github.com/h3js/rou3/pull/178)); they used to be `_0`, `_1`, .... See the [0.8.0 changelog](./CHANGELOG.md#v080) for the other URLPattern-compatibility changes.
