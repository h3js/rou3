// Shared fixtures for routeToRegExp tests (interpreter + cross-engine PCRE checks).

import { addRoute, createRouter } from "../src/index.ts";
import type { Node } from "../src/types.ts";

/** Captures by param name (`_N` groups as `"N"`), `undefined` when unset. */
export type Captures = Readonly<Record<string, string | undefined>>;

export interface RegExpCase {
  regex: RegExp;
  /**
   * `[path, groups, params]`. `groups` lists the regex's named groups exactly:
   * every group, `undefined` when unset (default `{}`). `params` gives the
   * `findRoute` params only where they differ from `groups` (the router
   * reports `""` for some groups the regex leaves unset).
   */
  match: ReadonlyArray<readonly [path: string, groups?: Captures, params?: Captures]>;
  /**
   * Paths neither the router nor the regex may match. Paths with a `\n` are
   * fed only to engines that take the input whole (not line by line).
   */
  noMatch?: ReadonlyArray<string>;
}

export const regexpCases: Record<string, RegExpCase> = {
  // Lookup ignores at most one trailing slash (#209). A second leaves a real
  // empty last segment, which only a param can take.
  // Root: `//` is an empty segment, not root with a trailing slash (#209).
  "/": {
    regex: /^\/$/,
    match: [["/"]],
    noMatch: ["//", "///", "/a"],
  },
  "/path": {
    regex: /^\/path\/?$/,
    match: [["/path"], ["/path/"]],
    noMatch: ["/path//", "/path///", "/pathx"],
  },
  "/path/:param": {
    regex: /^\/path\/(?:(?<param>[^/]+)\/?|\/)$/,
    match: [
      ["/path/value", { param: "value" }],
      ["/path/value/", { param: "value" }],
      ["/path/\n", { param: "\n" }],
      // An empty last segment takes the slash-only branch, which leaves
      // `param` unset where the router reports `""` (no look-behind, RE2-safe).
      ["/path//", { param: undefined }, { param: "" }],
    ],
    noMatch: ["/path", "/path/", "/path///", "/path/value//"],
  },
  // A trailing `*` is optional in the tree, so `/path` matches too (#200).
  "/path/*": {
    regex: /^\/path(?:\/(?<_0>[^/]*))??\/?$/,
    match: [
      ["/path", { "0": undefined }],
      ["/path/", { "0": undefined }],
      // The lazy `(?:…)??` skips the group on `/path/` (like the router) and
      // takes it, empty, on `/path//`.
      ["/path//", { "0": "" }],
      ["/path/x", { "0": "x" }],
      ["/path/x/", { "0": "x" }],
      ["/path/\r", { "0": "\r" }],
    ],
    noMatch: ["/pathx", "/path/x/y", "/path/x//"],
  },
  "/path/get-:file.:ext": {
    regex: /^\/path\/get-(?<file>[^/]+)\.(?<ext>[^/]+)\/?$/,
    match: [["/path/get-file.txt", { file: "file", ext: "txt" }]],
  },
  "/path/:param1/:param2": {
    regex: /^\/path\/(?<param1>[^/]*)\/(?:(?<param2>[^/]+)\/?|\/)$/,
    match: [
      ["/path/value1/value2", { param1: "value1", param2: "value2" }],
      // A whole-segment `:name` takes an empty segment in the tree (#200).
      ["/path//value2", { param1: "", param2: "value2" }],
    ],
  },
  "/path/*/foo": {
    regex: /^\/path\/(?<_0>[^/]*)\/foo\/?$/,
    match: [
      ["/path/anything/foo", { "0": "anything" }],
      ["/path//foo", { "0": "" }],
      ["/path//foo/", { "0": "" }],
    ],
  },
  // An empty *middle* segment is a real segment: the radix tree gives it a
  // static node, so `/path//sub` matches only the doubled-slash path and never
  // `/path/sub`. The regex must agree (it used to drop empty segments, emitting
  // `^\/path\/sub\/?$` — matching the one path the router won't, and missing the
  // one it will). Only *trailing* empties are canonicalized away (`/a//` = `/a`).
  "/path//sub": {
    regex: /^\/path\/\/sub\/?$/,
    match: [["/path//sub"], ["/path//sub/"]],
  },
  "/path//:id": {
    regex: /^\/path\/\/(?:(?<id>[^/]+)\/?|\/)$/,
    match: [["/path//value", { id: "value" }]],
  },
  "/path/*.png": {
    regex: /^\/path\/(?<_0>[^/]*)\.png\/?$/,
    match: [["/path/icon.png", { "0": "icon" }]],
  },
  "/path/file-*-*.png": {
    regex: /^\/path\/file-(?<_0>[^/]*)-(?<_1>[^/]*)\.png\/?$/,
    match: [["/path/file-a-b.png", { "0": "a", "1": "b" }]],
  },
  "/path/**": {
    regex: /^\/path(?:\/(?<_>(?:[\s\S]*[^/])?\/*?))?\/?$/,
    match: [
      // The whole catch-all group is skipped, so the regex leaves `_` unset
      // while the router reports `""`.
      ["/path", { _: undefined }, { _: "" }],
      // The catch-all leaves the stripped trailing slash out of the capture.
      ["/path/", { _: "" }],
      ["/path//", { _: "" }],
      ["/path/a/", { _: "a" }],
      ["/path/a//", { _: "a/" }],
      ["/path/anything/more", { _: "anything/more" }],
      // The router splits on `/` only: line terminators are ordinary chars,
      // mid-path and last alike (a JS `.` excludes all four).
      ["/path/\n", { _: "\n" }],
      ["/path/a\rb/c", { _: "a\rb/c" }],
      ["/path/a/\u2028/", { _: "a/\u2028" }],
      ["/path/\u2029x//", { _: "\u2029x/" }],
    ],
    noMatch: ["/pathfoo", "/pathfoo/bar", "/path\n/a", "/path\r/a"],
  },
  "/base/**:path": {
    regex: /^\/base\/(?:\/|(?<path>(?:[\s\S]*[^/]|\/)\/*?)\/?)$/,
    match: [
      ["/base/anything/more", { path: "anything/more" }],
      // One or more segments, and a segment may be empty. The router reports
      // `path: ""`, but the look-behind-free `**:x` / `:x+` ending takes its
      // slash-only branch here and leaves `path` unset (the accepted trade-off,
      // see `withTrailingSlash` in src/_trailing-slash.ts).
      ["/base//", { path: undefined }, { path: "" }],
      ["/base///", { path: "/" }],
      ["/base/a/", { path: "a" }],
      ["/base/a//", { path: "a/" }],
      ["/base/x\ry", { path: "x\ry" }],
      ["/base/\n/\u2028//", { path: "\n/\u2028/" }],
    ],
    noMatch: ["/base", "/base/", "/basefoo", "/basefoo/bar"],
  },
  "/static%3Apath/\\*/\\*\\*": {
    regex: /^\/static%3Apath\/\*\/\*\*\/?$/,
    match: [["/static%3Apath/*/**"]],
  },
  "/**": {
    regex: /^\/?(?<_>(?:[\s\S]*[^/])?\/*?)\/?$/,
    match: [
      ["/", { _: "" }],
      ["//", { _: "" }],
      ["/a/", { _: "a" }],
      ["/a//", { _: "a/" }],
      ["/anything", { _: "anything" }],
      ["/any/deep/path", { _: "any/deep/path" }],
      ["/\u2028\u2029", { _: "\u2028\u2029" }],
      ["/a\n/b\r/", { _: "a\n/b\r" }],
    ],
  },
  "/**:path": {
    regex: /^\/(?:\/|(?<path>(?:[\s\S]*[^/]|\/)\/*?)\/?)$/,
    match: [
      ["/anything", { path: "anything" }],
      ["/any/deep/path", { path: "any/deep/path" }],
      ["/\r\n", { path: "\r\n" }],
    ],
    noMatch: ["/"],
  },
  "/:path+": {
    regex: /^\/(?:\/|(?<path>(?:[\s\S]*[^/]|\/)\/*?)\/?)$/,
    match: [
      ["/a/b", { path: "a/b" }],
      ["/a\u2029b/", { path: "a\u2029b" }],
    ],
    noMatch: ["/"],
  },
  "/path/:id(\\d+)": {
    regex: /^\/path\/(?<id>\d+)\/?$/,
    match: [["/path/123", { id: "123" }]],
  },
  "/path/:ext(png|jpg|gif)": {
    regex: /^\/path\/(?<ext>png|jpg|gif)\/?$/,
    match: [["/path/png", { ext: "png" }]],
  },
  "/path/:version(v\\d+)/:resource": {
    regex: /^\/path\/(?<version>v\d+)\/(?:(?<resource>[^/]+)\/?|\/)$/,
    match: [["/path/v2/users", { version: "v2", resource: "users" }]],
  },
  "/path/:id?": {
    regex: /^\/path(?:\/(?<id>[^/]*))??\/?$/,
    match: [
      ["/path/123", { id: "123" }],
      ["/path/123/", { id: "123" }],
      ["/path", { id: undefined }],
      ["/path/", { id: undefined }],
      ["/path//", { id: "" }],
    ],
    noMatch: ["/path///", "/path/123//"],
  },
  "/path/:id(\\d+)?": {
    regex: /^\/path(?:\/(?<id>\d+))?\/?$/,
    match: [
      ["/path/123", { id: "123" }],
      ["/path", { id: undefined }],
    ],
  },
  "/path/:rest+": {
    regex: /^\/path\/(?:\/|(?<rest>(?:[\s\S]*[^/]|\/)\/*?)\/?)$/,
    match: [
      ["/path/a/b", { rest: "a/b" }],
      ["/path/a", { rest: "a" }],
      ["/path/\n\r", { rest: "\n\r" }],
    ],
  },
  "/path/:rest*": {
    regex: /^\/path(?:\/(?<rest>(?:[\s\S]*[^/])?\/*?))??\/?$/,
    match: [
      ["/path/a/b", { rest: "a/b" }],
      ["/path/a/b/", { rest: "a/b" }],
      ["/path/a//", { rest: "a/" }],
      ["/path", { rest: undefined }],
      ["/path/", { rest: undefined }],
      ["/path/a\n/b\r/", { rest: "a\n/b\r" }],
    ],
  },
  "/path/(\\d+)": {
    regex: /^\/path\/(?<_0>\d+)\/?$/,
    match: [["/path/123", { "0": "123" }]],
  },
  // A trailing unnamed `(.*)` constraint must reverse to `(.*)`, not `:_0+`.
  // Its `.` keeps its JS meaning (the router runs constraints in JS: no line
  // terminators), so unlike a catch-all it is matched lazily to leave the
  // stripped trailing slash out of the capture.
  "/path/(.*)": {
    regex: /^\/path\/(?:\/|(?<_0>.+?)\/?)$/,
    match: [
      ["/path/a", { "0": "a" }],
      ["/path/a/", { "0": "a" }],
      ["/path//", { "0": undefined }, { "0": "" }],
    ],
    noMatch: ["/path", "/path/", "/path/a\nb"],
  },
  "/path/:x(.*)": {
    regex: /^\/path\/(?:\/|(?<x>.+?)\/?)$/,
    match: [
      ["/path/a.b", { x: "a.b" }],
      ["/path/a.b/", { x: "a.b" }],
    ],
    noMatch: ["/path", "/path/", "/path/a\nb"],
  },
  "/path/:x(.*)?": {
    regex: /^\/path(?:\/(?<x>.*?))??\/?$/,
    match: [
      ["/path", { x: undefined }],
      ["/path/", { x: undefined }],
      ["/path//", { x: "" }],
      ["/path/a", { x: "a" }],
      ["/path/a/", { x: "a" }],
    ],
    noMatch: ["/path/a\nb"],
  },
  // An empty segment turns trailing, and is dropped, once the optionals after
  // it are absent: `/docs/{v2}?/:page?` also registers `/docs`.
  "/docs/{v2}?/:page?": {
    regex:
      /^(?:\/docs\/v2(?:\/(?<page>[^/]*))??\/?|(?:\/docs\/\/(?:(?<page>[^/]+)\/?|\/)|\/docs\/?))$/,
    match: [
      ["/docs", { page: undefined }],
      ["/docs/", { page: undefined }],
      ["/docs/v2", { page: undefined }],
      ["/docs/v2/intro", { page: "intro" }],
    ],
    noMatch: ["/docs/intro"],
  },
  "/path/(png|jpg|gif)": {
    regex: /^\/path\/(?<_0>png|jpg|gif)\/?$/,
    match: [["/path/png", { "0": "png" }]],
  },
  "/path/:id(\\d+)+": {
    regex: /^\/path\/(?<id>\d+(?:\/\d+)*)\/?$/,
    match: [
      ["/path/123", { id: "123" }],
      ["/path/123/456", { id: "123/456" }],
    ],
  },
  "/path/:id(\\d+)*": {
    regex: /^\/path(?:\/(?<id>\d+(?:\/\d+)*))?\/?$/,
    match: [
      ["/path/123", { id: "123" }],
      ["/path", { id: undefined }],
    ],
  },
  "/book{s}?": {
    regex: /^\/book(?:s)?\/?$/,
    match: [["/book"], ["/books"]],
  },
  // Constraint bodies are opaque regex: dots inside them (escaped `\.` or a
  // char class) must be preserved verbatim, not blanket-escaped to `\\.`.
  "/blog/:slug(\\d+\\.\\d+)": {
    regex: /^\/blog\/(?<slug>\d+\.\d+)\/?$/,
    match: [["/blog/1.2", { slug: "1.2" }]],
  },
  "/img/:name([a-z.]+)": {
    regex: /^\/img\/(?<name>[a-z.]+)\/?$/,
    match: [["/img/a.b.c", { name: "a.b.c" }]],
  },
  "/blog/:id(\\d+){-:title}?": {
    regex: /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+))?\/?$/,
    match: [
      ["/blog/123", { id: "123", title: undefined }],
      ["/blog/123-my-post", { id: "123", title: "my-post" }],
    ],
  },
  "/foo{/bar}?": {
    regex: /^\/foo(?:\/bar)?\/?$/,
    match: [["/foo"], ["/foo/bar"]],
  },
  // Param names accept `[\w-]+`, but a capture group name must be an identifier
  // (no `-`, no leading digit) in JS and PCRE alike. Such names are emitted in a
  // reserved, injective escaped form (`_` -> `__`, `-` -> `_h`) and decoded back
  // to the original param name when groups are read.
  "/api/:test-id": {
    regex: /^\/api\/(?:(?<__rou3_esc_test_hid>[^/]+)\/?|\/)$/,
    match: [["/api/abc", { "test-id": "abc" }]],
  },
  "/api/:test-id?": {
    regex: /^\/api(?:\/(?<__rou3_esc_test_hid>[^/]*))??\/?$/,
    match: [
      ["/api/abc", { "test-id": "abc" }],
      ["/api", { "test-id": undefined }],
    ],
  },
  "/api/**:test-id": {
    regex: /^\/api\/(?:\/|(?<__rou3_esc_test_hid>(?:[\s\S]*[^/]|\/)\/*?)\/?)$/,
    match: [["/api/a/b", { "test-id": "a/b" }]],
    noMatch: ["/api", "/api/", "/apifoo"],
  },
  "/files/:file-name.json": {
    regex: /^\/files\/(?<__rou3_esc_file_hname>[^/]+)\.json\/?$/,
    match: [["/files/readme.json", { "file-name": "readme" }]],
  },
  // `a-b` and `a_b` must not collapse onto one group name.
  "/mix/:a-b.:a_b": {
    regex: /^\/mix\/(?<__rou3_esc_a_hb>[^/]+)\.(?<a_b>[^/]+)\/?$/,
    match: [["/mix/x.y", { "a-b": "x", a_b: "y" }]],
  },
  // Runs of `-`/`_` must survive: the escape is a prefix code, so `a--b` and
  // `a_-b` stay distinct. A `-` -> `_` sanitize maps `a--b` onto `a_b` (wrong
  // name) and collides `a-_b` with `a_-b` (duplicate group name -> SyntaxError).
  "/run/:a--b.:a_-b": {
    regex: /^\/run\/(?<__rou3_esc_a_h_hb>[^/]+)\.(?<__rou3_esc_a___hb>[^/]+)\/?$/,
    match: [["/run/x.y", { "a--b": "x", "a_-b": "y" }]],
  },
  // Leading digit: also not a valid group name.
  "/api/:0": {
    regex: /^\/api\/(?:(?<__rou3_esc_0>[^/]+)\/?|\/)$/,
    match: [["/api/abc", { "0": "abc" }]],
  },
  // Mid-segment optional after a greedy open-ended capture (`*` -> `[^/]*`).
  // Inlining as `(?<_0>[^/]*)(?:\.webp)?` would let the greedy capture swallow
  // `.webp` (capturing `photo.webp` instead of `photo`), so this must fall back
  // to alternation — which anchors the literal outside the capture and keeps
  // `_0` = `photo`. The fallback reuses the `_0` named group across branches
  // (see PCRE2_DUPLICATE_NAME_ROUTES).
  "/media/*{.webp}?": {
    regex: /^(?:\/media\/(?<_0>[^/]*)\.webp\/?|\/media(?:\/(?<_0>[^/]*))??\/?)$/,
    match: [
      ["/media/photo.webp", { "0": "photo" }],
      ["/media/photo", { "0": "photo" }],
    ],
  },
  // A required param that can be empty, followed by an optional one: `/path/`
  // must not match, but `/path//` (`id: ""`) and `/path//tab` must. The
  // required param splits into a non-empty branch, which may end the path
  // (`$`) or go on after a slash, and a slash-only branch, and the optional
  // part follows both. `id` is unset where it is empty (the router reports
  // `""`), wherever that segment sits: the accepted trade-off of the
  // look-behind-free required ending (see `withTrailingSlash`).
  "/path/:id/:tab?": {
    regex: /^\/path\/(?:(?<id>[^/]+)(?:\/|$)|\/)(?:(?<tab>[^/]*)\/?)??$/,
    match: [
      ["/path/1", { id: "1", tab: undefined }],
      ["/path/1/", { id: "1", tab: undefined }],
      ["/path/1/t", { id: "1", tab: "t" }],
      ["/path/1/t/", { id: "1", tab: "t" }],
      ["/path/1//", { id: "1", tab: "" }],
      ["/path//", { id: undefined, tab: undefined }, { id: "" }],
      ["/path//t", { id: undefined, tab: "t" }, { id: "", tab: "t" }],
      ["/path///", { id: undefined, tab: "" }, { id: "", tab: "" }],
    ],
    noMatch: ["/path", "/path/", "/path/1/t//", "/path/1/t/x"],
  },
  // Several required segments: only the last one decides the ending.
  "/users/:org/:id/:tab?": {
    regex: /^\/users\/(?<org>[^/]*)\/(?:(?<id>[^/]+)(?:\/|$)|\/)(?:(?<tab>[^/]*)\/?)??$/,
    match: [
      ["/users/o/1", { org: "o", id: "1", tab: undefined }],
      ["/users//1/t/", { org: "", id: "1", tab: "t" }],
      ["/users/o//", { org: "o", id: undefined, tab: undefined }, { org: "o", id: "" }],
    ],
    noMatch: ["/users/o", "/users/o/", "/users/o/1/t//"],
  },
  "/users/:id/*": {
    regex: /^\/users\/(?:(?<id>[^/]+)(?:\/|$)|\/)(?:(?<_0>[^/]*)\/?)??$/,
    match: [
      ["/users/1", { id: "1", "0": undefined }],
      ["/users/1/", { id: "1", "0": undefined }],
      ["/users/1//", { id: "1", "0": "" }],
      ["/users/1/x", { id: "1", "0": "x" }],
      ["/users/1/x/", { id: "1", "0": "x" }],
      ["/users//", { id: undefined, "0": undefined }, { id: "" }],
      ["/users//x", { id: undefined, "0": "x" }, { id: "", "0": "x" }],
    ],
    noMatch: ["/users", "/users/", "/users/1/x/y", "/users/1/x//"],
  },
  // A `**` after a required segment. On zero segments its group matches
  // nothing, and JS leaves an optional group that matched nothing unset (the
  // router reports `""`), like the `**` of `/path/**` on `/path`.
  "/users/:id/**": {
    regex: /^\/users\/(?:(?<id>[^/]+)(?:\/|$)|\/)(?:(?<_>(?:[\s\S]*[^/])?\/*?)\/?)?$/,
    match: [
      ["/users/1", { id: "1", _: undefined }, { id: "1", _: "" }],
      ["/users/1/", { id: "1", _: undefined }, { id: "1", _: "" }],
      ["/users/1//", { id: "1", _: "" }],
      ["/users/1/a/b", { id: "1", _: "a/b" }],
      ["/users/1/a/b/", { id: "1", _: "a/b" }],
      ["/users/1/a//", { id: "1", _: "a/" }],
      ["/users//", { id: undefined, _: undefined }, { id: "", _: "" }],
      ["/users///", { id: undefined, _: "" }, { id: "", _: "" }],
    ],
    noMatch: ["/users", "/users/", "/usersx/1"],
  },
  "/docs/:lang/:page*": {
    regex: /^\/docs\/(?:(?<lang>[^/]+)(?:\/|$)|\/)(?:(?<page>(?:[\s\S]*[^/])?\/*?)\/?)??$/,
    match: [
      ["/docs/en", { lang: "en", page: undefined }],
      ["/docs/en/", { lang: "en", page: undefined }],
      ["/docs/en//", { lang: "en", page: "" }],
      ["/docs/en/a/b", { lang: "en", page: "a/b" }],
      ["/docs/en/a/b/", { lang: "en", page: "a/b" }],
      ["/docs/en/a//", { lang: "en", page: "a/" }],
      ["/docs//", { lang: undefined, page: undefined }, { lang: "" }],
      ["/docs//a", { lang: undefined, page: "a" }, { lang: "", page: "a" }],
    ],
    noMatch: ["/docs", "/docs/"],
  },
  // Optional segments in a row nest: the router only takes `day` along with
  // `month` (`/posts/:year/:day` is shadowed by `/posts/:year/:month`).
  "/posts/:year/:month?/:day?": {
    regex: /^\/posts\/(?:(?<year>[^/]+)(?:\/|$)|\/)(?:(?<month>[^/]*)(?:\/(?<day>[^/]*))??\/?)??$/,
    match: [
      ["/posts/2024", { year: "2024", month: undefined, day: undefined }],
      ["/posts/2024/", { year: "2024", month: undefined, day: undefined }],
      ["/posts/2024/01", { year: "2024", month: "01", day: undefined }],
      ["/posts/2024/01/", { year: "2024", month: "01", day: undefined }],
      ["/posts/2024/01/02/", { year: "2024", month: "01", day: "02" }],
      ["/posts/2024//", { year: "2024", month: "", day: undefined }],
      ["/posts/2024/01//", { year: "2024", month: "01", day: "" }],
      ["/posts/2024///", { year: "2024", month: "", day: "" }],
      ["/posts//01", { year: undefined, month: "01", day: undefined }, { year: "", month: "01" }],
    ],
    noMatch: ["/posts", "/posts/", "/posts/2024/01/02//", "/posts/2024/01/02/x"],
  },
  "/a/:x?/:y?": {
    regex: /^\/a(?:\/(?<x>[^/]*)(?:\/(?<y>[^/]*))??)??\/?$/,
    match: [
      ["/a", { x: undefined, y: undefined }],
      ["/a/", { x: undefined, y: undefined }],
      ["/a//", { x: "", y: undefined }],
      ["/a/b", { x: "b", y: undefined }],
      ["/a/b/", { x: "b", y: undefined }],
      ["/a/b/c", { x: "b", y: "c" }],
      ["/a/b//", { x: "b", y: "" }],
      ["/a///", { x: "", y: "" }],
    ],
    noMatch: ["/ab", "/a/b/c//", "/a/b/c/d"],
  },
  // An empty segment is required too, and has no non-empty branch.
  "/a//*": {
    regex: /^\/a\/\/(?:(?<_0>[^/]*)\/?)??$/,
    match: [
      ["/a//", { "0": undefined }],
      ["/a///", { "0": "" }],
      ["/a//x", { "0": "x" }],
      ["/a//x/", { "0": "x" }],
    ],
    noMatch: ["/a", "/a/", "/a/x", "/a//x//", "/a//x/y"],
  },
  // An optional group spanning segments whose last one can be empty:
  // `/path/sub/` must not match (it strips to `/path/sub`, which is neither
  // branch). The group ends in the required ending, and `id` is unset where it
  // is empty (the router reports `""`), like a top-level `/path/sub/:id`.
  "/path{/sub/:id}?": {
    regex: /^\/path(?:\/(?:sub\/(?:(?<id>[^/]+)\/?|\/))?)?$/,
    match: [
      ["/path", { id: undefined }],
      ["/path/", { id: undefined }],
      ["/path/sub/1", { id: "1" }],
      ["/path/sub/1/", { id: "1" }],
      ["/path/sub//", { id: undefined }, { id: "" }],
    ],
    noMatch: ["/path/sub", "/path/sub/", "/path//", "/path/sub/1//"],
  },
  // A group whose required segment is followed by an optional one.
  "/path{/sub/:id/*}?": {
    regex: /^\/path(?:\/(?:sub\/(?:(?<id>[^/]+)(?:\/|$)|\/)(?:(?<_0>[^/]*)\/?)??)?)?$/,
    match: [
      ["/path", { id: undefined, "0": undefined }],
      ["/path/", { id: undefined, "0": undefined }],
      ["/path/sub/1", { id: "1", "0": undefined }],
      ["/path/sub/1/", { id: "1", "0": undefined }],
      ["/path/sub/1//", { id: "1", "0": "" }],
      ["/path/sub/1/x/", { id: "1", "0": "x" }],
      ["/path/sub//", { id: undefined, "0": undefined }, { id: "" }],
      ["/path/sub//x", { id: undefined, "0": "x" }, { id: "", "0": "x" }],
    ],
    noMatch: ["/path/sub", "/path/sub/", "/path//", "/path/sub/1/x//"],
  },
  // A constraint that can match empty has no non-empty form to branch on.
  "/path/:id(\\d*)": {
    regex: /^\/path\/(?<id>\d*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path/12", { id: "12" }],
      ["/path/12/", { id: "12" }],
      ["/path//", { id: "" }],
    ],
    noMatch: ["/path", "/path/", "/path/a", "/path/12//"],
  },
  // A constraint that can match `/` must not take the trailing slash lookup
  // strips: behind a bare `/?$`, `[^.]+` matched `/files//` (`name: "/"`) and
  // captured `report/` on `/files/report/` (see LOOKBEHIND_ROUTES). Mid-path,
  // such a constraint still spans segments (`/files/a/b`); not modeled.
  "/files/:name([^.]+)": {
    regex: /^\/files\/(?<name>[^.]+)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/files/report", { name: "report" }],
      ["/files/report/", { name: "report" }],
    ],
    noMatch: ["/files", "/files/", "/files//"],
  },
  "/path/:x(\\S+)?": {
    regex: /^\/path(?:\/(?<x>\S+))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path", { x: undefined }],
      ["/path/", { x: undefined }],
      ["/path/a", { x: "a" }],
      ["/path/a/", { x: "a" }],
    ],
    noMatch: ["/path//"],
  },
  // Only the end of the match matters: this one can contain `/` but never end
  // in one, so it keeps the plain ending.
  "/path/:file(.+\\.zip)": {
    regex: /^\/path\/(?<file>.+\.zip)\/?$/,
    match: [
      ["/path/a.zip", { file: "a.zip" }],
      ["/path/a.zip/", { file: "a.zip" }],
    ],
    noMatch: ["/path/", "/path//", "/path/a.zip//"],
  },
  // A root `:x*` (unlike `/**`) leaves `x` unset on `/`: the router takes the
  // route without it there.
  "/:path*": {
    regex: /^(?:\/?(?<path>(?:[\s\S]*[^/])?\/*?))??\/?$/,
    match: [
      ["/", { path: undefined }],
      ["//", { path: "" }],
      ["/a", { path: "a" }],
      ["/a/b/", { path: "a/b" }],
      ["/a/b//", { path: "a/b/" }],
      ["/\n", { path: "\n" }],
      ["/a\u2028b/", { path: "a\u2028b" }],
    ],
  },
  // Trailing optionals nested in an inline group get the same endings as
  // top-level ones: a catch-all never keeps the stripped trailing slash, an
  // inner `*` / `:x?` / `:x*` stays unset where the router takes the route
  // without it, and no look-behind is needed.
  "/path{/sub/**}?": {
    regex: /^\/path(?:\/sub(?:\/(?<_>(?:[\s\S]*[^/])?\/*?))?)?\/?$/,
    match: [
      ["/path", { _: undefined }],
      ["/path/", { _: undefined }],
      ["/path/sub/", { _: "" }],
      ["/path/sub//", { _: "" }],
      ["/path/sub/a", { _: "a" }],
      ["/path/sub/a/", { _: "a" }],
      ["/path/sub/a//", { _: "a/" }],
      ["/path/sub/a/b", { _: "a/b" }],
      ["/path/sub/\ra\n/", { _: "\ra\n" }],
    ],
    noMatch: ["/path//", "/path/subx", "/path/other"],
  },
  "/path{/sub/:rest*}?": {
    regex: /^\/path(?:\/sub(?:\/(?<rest>(?:[\s\S]*[^/])?\/*?))??)?\/?$/,
    match: [
      ["/path", { rest: undefined }],
      ["/path/sub", { rest: undefined }],
      ["/path/sub/", { rest: undefined }],
      ["/path/sub//", { rest: "" }],
      ["/path/sub/a/", { rest: "a" }],
      ["/path/sub/a/b//", { rest: "a/b/" }],
      ["/path/sub/\u2028x/y", { rest: "\u2028x/y" }],
    ],
    noMatch: ["/path//", "/path/subx"],
  },
  "/path{/sub/*}?": {
    regex: /^\/path(?:\/sub(?:\/(?<_0>[^/]*))??)?\/?$/,
    match: [
      ["/path", { "0": undefined }],
      ["/path/sub", { "0": undefined }],
      ["/path/sub/", { "0": undefined }],
      ["/path/sub//", { "0": "" }],
      ["/path/sub/a", { "0": "a" }],
      ["/path/sub/a/", { "0": "a" }],
    ],
    noMatch: ["/path//", "/path/sub/a//", "/path/sub/a/b"],
  },
  "/path{/sub/:id?}?": {
    regex: /^\/path(?:\/sub(?:\/(?<id>[^/]*))??)?\/?$/,
    match: [
      ["/path", { id: undefined }],
      ["/path/sub/", { id: undefined }],
      ["/path/sub//", { id: "" }],
      ["/path/sub/1/", { id: "1" }],
    ],
    noMatch: ["/path//", "/path/sub/1//"],
  },
  // An inline group holding a single optional segment adds nothing: it is the
  // same route as `/path/:rest*`.
  "/path{/:rest*}?": {
    regex: /^\/path(?:\/(?<rest>(?:[\s\S]*[^/])?\/*?))??\/?$/,
    match: [
      ["/path", { rest: undefined }],
      ["/path/", { rest: undefined }],
      ["/path//", { rest: "" }],
      ["/path/a/", { rest: "a" }],
      ["/path/a//", { rest: "a/" }],
    ],
    noMatch: ["/pathx"],
  },
};

// Fixtures whose regex still ends in the look-behind trailing-slash suffix
// `(?:(?<=\/)\/|(?<!\/)\/?)`, which RE2-family engines (Go, Rust `regex`,
// RE2) reject. Every other fixture gets a look-behind-free ending (see
// src/_trailing-slash.ts); the sweep corpus has more look-behind routes,
// pinned in SWEEP_LOOKBEHIND_PATTERNS. The suffix remains for a required
// last segment whose constraint can match empty (its non-empty part isn't
// derived), for optional siblings where an earlier one can be empty and a
// later one can't nest in it, for optional siblings after a required segment
// that can be empty (not implemented), and where a match can end in `/` (a
// constraint like `[^.]+`), so that the stripped trailing slash never lands
// in the capture.
export const LOOKBEHIND_ROUTES: ReadonlySet<string> = new Set([
  "/path/:id(\\d*)",
  "/files/:name([^.]+)",
  "/path/:x(\\S+)?",
]);

// Routes whose generated regex reuses the same named capture group across
// alternation branches (e.g. `(?<id>…)|(?<id>…)`). Such output is legal in JS
// (per the TC39 duplicate-named-groups proposal) and in Perl, but PCRE2-family
// engines reject it unless PCRE2_DUPNAMES is set.
//
// A trailing single optional group is normally compiled inline as `(?:...)?`
// (see inlineOptionalGroup in src/regexp.ts), which avoids duplicate names. But
// a mid-segment optional after a greedy open-ended capture cannot be inlined
// safely (the capture would swallow the optional literal), so it falls back to
// alternation and reuses the capture name across branches. These routes exercise
// that fallback and are asserted to be rejected by strict PCRE2 engines.
export const PCRE2_DUPLICATE_NAME_ROUTES: ReadonlySet<string> = new Set([
  "/media/*{.webp}?",
  "/docs/{v2}?/:page?",
]);

// Sweep patterns (see `sweepPatterns()`) whose regex keeps the look-behind
// suffix. RE2-family engines reject them, so the RE2 sweep skips exactly these
// (test/regexp.pcre.test.ts); pinned in test/regexp.test.ts so a change that
// moves more routes onto the suffix fails instead of silently shrinking it.
export const SWEEP_LOOKBEHIND_PATTERNS: ReadonlySet<string> = new Set([
  // A constraint that can match empty, as a required last segment.
  "/path/:id(\\d*)",
  "/a/:x(\\d*)/:y?",
  // Optional siblings where an earlier one can be empty and a later one can't
  // nest in it.
  "/a/:x(\\d*)?/:y?",
  "/a/:x?{/b/c}?",
  // Optional siblings after a required segment that can be empty.
  "/a/:x/:y(\\d+)?/:z?",
  // A constraint whose match can end in `/`.
  "/files/:name([^.]+)",
  "/path/:x(\\S+)?",
]);

// Sweep patterns whose regex reuses a capture group name across alternation
// branches (see PCRE2_DUPLICATE_NAME_ROUTES). Pinned like the set above.
export const SWEEP_DUPLICATE_NAME_PATTERNS: ReadonlySet<string> = new Set([
  // A mid-route optional group expands into one full route per branch.
  "/{b}?/*",
  "/{b}?/**",
  "/{b}?/*.png",
  "/{b}?/:y",
  "/{b}?/:y?",
  "/{b}?/x-:y",
  "/a/{b}?/*",
  "/a/{b}?/**",
  "/a/{b}?/*.png",
  "/a/{b}?/:y",
  "/a/{b}?/:y?",
  "/a/{b}?/x-:y",
  "/{en}?/:page?",
  "/docs/{v2}?/:page?",
  // A mid-segment optional after a greedy capture.
  "/media/*{.webp}?",
]);

/** Whether a regex source uses a look-behind (RE2-family engines have none). */
export function hasLookbehind(source: string): boolean {
  return /\(\?<[=!]/.test(source);
}

/** Capture group names used more than once in a regex source. */
export function duplicateGroupNames(source: string): string[] {
  const names = [...source.matchAll(/\(\?<(\w+)>/g)].map((m) => m[1]);
  return names.filter((name, i) => names.indexOf(name) !== i);
}

/**
 * Pattern corpus for the router-vs-regex sweeps: every combination of the
 * segment forms below (depth <= 2, with and without a static prefix), plus the
 * fixtures above, minus the routes with segments after `**` (see
 * `SUFFIX_ROUTES`).
 */
export function sweepPatterns(): string[] {
  return allSweepPatterns().filter((pattern) => !hasSegmentsAfterWildcard(pattern));
}

function allSweepPatterns(): string[] {
  // `""` is an empty middle segment and `{b}?` an optional one; both can turn
  // into a trailing empty segment the tree drops (`/docs/{v2}?/:page?`).
  const units = [
    "a",
    "",
    "{b}?",
    ":x",
    "*",
    "**",
    "**:r",
    ":x?",
    ":x+",
    ":x*",
    ":x(\\d+)",
    ":x(\\d+)?",
  ];
  const tails = ["", "a", ":y", "*", ":y?", "**", "*.png", "x-:y", "b{.json}?"];
  const patterns = new Set([
    "/",
    "/a{/b}?",
    "/a/b{s}?",
    "/a/:x+/b{/c}?",
    "/{en}?/:page?",
    // An optional group spanning segments ends in an empty-capable one.
    "/a{/b/:x}?",
    // Required segments that can be empty, then optionals, nested ones too.
    "/a/:x/:y/:z?",
    "/a/:x/:y?/:z?",
    "/a/:x/*/:z?",
    "/a/*/:y?/:z?",
    "/a/:x?/:y?/:z?",
    "/:x/:y?/**",
    "/a{/b/:x/:y?}?",
    "/a{/:x/:y?}?",
    "/a/:x{/b/:y}?",
    // Optional siblings: nestable (`:y` matches no segment `:x` doesn't), or
    // not and the earlier one can't be empty.
    "/a/:x?/:y(\\d+)?",
    "/a/:x(\\d+)?/:y?",
    "/a/:x(\\d+)?/:y?/:z?",
    // Look-behind fallbacks (SWEEP_LOOKBEHIND_PATTERNS).
    "/a/:x(\\d*)?/:y?",
    "/a/:x?{/b/c}?",
    "/a/:x/:y(\\d+)?/:z?",
    "/a/:x(\\d*)/:y?",
    ...Object.keys(regexpCases),
  ]);
  // Optional segments nested in an inline group (`/a{/b/*}?`), including an
  // empty-capable group head (`{/:x/*}?`) and optional siblings (`{/b/*/:y?}?`).
  for (const t of ["*", ":y?", ":y*", ":y+", "**", "**:r", ":y", "*/:y?", ":x/*", ":x/**"]) {
    patterns.add(`/a{/b/${t}}?`).add(`/a{/${t}}?`);
  }
  for (const u of units) {
    for (const t of tails) {
      patterns.add(t ? `/${u}/${t}` : `/${u}`);
      patterns.add(t ? `/a/${u}/${t}` : `/a/${u}`);
    }
  }
  // Known router limitation, not a regex bug: the tree drops the constraint of
  // a repeated param (`:id(\d+)+` is stored as `**:id`).
  return [...patterns].filter((pattern) => !/\)[+*]$/.test(pattern));
}

/**
 * Routes with segments after `**` (a `:x+` / `:x*` before the last segment
 * becomes one): the router matches those segments from the end of the path,
 * which `routeToRegExp` does not support yet, so it throws. The sweeps leave
 * them out (`suffixSweepPatterns()` lists the ones they drop).
 */
export const SUFFIX_ROUTES: readonly string[] = [
  "/**/_payload.json",
  "/path/**/suffix",
  "/base/**:path/suffix",
  "/a/**/b{.json}?",
  "/path/:rest+/suffix",
  "/path/:rest*/suffix",
  "/path/:rest+/meta{.json}?",
  "/**/*.png",
  "/:id/**/:file(\\w+).json",
  "/**.md",
  "/blog/**.json",
];

/** Whether the router stores segments after a `**` for `pattern` (or rejects a second `**`). */
export function hasSegmentsAfterWildcard(pattern: string): boolean {
  const router = createRouter();
  try {
    addRoute(router, "", pattern);
  } catch (error) {
    if (/only one `\*\*`/.test((error as Error).message)) return true;
    throw error;
  }
  const hasSuffix = (node: Node | undefined): boolean =>
    !!node &&
    (!!node.suffix ||
      Object.values(node.static || {}).some(hasSuffix) ||
      hasSuffix(node.param) ||
      hasSuffix(node.wildcard));
  return hasSuffix(router.root);
}

/** The sweep corpus patterns `sweepPatterns()` drops for `hasSegmentsAfterWildcard`. */
export function suffixSweepPatterns(): string[] {
  return allSweepPatterns().filter((pattern) => hasSegmentsAfterWildcard(pattern));
}

/** Every short path, including empty segments and runs of trailing slashes. */
export function sweepPaths(): string[] {
  const paths = new Set(["/", "//", "///"]);
  const walk = (prefix: string, depth: number) => {
    for (const seg of ["a", "b", "1", "x.png", ""]) {
      const path = `${prefix}/${seg}`;
      paths.add(path).add(`${path}/`).add(`${path}//`).add(`${path}///`);
      if (depth > 1) walk(path, depth - 1);
    }
  };
  walk("", 3);
  // The router splits on `/` only, so line terminators are ordinary chars:
  // alone, at either end of a segment, mid-path and last.
  for (const lt of ["\n", "\r", "\u2028", "\u2029"]) {
    for (const path of [`/${lt}`, `/a/${lt}`, `/a/${lt}b`, `/a${lt}/b`, `/a/b/x${lt}`]) {
      paths.add(path).add(`${path}/`).add(`${path}//`);
    }
  }
  return [...paths];
}
