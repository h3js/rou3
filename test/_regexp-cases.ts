// Shared fixtures for routeToRegExp tests (interpreter + cross-engine PCRE checks).

import { addRoute, createRouter, routeToRegExp } from "../src/index.ts";

/**
 * Whether this engine compiles a named group repeated across alternatives
 * (V8 12.5+ / Node 23+). Node 22 does not: the alternation-fallback routes
 * (PCRE2_DUPLICATE_NAME_ROUTES, SWEEP_DUPLICATE_NAME_PATTERNS) throw there, so
 * their fixtures and sweep entries are left out.
 */
export const DUPLICATE_NAMED_GROUPS: boolean = (() => {
  try {
    new RegExp("(?<a>x)|(?<a>y)");
    return true;
  } catch {
    return false;
  }
})();

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
  // empty last segment, which only a `*`, `**`, `:x*` or a constraint that can
  // match empty takes (a `:x` / `:x+` needs a value, #229).
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
    regex: /^\/path\/(?<param>[^/]+)\/?$/,
    match: [
      ["/path/value", { param: "value" }],
      ["/path/value/", { param: "value" }],
      ["/path/\n", { param: "\n" }],
    ],
    // `:param` needs a value (#229): an empty last segment is no match.
    noMatch: ["/path", "/path/", "/path//", "/path///", "/path/value//"],
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
    regex: /^\/path\/get-(?<file>[^/]+?)\.(?<ext>[^/]+?)\/?$/,
    match: [["/path/get-file.txt", { file: "file", ext: "txt" }]],
  },
  "/path/:param1/:param2": {
    regex: /^\/path\/(?<param1>[^/]+)\/(?<param2>[^/]+)\/?$/,
    match: [["/path/value1/value2", { param1: "value1", param2: "value2" }]],
    // A whole-segment `:name` needs a value, mid-path too (#229).
    noMatch: ["/path//value2", "/path/value1//"],
  },
  "/path/*/foo": {
    regex: /^\/path\/(?<_0>[^/]*)\/foo\/?$/,
    match: [
      ["/path/anything/foo", { "0": "anything" }],
      ["/path//foo", { "0": "" }],
      ["/path//foo/", { "0": "" }],
    ],
  },
  // An empty *middle* segment is a real segment: the tree gives it a
  // static node, so `/path//sub` matches only the doubled-slash path and never
  // `/path/sub`. The regex must agree (it used to drop empty segments, emitting
  // `^\/path\/sub\/?$` — matching the one path the router won't, and missing the
  // one it will). Only *trailing* empties are canonicalized away (`/a//` = `/a`).
  "/path//sub": {
    regex: /^\/path\/\/sub\/?$/,
    match: [["/path//sub"], ["/path//sub/"]],
  },
  "/path//:id": {
    regex: /^\/path\/\/(?<id>[^/]+)\/?$/,
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
    regex: /^\/base\/(?:\/\/|(?<path>(?:[\s\S]*[^/]|\/\/)\/*?)\/?)$/,
    match: [
      ["/base/anything/more", { path: "anything/more" }],
      // One or more segments with a value (#229), and a segment may be empty.
      // The router reports `path: "/"` on two empty segments, but the
      // look-behind-free `**:x` / `:x+` ending takes its slash-only branch
      // here and leaves `path` unset (the accepted trade-off, see
      // `closedEnding` in src/_trailing-slash.ts).
      ["/base///", { path: undefined }, { path: "/" }],
      ["/base////", { path: "//" }],
      ["/base//a", { path: "/a" }],
      ["/base/a/", { path: "a" }],
      ["/base/a//", { path: "a/" }],
      ["/base/x\ry", { path: "x\ry" }],
      ["/base/\n/\u2028//", { path: "\n/\u2028/" }],
    ],
    noMatch: ["/base", "/base/", "/base//", "/basefoo", "/basefoo/bar"],
  },
  "/static%3Apath/\\*/\\*\\*": {
    regex: /^\/static%3Apath\/\*\/\*\*\/?$/,
    match: [["/static%3Apath/*/**"]],
  },
  // Any `\x` outside a constraint is a literal `x`, in the tree too (#227): the
  // tree kept the backslash of escapes other than `\:` `\(` `\)` `\{` `\}`.
  "/foo\\.bar": {
    regex: /^\/foo\.bar\/?$/,
    match: [["/foo.bar"]],
    noMatch: ["/foo\\.bar", "/fooxbar"],
  },
  "/foo\\bar": {
    regex: /^\/foobar\/?$/,
    match: [["/foobar"]],
    noMatch: ["/foo\\bar"],
  },
  "/a\\\\b/c\\*d/\\?": {
    regex: /^\/a\\b\/c\*d\/\?\/?$/,
    match: [["/a\\b/c*d/?"]],
    noMatch: ["/a\\\\b/c*d/?", "/ab/c*d/?", "/a\\b/c\\*d/\\?"],
  },
  // ... also in a dynamic segment, where escaped `:` / `(` / `\` stayed
  // placeholders (`x\\:y` read `\:` instead of a `\` and a `:y`).
  "/a/x\\\\:y": {
    regex: /^\/a\/x\\(?<y>[^/]+?)\/?$/,
    match: [["/a/x\\1", { y: "1" }]],
    noMatch: ["/a/x:1", "/a/x1"],
  },
  "/a/\\(:x\\)-\\:y": {
    regex: /^\/a\/\((?<x>[^/]+?)\)-:y\/?$/,
    match: [["/a/(1)-:y", { x: "1" }]],
    noMatch: ["/a/1-:y", "/a/(1)-y"],
  },
  "/a/:x\\.json/\\*-:y": {
    regex: /^\/a\/(?<x>[^/]+?)\.json\/\*-(?<y>[^/]+?)\/?$/,
    match: [["/a/1.json/*-2", { x: "1", y: "2" }]],
    noMatch: ["/a/1xjson/*-2", "/a/1.json/x-2"],
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
    regex: /^\/(?:\/\/|(?<path>(?:[\s\S]*[^/]|\/\/)\/*?)\/?)$/,
    match: [
      ["/anything", { path: "anything" }],
      ["/any/deep/path", { path: "any/deep/path" }],
      ["/\r\n", { path: "\r\n" }],
      ["////", { path: "//" }],
    ],
    noMatch: ["/", "//"],
  },
  "/:path+": {
    regex: /^\/(?:\/\/|(?<path>(?:[\s\S]*[^/]|\/\/)\/*?)\/?)$/,
    match: [
      ["/a/b", { path: "a/b" }],
      ["/a\u2029b/", { path: "a\u2029b" }],
      ["///", { path: undefined }, { path: "/" }],
    ],
    noMatch: ["/", "//"],
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
    regex: /^\/path\/(?<version>v\d+)\/(?<resource>[^/]+)\/?$/,
    match: [["/path/v2/users", { version: "v2", resource: "users" }]],
  },
  "/path/:id?": {
    regex: /^\/path(?:\/(?<id>[^/]+))?\/?$/,
    match: [
      ["/path/123", { id: "123" }],
      ["/path/123/", { id: "123" }],
      ["/path", { id: undefined }],
      ["/path/", { id: undefined }],
    ],
    noMatch: ["/path//", "/path///", "/path/123//"],
  },
  "/path/:id(\\d+)?": {
    regex: /^\/path(?:\/(?<id>\d+))?\/?$/,
    match: [
      ["/path/123", { id: "123" }],
      ["/path", { id: undefined }],
    ],
  },
  "/path/:rest+": {
    regex: /^\/path\/(?:\/\/|(?<rest>(?:[\s\S]*[^/]|\/\/)\/*?)\/?)$/,
    match: [
      ["/path/a/b", { rest: "a/b" }],
      ["/path/a", { rest: "a" }],
      ["/path/\n\r", { rest: "\n\r" }],
      ["/path//a/", { rest: "/a" }],
    ],
    noMatch: ["/path//"],
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
    regex: duplicateNames(
      String.raw`^(?:\/docs\/v2(?:\/(?<page>[^/]+))?\/?|(?:\/docs\/\/(?<page>[^/]+)\/?|\/docs\/?))$`,
    ),
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
    regex: /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+?))?\/?$/,
    match: [
      ["/blog/123", { id: "123", title: undefined }],
      ["/blog/123-my-post", { id: "123", title: "my-post" }],
    ],
  },
  // A `{` / `}` ends a param name, as in URLPattern (the text after one was
  // joined onto it: `/:a{b}?` was a param `ab`).
  "/:a{b}?": {
    regex: /^\/(?<a>[^/]+?)(?:b)?\/?$/,
    match: [
      ["/x", { a: "x" }],
      ["/xb", { a: "x" }],
      ["/xbb", { a: "xb" }],
    ],
    noMatch: ["/", "/x/b"],
  },
  "/:a{b}": {
    regex: /^\/(?<a>[^/]+?)b\/?$/,
    match: [["/xb", { a: "x" }]],
    noMatch: ["/x", "/b"],
  },
  "/:foo{}bar": {
    regex: /^\/(?<foo>[^/]+?)bar\/?$/,
    match: [["/xbar", { foo: "x" }]],
    noMatch: ["/x", "/bar"],
  },
  "/c/{:a}b": {
    regex: /^\/c\/(?<a>[^/]+?)b\/?$/,
    match: [["/c/xb", { a: "x" }]],
    noMatch: ["/c/x"],
  },
  "/x/:a{-:b}?": {
    regex: /^\/x\/(?<a>[^/]+?)(?:-(?<b>[^/]+?))?\/?$/,
    match: [
      ["/x/q", { a: "q", b: undefined }],
      ["/x/q-r", { a: "q", b: "r" }],
      ["/x/q-r-s", { a: "q", b: "r-s" }],
    ],
  },
  "/foo{/bar}?": {
    regex: /^\/foo(?:\/bar)?\/?$/,
    match: [["/foo"], ["/foo/bar"]],
  },
  // An optional group before more of the route is inlined too, instead of an
  // alternation declaring every shared param twice (#213).
  "/users{/:id}?/posts/:post": {
    regex: /^\/users(?:\/(?<id>[^/]+))?\/posts\/(?<post>[^/]+)\/?$/,
    match: [
      ["/users/posts/1", { id: undefined, post: "1" }],
      ["/users/7/posts/1", { id: "7", post: "1" }],
      ["/users/posts/posts/1", { id: "posts", post: "1" }],
      ["/users/7/posts/1/", { id: "7", post: "1" }],
    ],
    noMatch: ["/users/posts", "/users/7/posts", "/users/7/8/posts/1", "/users//posts/1"],
  },
  "/a/:x(\\d+){-:y}?/b": {
    regex: /^\/a\/(?<x>\d+)(?:-(?<y>[^/]+?))?\/b\/?$/,
    match: [
      ["/a/12/b", { x: "12", y: undefined }],
      ["/a/12-c/b", { x: "12", y: "c" }],
    ],
    noMatch: ["/a/12-/b", "/a/c/b", "/a/12"],
  },
  // A shared param extended by the group in its own segment. The router's
  // `/files/:name.:ext` wins where it matches and takes the shortest `name`
  // (URLPattern), so a lazy `name` tried before the group splits the same
  // way.
  "/files/:name{.:ext}?": {
    regex: /^\/files\/(?<name>[^/]+?)(?:\.(?<ext>[^/]+?))?\/?$/,
    match: [
      ["/files/a", { name: "a", ext: undefined }],
      ["/files/a.b", { name: "a", ext: "b" }],
      ["/files/archive.tar.gz", { name: "archive", ext: "tar.gz" }],
      ["/files/.b", { name: ".b", ext: undefined }],
      ["/files/a.", { name: "a.", ext: undefined }],
      ["/files/a..b", { name: "a", ext: ".b" }],
      ["/files/a.b/", { name: "a", ext: "b" }],
    ],
    noMatch: ["/files", "/files/", "/files//", "/files/a/b", "/files/a.b//"],
  },
  // ... and in the middle of the route.
  "/files/:name{.:ext}?/raw": {
    regex: /^\/files\/(?<name>[^/]+?)(?:\.(?<ext>[^/]+?))?\/raw\/?$/,
    match: [
      ["/files/a/raw", { name: "a", ext: undefined }],
      ["/files/archive.tar.gz/raw", { name: "archive", ext: "tar.gz" }],
      ["/files/.b/raw", { name: ".b", ext: undefined }],
    ],
    noMatch: ["/files/raw", "/files/a.b", "/files//raw"],
  },
  // A greedy `*` shares its segment: the look-ahead form stays (the `*`
  // takes as much as the rest of the router's longer route lets it).
  "/files/*{.:ext}?/raw": {
    regex:
      /^\/files\/(?<_0>[^/]*(?=\.(?:[^/]+?)(?:\/|$))|[^/]*(?![^/]))(?:\.(?<ext>[^/]+?))?\/raw\/?$/,
    match: [
      ["/files/a/raw", { "0": "a", ext: undefined }],
      ["/files/archive.tar.gz/raw", { "0": "archive.tar", ext: "gz" }],
      ["/files/.b/raw", { "0": "", ext: "b" }],
      ["/files//raw", { "0": "", ext: undefined }],
    ],
    noMatch: ["/files/raw"],
  },
  // More than one param in a segment: the first takes as little as possible,
  // as in URLPattern (`[^/]+?`); a `*` stays greedy (URLPattern's `(.*)`).
  "/:a-:b": {
    regex: /^\/(?<a>[^/]+?)-(?<b>[^/]+?)\/?$/,
    match: [
      ["/x-y-z", { a: "x", b: "y-z" }],
      ["/x--", { a: "x", b: "-" }],
    ],
    noMatch: ["/x-", "/-x", "/x"],
  },
  "/:name.:ext": {
    regex: /^\/(?<name>[^/]+?)\.(?<ext>[^/]+?)\/?$/,
    match: [
      ["/a.tar.gz", { name: "a", ext: "tar.gz" }],
      ["/.a.b", { name: ".a", ext: "b" }],
    ],
    noMatch: ["/a", "/a."],
  },
  "/:a:b": {
    regex: /^\/(?<a>[^/]+?)(?<b>[^/]+?)\/?$/,
    match: [["/xyz", { a: "x", b: "yz" }]],
    noMatch: ["/x"],
  },
  "/:a-*": {
    regex: /^\/(?<a>[^/]+?)-(?<_0>[^/]*)\/?$/,
    match: [["/x-y-z", { a: "x", "0": "y-z" }]],
  },
  "/*-:a": {
    regex: /^\/(?<_0>[^/]*)-(?<a>[^/]+?)\/?$/,
    match: [["/x-y-z", { "0": "x-y", a: "z" }]],
  },
  // A `?` on a param that does not start its segment makes only the param
  // optional (`pre-{:x}?`, as in URLPattern); `/{pre-:x}?` drops the segment.
  "/pre-:x?": {
    regex: /^\/pre-(?:(?<x>[^/]+?))?\/?$/,
    match: [
      ["/pre-", { x: undefined }],
      ["/pre-a", { x: "a" }],
      ["/pre-a-b/", { x: "a-b" }],
    ],
    noMatch: ["/", "/pre", "/pre-a/b"],
  },
  "/a/pre-:x(\\d+)?": {
    regex: /^\/a\/pre-(?:(?<x>\d+))?\/?$/,
    match: [
      ["/a/pre-", { x: undefined }],
      ["/a/pre-12", { x: "12" }],
    ],
    noMatch: ["/a", "/a/pre-x", "/a/pre"],
  },
  "/a/pre-:x?/b": {
    regex: /^\/a\/pre-(?:(?<x>[^/]+?))?\/b\/?$/,
    match: [
      ["/a/pre-/b", { x: undefined }],
      ["/a/pre-1/b", { x: "1" }],
    ],
    noMatch: ["/a/b", "/a/pre/b"],
  },
  "/a/:x-:y?": {
    regex: /^\/a\/(?<x>[^/]+?)-(?:(?<y>[^/]+?))?\/?$/,
    match: [
      ["/a/1-", { x: "1", y: undefined }],
      ["/a/1-2-3", { x: "1", y: "2-3" }],
      ["/a/1-2-", { x: "1", y: "2-" }],
    ],
    noMatch: ["/a/1", "/a"],
  },
  // After a greedy `*` (or a constraint) only an alternation splits the
  // segment like the router (`*-:x` wins on `a-b-` with `0: "a"`).
  "/f/*-:x?": {
    regex: duplicateNames(
      String.raw`^(?:\/f\/(?<_0>[^/]*)-(?<x>[^/]+?)\/?|\/f\/(?<_0>[^/]*)-\/?)$`,
    ),
    match: [
      ["/f/a-b-", { "0": "a", x: "b-" }],
      ["/f/a-b-c", { "0": "a-b", x: "c" }],
      ["/f/a-", { "0": "a", x: undefined }],
    ],
    noMatch: ["/f/a", "/f"],
  },
  // After a lone `:a`, the route without `b` is the whole-segment `/:a`,
  // which needs a value too.
  "/:a:b?": {
    regex: /^\/(?<a>[^/]+?)(?:(?<b>[^/]+?))?\/?$/,
    match: [
      ["/xyz", { a: "x", b: "yz" }],
      ["/x", { a: "x", b: undefined }],
    ],
    noMatch: ["/", "//", "///"],
  },
  "/a/:a:b?/z": {
    regex: /^\/a\/(?<a>[^/]+?)(?:(?<b>[^/]+?))?\/z\/?$/,
    match: [["/a/xy/z", { a: "x", b: "y" }]],
    noMatch: ["/a/z", "/a//z"],
  },
  "/:a:b(\\d+)?": {
    regex: /^\/(?<a>[^/]+?)(?:(?<b>\d+))?\/?$/,
    match: [
      ["/x12", { a: "x", b: "12" }],
      ["/x1y", { a: "x1y", b: undefined }],
    ],
    noMatch: ["//"],
  },
  // Captures before the group that can't take the char right after them split
  // the segment one way only, and so do a segment and its extension that
  // can't end in the same char: both stay inline.
  "/:id(\\d+)-x{.png}?": {
    regex: /^\/(?<id>\d+)-x(?:\.png)?\/?$/,
    match: [
      ["/1-x", { id: "1" }],
      ["/1-x.png", { id: "1" }],
    ],
    noMatch: ["/1-x.gif", "/a-x"],
  },
  "/img/:w(\\d+)x:h(\\d+){.png}?": {
    regex: /^\/img\/(?<w>\d+)x(?<h>\d+)(?:\.png)?\/?$/,
    match: [
      ["/img/1x2", { w: "1", h: "2" }],
      ["/img/10x20.png", { w: "10", h: "20" }],
    ],
  },
  "/:a(png|jpg)-x{.gz}?": {
    regex: /^\/(?<a>png|jpg)-x(?:\.gz)?\/?$/,
    match: [
      ["/png-x", { a: "png" }],
      ["/jpg-x.gz", { a: "jpg" }],
    ],
  },
  "/*-x{.png}?": {
    regex: /^\/(?<_0>[^/]*)-x(?:\.png)?\/?$/,
    match: [
      ["/a-x-x", { "0": "a-x" }],
      ["/a-x.png", { "0": "a" }],
      ["/a-x.png-x", { "0": "a-x.png" }],
    ],
  },
  "/blog/:id(\\d+)-:slug?": {
    regex: /^\/blog\/(?<id>\d+)-(?:(?<slug>[^/]+?))?\/?$/,
    match: [
      ["/blog/1-", { id: "1", slug: undefined }],
      ["/blog/1-a-b", { id: "1", slug: "a-b" }],
    ],
  },
  // ... but not where both can end the same way: the greedy `*` would take
  // the group's text (the router's `*-x-x` gives `x`).
  "/*-x{-x}?": {
    regex: duplicateNames(String.raw`^(?:\/(?<_0>[^/]*)-x-x\/?|\/(?<_0>[^/]*)-x\/?)$`),
    match: [
      ["/x-x-x", { "0": "x" }],
      ["/x-x", { "0": "x" }],
    ],
  },
  // Lazy `:name`s before the group: the shortest `x` leaves the group room.
  "/a/:x.a{.a}?/m": {
    regex: /^\/a\/(?<x>[^/]+?)\.a(?:\.a)?\/m\/?$/,
    match: [
      ["/a/b.a.a/m", { x: "b" }],
      ["/a/b.a/m", { x: "b" }],
      ["/a/b.a.a.a/m", { x: "b.a" }],
    ],
    noMatch: ["/a/b/m"],
  },
  "/a/{pre-:x}?": {
    regex: /^\/a(?:\/pre-(?<x>[^/]+?))?\/?$/,
    match: [
      ["/a", { x: undefined }],
      ["/a/pre-b", { x: "b" }],
    ],
    noMatch: ["/a/pre-"],
  },
  // A param name is `[A-Za-z_]\w*`, so a `-` ends it, as in URLPattern:
  // `:test-id` is `:test` then a literal `-id` (it was a param `test-id`).
  "/api/:test-id": {
    regex: /^\/api\/(?<test>[^/]+?)-id\/?$/,
    match: [["/api/abc-id", { test: "abc" }]],
    noMatch: ["/api/abc", "/api/-id"],
  },
  "/files/:file-name.json": {
    regex: /^\/files\/(?<file>[^/]+?)-name\.json\/?$/,
    match: [["/files/readme-name.json", { file: "readme" }]],
    noMatch: ["/files/readme.json"],
  },
  "/mix/:a-b.:a_b": {
    regex: /^\/mix\/(?<a>[^/]+?)-b\.(?<a_b>[^/]+?)\/?$/,
    match: [["/mix/x-b.y", { a: "x", a_b: "y" }]],
    noMatch: ["/mix/x.y"],
  },
  // An escaped `-` is a literal too (it ended the name before as well).
  "/api/:test\\-id": {
    regex: /^\/api\/(?<test>[^/]+?)-id\/?$/,
    match: [["/api/abc-id", { test: "abc" }]],
  },
  // Every route name is an identifier, but names in the reserved `__rou3_`
  // space (and `_N`-shaped ones, the unnamed capture form `routeToRegExp`
  // emits: see `find.test.ts`, the group helpers here read `_N` as unnamed)
  // are emitted in an injective escaped form (`_` -> `__`) and decoded back to
  // the param name when groups are read.
  "/api/:__rou3_x": {
    regex: /^\/api\/(?<__rou3_esc_____rou3__x>[^/]+)\/?$/,
    match: [["/api/abc", { __rou3_x: "abc" }]],
  },
  "/api/:__rou3_x?": {
    regex: /^\/api(?:\/(?<__rou3_esc_____rou3__x>[^/]+))?\/?$/,
    match: [
      ["/api/abc", { __rou3_x: "abc" }],
      ["/api", { __rou3_x: undefined }],
    ],
  },
  "/api/**:__rou3_x": {
    regex: /^\/api\/(?:\/\/|(?<__rou3_esc_____rou3__x>(?:[\s\S]*[^/]|\/\/)\/*?)\/?)$/,
    match: [["/api/a/b", { __rou3_x: "a/b" }]],
    noMatch: ["/api", "/api/", "/apifoo"],
  },
  // The reserved prefixes must not collapse with the unnamed `*` (`_0`).
  "/run/:__rou3_esc_a.:__rou3_unnamed_1.*": {
    regex:
      /^\/run\/(?<__rou3_esc_____rou3__esc__a>[^/]+?)\.(?<__rou3_esc_____rou3__unnamed__1>[^/]+?)\.(?<_0>[^/]*)\/?$/,
    match: [["/run/x.y.z", { __rou3_esc_a: "x", __rou3_unnamed_1: "y", "0": "z" }]],
  },
  // A `-` no word char follows ended a name before too (`[\w-]+` captured
  // `{ "year-": "2024-0", month: "5" }`).
  "/blog/:year-:month": {
    regex: /^\/blog\/(?<year>[^/]+?)-(?<month>[^/]+?)\/?$/,
    match: [["/blog/2024-05", { year: "2024", month: "05" }]],
    noMatch: ["/blog/2024", "/blog/-05"],
  },
  "/a/:x-": {
    regex: /^\/a\/(?<x>[^/]+?)-\/?$/,
    match: [["/a/b-", { x: "b" }]],
    noMatch: ["/a/b", "/a/-"],
  },
  "/a/pre-:x\\-suf": {
    regex: /^\/a\/pre-(?<x>[^/]+?)-suf\/?$/,
    match: [["/a/pre-b-suf", { x: "b" }]],
  },
  // Mid-segment optional after a greedy open-ended capture (`*` -> `[^/]*`).
  // Inlining as `(?<_0>[^/]*)(?:\.webp)?` would let the greedy capture swallow
  // `.webp` (capturing `photo.webp` instead of `photo`), so this must fall back
  // to alternation — which anchors the literal outside the capture and keeps
  // `_0` = `photo`. The fallback reuses the `_0` named group across branches
  // (see PCRE2_DUPLICATE_NAME_ROUTES).
  "/media/*{.webp}?": {
    regex: duplicateNames(
      String.raw`^(?:\/media\/(?<_0>[^/]*)\.webp\/?|\/media(?:\/(?<_0>[^/]*))??\/?)$`,
    ),
    match: [
      ["/media/photo.webp", { "0": "photo" }],
      ["/media/photo", { "0": "photo" }],
    ],
  },
  // A required param followed by an optional one: both need a value, so
  // neither is ever empty and a plain `/?$` ends the regex exactly.
  "/path/:id/:tab?": {
    regex: /^\/path\/(?<id>[^/]+)(?:\/(?<tab>[^/]+))?\/?$/,
    match: [
      ["/path/1", { id: "1", tab: undefined }],
      ["/path/1/", { id: "1", tab: undefined }],
      ["/path/1/t", { id: "1", tab: "t" }],
      ["/path/1/t/", { id: "1", tab: "t" }],
    ],
    noMatch: [
      "/path",
      "/path/",
      "/path//",
      "/path//t",
      "/path///",
      "/path/1//",
      "/path/1/t//",
      "/path/1/t/x",
    ],
  },
  // Several required segments: only the last one decides the ending.
  "/users/:org/:id/:tab?": {
    regex: /^\/users\/(?<org>[^/]+)\/(?<id>[^/]+)(?:\/(?<tab>[^/]+))?\/?$/,
    match: [
      ["/users/o/1", { org: "o", id: "1", tab: undefined }],
      ["/users/o/1/t/", { org: "o", id: "1", tab: "t" }],
    ],
    noMatch: ["/users/o", "/users/o/", "/users/o//", "/users//1/t/", "/users/o/1/t//"],
  },
  "/users/:id/*": {
    regex: /^\/users\/(?<id>[^/]+)(?:\/(?<_0>[^/]*))??\/?$/,
    match: [
      ["/users/1", { id: "1", "0": undefined }],
      ["/users/1/", { id: "1", "0": undefined }],
      ["/users/1//", { id: "1", "0": "" }],
      ["/users/1/x", { id: "1", "0": "x" }],
      ["/users/1/x/", { id: "1", "0": "x" }],
    ],
    noMatch: ["/users", "/users/", "/users//", "/users//x", "/users/1/x/y", "/users/1/x//"],
  },
  // A `**` after a required segment. On zero segments its group matches
  // nothing, and JS leaves an optional group that matched nothing unset (the
  // router reports `""`), like the `**` of `/path/**` on `/path`.
  "/users/:id/**": {
    regex: /^\/users\/(?<id>[^/]+)(?:\/(?<_>(?:[\s\S]*[^/])?\/*?))?\/?$/,
    match: [
      ["/users/1", { id: "1", _: undefined }, { id: "1", _: "" }],
      ["/users/1/", { id: "1", _: "" }],
      ["/users/1//", { id: "1", _: "" }],
      ["/users/1/a/b", { id: "1", _: "a/b" }],
      ["/users/1/a/b/", { id: "1", _: "a/b" }],
      ["/users/1/a//", { id: "1", _: "a/" }],
    ],
    noMatch: ["/users", "/users/", "/users//", "/users///", "/usersx/1"],
  },
  "/docs/:lang/:page*": {
    regex: /^\/docs\/(?<lang>[^/]+)(?:\/(?<page>(?:[\s\S]*[^/])?\/*?))??\/?$/,
    match: [
      ["/docs/en", { lang: "en", page: undefined }],
      ["/docs/en/", { lang: "en", page: undefined }],
      ["/docs/en//", { lang: "en", page: "" }],
      ["/docs/en/a/b", { lang: "en", page: "a/b" }],
      ["/docs/en/a/b/", { lang: "en", page: "a/b" }],
      ["/docs/en/a//", { lang: "en", page: "a/" }],
    ],
    noMatch: ["/docs", "/docs/", "/docs//", "/docs//a"],
  },
  // Optional segments in a row nest: the router only takes `day` along with
  // `month` (`/posts/:year/:day` is shadowed by `/posts/:year/:month`).
  "/posts/:year/:month?/:day?": {
    regex: /^\/posts\/(?<year>[^/]+)(?:\/(?<month>[^/]+)(?:\/(?<day>[^/]+))?)?\/?$/,
    match: [
      ["/posts/2024", { year: "2024", month: undefined, day: undefined }],
      ["/posts/2024/", { year: "2024", month: undefined, day: undefined }],
      ["/posts/2024/01", { year: "2024", month: "01", day: undefined }],
      ["/posts/2024/01/", { year: "2024", month: "01", day: undefined }],
      ["/posts/2024/01/02/", { year: "2024", month: "01", day: "02" }],
    ],
    noMatch: [
      "/posts",
      "/posts/",
      "/posts//01",
      "/posts/2024//",
      "/posts/2024/01//",
      "/posts/2024///",
      "/posts/2024/01/02//",
      "/posts/2024/01/02/x",
    ],
  },
  "/a/:x?/:y?": {
    regex: /^\/a(?:\/(?<x>[^/]+)(?:\/(?<y>[^/]+))?)?\/?$/,
    match: [
      ["/a", { x: undefined, y: undefined }],
      ["/a/", { x: undefined, y: undefined }],
      ["/a/b", { x: "b", y: undefined }],
      ["/a/b/", { x: "b", y: undefined }],
      ["/a/b/c", { x: "b", y: "c" }],
    ],
    noMatch: ["/ab", "/a//", "/a/b//", "/a///", "/a/b/c//", "/a/b/c/d"],
  },
  // A `*` can be empty, so it doesn't nest in a `:x?` (which needs a value):
  // `/a//` is the route without `x`.
  "/a/:x?/*": {
    regex: /^\/a(?:\/(?<x>[^/]+))?(?:\/(?<_0>[^/]*))??\/?$/,
    match: [
      ["/a", { x: undefined, "0": undefined }],
      ["/a//", { x: undefined, "0": "" }],
      ["/a/b/c", { x: "b", "0": "c" }],
      ["/a/b//", { x: "b", "0": "" }],
      // The router picks `/a/*` (see OPTIONAL_BEFORE_WILDCARD in regexp.test.ts).
      ["/a/b", { x: "b", "0": undefined }, { "0": "b" }],
    ],
    noMatch: ["/a//c", "/a///"],
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
  // An optional group spanning segments: `/path/sub/` must not match (it
  // strips to `/path/sub`, which is neither branch).
  "/path{/sub/:id}?": {
    regex: /^\/path(?:\/sub\/(?<id>[^/]+))?\/?$/,
    match: [
      ["/path", { id: undefined }],
      ["/path/", { id: undefined }],
      ["/path/sub/1", { id: "1" }],
      ["/path/sub/1/", { id: "1" }],
    ],
    noMatch: ["/path/sub", "/path/sub/", "/path/sub//", "/path//", "/path/sub/1//"],
  },
  // A group whose required segment is followed by an optional one.
  "/path{/sub/:id/*}?": {
    regex: /^\/path(?:\/sub\/(?<id>[^/]+)(?:\/(?<_0>[^/]*))??)?\/?$/,
    match: [
      ["/path", { id: undefined, "0": undefined }],
      ["/path/", { id: undefined, "0": undefined }],
      ["/path/sub/1", { id: "1", "0": undefined }],
      ["/path/sub/1/", { id: "1", "0": undefined }],
      ["/path/sub/1//", { id: "1", "0": "" }],
      ["/path/sub/1/x/", { id: "1", "0": "x" }],
    ],
    noMatch: [
      "/path/sub",
      "/path/sub/",
      "/path/sub//",
      "/path/sub//x",
      "/path//",
      "/path/sub/1/x//",
    ],
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
    regex: /^\/path(?:\/sub(?:\/(?<id>[^/]+))?)?\/?$/,
    match: [
      ["/path", { id: undefined }],
      ["/path/sub/", { id: undefined }],
      ["/path/sub/1/", { id: "1" }],
    ],
    noMatch: ["/path//", "/path/sub//", "/path/sub/1//"],
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
  // Segments after `**` match the end of the path, the `**` what is between
  // (empty segments included). At the root the leading slash doubles as the
  // separator, so `_` is `""` where it matches no segment, as in the router.
  "/**/_payload.json": {
    regex: /^\/?(?<_>[\s\S]*)\/_payload\.json\/?$/,
    match: [
      ["/_payload.json", { _: "" }],
      ["//_payload.json", { _: "" }],
      ["/blog/post/_payload.json", { _: "blog/post" }],
      ["/blog/post/_payload.json/", { _: "blog/post" }],
      ["/a//_payload.json", { _: "a/" }],
      ["/a/\n/_payload.json", { _: "a/\n" }],
    ],
    noMatch: ["/", "/_payload.json//", "/_payload.jsonx", "/x_payload.json", "/_payload.json/x"],
  },
  // After a prefix, the separator stays with it (`/pathx/suffix` must not
  // match); `_` is unset where it matches no segment (the router: `""`).
  "/path/**/suffix": {
    regex: /^\/path(?:\/(?<_>[\s\S]*))?\/suffix\/?$/,
    match: [
      ["/path/suffix", { _: undefined }, { _: "" }],
      ["/path//suffix", { _: "" }],
      ["/path/a/b/suffix", { _: "a/b" }],
      ["/path/suffix/suffix/", { _: "suffix" }],
    ],
    noMatch: ["/path", "/pathsuffix", "/pathx/suffix", "/path/suffix/x", "/path/suffix//"],
  },
  "/base/**:path/suffix": {
    regex: /^\/base\/(?<path>[\s\S]+)\/suffix\/?$/,
    match: [
      ["/base///suffix", { path: "/" }],
      ["/base/a/suffix", { path: "a" }],
      ["/base/a/b/suffix/", { path: "a/b" }],
    ],
    noMatch: ["/base/suffix", "/base//suffix", "/base", "/basex/a/suffix"],
  },
  // The last segment is fixed by the path, so the greedy `**` can't take it.
  "/a/**/b{.json}?": {
    regex: /^\/a(?:\/(?<_>[\s\S]*))?\/b(?:\.json)?\/?$/,
    match: [
      ["/a/b", { _: undefined }, { _: "" }],
      ["/a/b.json/", { _: undefined }, { _: "" }],
      ["/a/x/b.json", { _: "x" }],
      ["/a/b/b", { _: "b" }],
    ],
    noMatch: ["/a", "/ab", "/ab/b", "/a/b/c", "/a/b.jsonx"],
  },
  "/path/:rest+/suffix": {
    regex: /^\/path\/(?<rest>[\s\S]+)\/suffix\/?$/,
    match: [
      ["/path/a/suffix", { rest: "a" }],
      ["/path/a/b/suffix", { rest: "a/b" }],
    ],
    noMatch: ["/path", "/path/suffix", "/path//suffix", "/path/a"],
  },
  // A `:x+` / `:x*` before the last segment is a `**:x` in the tree; `:x*`
  // also registers the route without it (lazy: `rest` unset on `/path/suffix`).
  "/path/:rest*/suffix": {
    regex: /^\/path(?:\/(?<rest>[\s\S]*))??\/suffix\/?$/,
    match: [
      ["/path/suffix", { rest: undefined }],
      ["/path//suffix", { rest: "" }],
      ["/path/a/b/suffix", { rest: "a/b" }],
    ],
    noMatch: ["/path", "/path/a", "/pathsuffix"],
  },
  "/path/:rest+/meta{.json}?": {
    regex: /^\/path\/(?<rest>[\s\S]+)\/meta(?:\.json)?\/?$/,
    match: [
      ["/path/a/meta", { rest: "a" }],
      ["/path/a/b/meta.json/", { rest: "a/b" }],
    ],
    noMatch: ["/path/meta", "/path//meta", "/path/a/metax", "/path/secret"],
  },
  // `**<rest>` is `**/*<rest>`; a `*` after `**` takes one segment.
  "/**/*.png": {
    regex: /^\/?(?<_>[\s\S]*)\/(?<_0>[^/]*)\.png\/?$/,
    match: [
      ["/x.png", { "0": "x", _: "" }],
      ["/.png", { "0": "", _: "" }],
      ["/a/b/x.png", { "0": "x", _: "a/b" }],
      ["/a/x.png/", { "0": "x", _: "a" }],
    ],
    noMatch: ["/", "/x.jpg", "/x.png/y"],
  },
  "/:id/**/:file(\\w+).json": {
    regex: /^\/(?<id>[^/]+)(?:\/(?<_>[\s\S]*))?\/(?<file>\w+)\.json\/?$/,
    match: [
      ["/1/c.json", { id: "1", _: undefined, file: "c" }, { id: "1", _: "", file: "c" }],
      ["/1/a/b/c.json", { id: "1", _: "a/b", file: "c" }],
    ],
    noMatch: ["/c.json", "//c.json", "/1/c-d.json", "/1/a/.json"],
  },
  "/**.md": {
    regex: /^\/?(?<_>[\s\S]*)\/(?<_0>[^/]*)\.md\/?$/,
    match: [
      ["/readme.md", { "0": "readme", _: "" }],
      ["/docs/guide/intro.md/", { "0": "intro", _: "docs/guide" }],
    ],
    noMatch: ["/", "/a.mdx", "/a.md/b"],
  },
  "/blog/**.json": {
    regex: /^\/blog(?:\/(?<_>[\s\S]*))?\/(?<_0>[^/]*)\.json\/?$/,
    match: [
      ["/blog/post.json", { "0": "post", _: undefined }, { "0": "post", _: "" }],
      ["/blog/a/post.json", { "0": "post", _: "a" }],
    ],
    noMatch: ["/blog", "/post.json", "/blogpost.json"],
  },
  // A `:x` after `**` needs a value too (`//` is no match).
  "/**/:file": {
    regex: /^\/?(?<_>[\s\S]*)\/(?<file>[^/]+)\/?$/,
    match: [
      ["/a", { _: "", file: "a" }],
      ["/a/b/c", { _: "a/b", file: "c" }],
      ["/a/b/", { _: "a", file: "b" }],
      ["//a", { _: "", file: "a" }],
    ],
    noMatch: ["/", "//", "/a//"],
  },
  // A lone optional segment after `**`: it is lazy, so `page` takes the last
  // segment where it has a value, and the `**` takes the rest (an empty last
  // segment included: `/a/x//` gives `_: "x/"`).
  "/a/**/:page?": {
    regex: /^\/a(?:\/(?<_>[\s\S]*?))??(?:\/(?<page>[^/]+))?\/?$/,
    match: [
      ["/a", { _: undefined, page: undefined }, { _: "" }],
      ["/a/", { _: undefined, page: undefined }, { _: "" }],
      ["/a/x", { _: undefined, page: "x" }, { _: "", page: "x" }],
      ["/a/x/y", { _: "x", page: "y" }],
      ["/a/x/y/", { _: "x", page: "y" }],
      ["/a//", { _: "", page: undefined }],
      ["/a/x//", { _: "x/", page: undefined }],
    ],
    noMatch: ["/ab", "/b"],
  },
  "/a/:x*/*": {
    regex: /^\/a(?:\/(?:(?:(?<x>[\s\S]*)\/)?(?:(?<_0>[^/]+)\/?|\/))?)?$/,
    match: [
      ["/a", { "0": undefined, x: undefined }],
      ["/a/b", { "0": "b", x: undefined }],
      ["/a/b/c", { "0": "c", x: "b" }],
      ["/a/b/c/d/", { "0": "d", x: "b/c" }],
    ],
    noMatch: ["/ab", "/b"],
  },
  // Other optionals right after a `**`: it is lazy, so they take the end
  // of the path where they match, and `/?$` is exact (the `**` absorbs a
  // stripped slash).
  "/a/**/:n(\\d+)?": {
    regex: /^\/a(?:\/(?<_>[\s\S]*?))??(?:\/(?<n>\d+))?\/?$/,
    match: [
      ["/a", { _: undefined, n: undefined }, { _: "" }],
      ["/a/1", { _: undefined, n: "1" }, { _: "", n: "1" }],
      ["/a/b/1", { _: "b", n: "1" }],
      ["/a/b/c", { _: "b/c", n: undefined }],
      ["/a/b/", { _: "b", n: undefined }],
    ],
    noMatch: ["/ab"],
  },
  // ... but not after a required catch-all, which takes a single segment
  // where the optional one is absent (look-behind).
  "/a/**:r/:y?": {
    regex: /^\/a\/(?<r>[\s\S]+?)(?:\/(?<y>[^/]+))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/a/b", { r: "b", y: undefined }],
      ["/a/b/", { r: "b", y: undefined }],
      ["/a/b/c", { r: "b", y: "c" }],
      ["/a///", { r: "/", y: undefined }],
      ["/a/b//", { r: "b/", y: undefined }],
    ],
    noMatch: ["/a", "/a/", "/a//", "/ab"],
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
  "/a/**:r/:y?",
]);

// Fixtures whose regex holds a capture with a look-ahead (a greedy `*` or a
// constraint extended by an optional group in its own segment, see
// `mergeCapture` in src/regexp.ts; a `:name` there is lazy and needs none).
// RE2-family engines reject them and `regExpToRoute` can't read them back.
export const LOOKAHEAD_ROUTES: ReadonlySet<string> = new Set(["/files/*{.:ext}?/raw"]);

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
  "/f/*-:x?",
  "/*-x{-x}?",
  "/docs/{v2}?/:page?",
]);

// Their regex can't be compiled here (see DUPLICATE_NAMED_GROUPS).
if (!DUPLICATE_NAMED_GROUPS) {
  for (const route of PCRE2_DUPLICATE_NAME_ROUTES) delete regexpCases[route];
}

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
  // A constraint whose match can end in `/`.
  "/files/:name([^.]+)",
  "/path/:x(\\S+)?",
  // A required catch-all (`**:r`, `:x+`) right before an optional segment:
  // where that segment is absent the catch-all takes a single one, and
  // telling a trailing slash from it needs the look-behind.
  "/**:r/:y?",
  "/a/**:r/:y?",
  "/:x+/:y?",
  "/a/:x+/:y?",
  // A segment that can be empty right before a lazy catch-all: a plain `/?$`
  // would let the stripped slash end it.
  "/*/**/:n(\\d+)?",
  "/a//**/:n(\\d+)?",
  // An inline group after a catch-all and an optional segment (or an empty
  // one) that can be empty.
  "/a/**/:y?{/b}?",
  "/a/**/{/b}?",
  "/a/:r*/:y?{/b}?",
]);

// Sweep patterns whose regex holds a capture with a look-ahead (see
// LOOKAHEAD_ROUTES). Pinned like the set above.
export const SWEEP_LOOKAHEAD_PATTERNS: ReadonlySet<string> = new Set([
  // A `:name` extended by a group in its segment is lazy and needs none.
  "/files/*{.:ext}?/raw",
]);

// Sweep patterns whose regex reuses a capture group name across alternation
// branches (see PCRE2_DUPLICATE_NAME_ROUTES). Pinned like the set above.
export const SWEEP_DUPLICATE_NAME_PATTERNS: ReadonlySet<string> = new Set([
  // A group whose segment then folds in a trailing optional (`*`, `:y?`,
  // `**`): the two expansions don't line up segment by segment.
  "/{b}?/*",
  "/{b}?/**",
  "/{b}?/:y?",
  "/a/{b}?/*",
  "/a/{b}?/**",
  "/a/{b}?/:y?",
  "/:x{.:e}?/*",
  "/:x{.:e}?/**",
  "/:x{.:e}?/:y?",
  "/a/:x{.:e}?/*",
  "/a/:x{.:e}?/**",
  "/a/:x{.:e}?/:y?",
  // An empty segment followed only by optional ones expands like the router.
  "/{en}?/:page?",
  "/docs/{v2}?/:page?",
  // Two groups.
  "/:x{.:e}?/b{.json}?",
  "/a/:x{.:e}?/b{.json}?",
  // A mid-segment optional after a greedy capture, also where both can end
  // the same way (`-x` / `-x-x`).
  "/media/*{.webp}?",
  "/f/*-:x?",
  "/*-x{-x}?",
  "/*-:e?",
  "/a/*-:e?",
  "/*-:e?/a",
  "/a/*-:e?/a",
  "/*-:e?/:y",
  "/a/*-:e?/:y",
  "/*-:e?/*",
  "/a/*-:e?/*",
  "/*-:e?/:y?",
  "/a/*-:e?/:y?",
  "/*-:e?/**",
  "/a/*-:e?/**",
  "/*-:e?/*.png",
  "/a/*-:e?/*.png",
  "/*-:e?/x-:y",
  "/a/*-:e?/x-:y",
  "/*-:e?/x-:y?",
  "/a/*-:e?/x-:y?",
  "/*-:e?/b{.json}?",
  "/a/*-:e?/b{.json}?",
  // A `:x*` before a `*` that is optional in the route without it.
  "/a/:r*/b/*",
  "/:r*/*.png/*",
  "/a/:r*/:y?/*",
  "/a/:r*/b/*/:y?",
  // A group right after a bare `**`.
  "/a/**{/b/:c?}?",
  "/a/**{.png}?",
]);

/** Whether a regex source uses a look-ahead (RE2-family engines have none). */
export function hasLookahead(source: string): boolean {
  return /\(\?[=!]/.test(source);
}

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
 * fixtures above, minus the routes `addRoute` rejects (a second `**`).
 */
export function sweepPatterns(): string[] {
  return allSweepPatterns().filter(
    (pattern) =>
      routerAccepts(pattern) && (DUPLICATE_NAMED_GROUPS || !needsDuplicateNames(pattern)),
  );
}

/**
 * The sweep patterns `sweepPatterns()` leaves out because this engine lacks
 * duplicate named groups (always empty where it has them).
 */
export function unsupportedSweepPatterns(): string[] {
  if (DUPLICATE_NAMED_GROUPS) return [];
  return allSweepPatterns().filter(
    (pattern) => routerAccepts(pattern) && needsDuplicateNames(pattern),
  );
}

/** `routeToRegExp(pattern)` throws for lack of duplicate named groups. */
export function needsDuplicateNames(pattern: string): boolean {
  try {
    routeToRegExp(pattern);
    return false;
  } catch (error) {
    return /duplicate named groups support/.test((error as Error).message);
  }
}

/**
 * A fixture regex with a named group repeated across alternatives. Where the
 * engine can't compile it, a never-matching placeholder: those fixtures are
 * removed below (see DUPLICATE_NAMED_GROUPS).
 */
function duplicateNames(source: string): RegExp {
  return DUPLICATE_NAMED_GROUPS ? new RegExp(source) : /(?!)/;
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
    // A param extended by an optional group in its own segment (#213).
    ":x{.:e}?",
    // Params sharing a segment (the first takes as little as possible), and
    // an optional param after text in its segment (only the param is).
    ":x-:e",
    ":x.:e",
    "x-:x?",
    "x-:x(\\d+)?",
    // ... after a lone `:x` (whose route without the param takes an empty
    // segment), a greedy `*` or a constraint.
    ":x:e?",
    "*-:e?",
    ":x(\\d+)-:e?",
  ];
  const tails = ["", "a", ":y", "*", ":y?", "**", "*.png", "x-:y", "x-:y?", "b{.json}?"];
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
    // Segments after a catch-all (matched from the end of the path), with a
    // param or empty segment on either side, several of them, optional ones
    // after it (the router picks between the route with and without them).
    "/:x/**/a",
    "/:x(\\d+)/**/:y",
    "/a/**/b/c",
    "/**/:y/b",
    "/**/:y(\\d+)",
    "/a//**/b",
    "/a/**//b",
    "/a/:x?/**/b",
    "/:x+/b/c",
    "/a/:x*/b/:y",
    "/**:r/:y(\\d+)",
    "/**.png",
    "/a/**.png",
    "/**/x-*.png",
    "/**/\\*",
    "/**/b/:y?",
    "/**/:x/:y?",
    "/a/**/:y(\\d+)?",
    "/**/:y{/c}?",
    "/a/**/:y{/c}?",
    "/**/b{/c}?",
    // A trailing `*` after a `:x*` is optional where the route has no `:x*`
    // (`/a/:r*/b/*` also registers `/a/b/*`, which matches `/a/b`).
    "/a/:r*/b/*",
    "/:r*/*.png/*",
    "/a/:r*/:y?/*",
    "/a/:r*/b/*/:y?",
    // A segment that can be empty right before a lazy catch-all: the stripped
    // trailing slash must not end it (`/a/` is not `/a//` for `/a/:p/**/…`).
    "/a/:p/**/:n(\\d+)?",
    "/*/**/:n(\\d+)?",
    "/a//**/:n(\\d+)?",
    "/:p/:r*/:y(\\d+)?",
    // Several optionals after a catch-all: the router ranks the routes it
    // registers per path, the regex's catch-all is lazy or greedy as a whole.
    "/**/:y?/:z?",
    "/a/**/:y?/:z?",
    "/a/**/:n(\\d+)?/:y?",
    "/a/**/:y?/:n(\\d+)?",
    "/a/**/:y?/:n(a|b)?",
    "/a/**/:y?{/b}?",
    "/a/**/{/b}?",
    "/a/**{/b/:c?}?",
    "/a/**{.png}?",
    "/a/:r*/:y?{/b}?",
    ...Object.keys(regexpCases),
    // Removed from `regexpCases` without duplicate named groups.
    ...PCRE2_DUPLICATE_NAME_ROUTES,
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
  return [...patterns];
}

/**
 * Routes `addRoute` rejects: more than one `**` (a `:x+` / `:x*` before the
 * last segment is one). `routeToRegExp` throws the same error for them.
 */
export const TWO_CATCH_ALL_ROUTES: readonly string[] = [
  "/**/**",
  "/a/**/b/**:x",
  "/a/:x+/b/:y+",
  "/**/a/:x*",
  "/a/:x*/**",
  "/a/**/:y+",
  "/**.md/**",
  "/x/:seg*/old/**",
  "/x/:seg+/old/**",
  "/x{/y}?/:seg+/old/**",
  String.raw`/\:x/:seg+/:rest+`,
];

/**
 * Routes with a `(` that does not close in its own segment: a `/` inside a
 * constraint, which the pattern split cuts in two, or a `(` that never closes
 * (#199). `addRoute` and `routeToRegExp` reject them with the same error.
 */
export const UNCLOSED_GROUP_ROUTES: readonly string[] = [
  "/admin/:id([^/]+)",
  "/a/:x(b/c)",
  "/a/(x|/y)/z",
  "/a/:x([/])?",
  "/a/:x(\\/)",
  "/a/:x(\\d+)/:y(a/b)",
  "/a{/:x([^/]+)}?",
  "/a/:x((b|/c))",
  "/files/(2024",
  "/a(b",
  "/a/:x(\\d+",
  "/a/:x([a-z]",
  "/a/((b)",
  "/files/(2024/x",
  "/a/(b/(c)",
  "/a{/(b}?",
];

/**
 * Pattern syntax with no meaning yet: `addRoute` (and `routeToRegExp`,
 * `routeNodeKeys`, which share its pipeline) reject it with a `rou3:` error
 * quoting the route, so it can be given one later. Each was accepted with a
 * wrong or silent meaning, or threw a raw `SyntaxError`.
 */
export const RESERVED_SYNTAX_ROUTES: readonly string[] = [
  // A repeat modifier on a constrained param dropped the constraint in the
  // tree (`/a/b/c` matched with `x: "b/c"`, the regex kept it).
  "/a/:x(\\d+)+",
  "/a/:x(\\d+)*",
  "/a/:x(\\d+)+/b",
  // ... and on a param in a mixed segment dropped the rest of it
  // (`/a/pre-:x+` matched `/a/b` with `x: "b"`).
  "/a/pre-:x+",
  "/a/pre-:x*",
  "/a/:x.:y+",
  // A modifier on an unnamed group: `(\d+)+` backtracks exponentially,
  // `(\d+)*` read as a group then a `*`, `(\d+)?` did not match `/a`.
  "/a/(\\d+)+",
  "/a/(\\d+)*",
  "/a/(\\d+)?",
  "/a/x(\\d+)?y",
  // Anything after `**:name` in its segment was part of the name.
  "/a/**:x(\\d+)",
  "/a/**:x:y",
  "/a/**:x.json",
  // A `:` without a name was a literal `:` (a `\\:` still is).
  "/a/:",
  "/a/**:",
  "/a/x:",
  "/a/:\u00e9",
  "/a/:(\\d+)",
  // A `-` ends a name (`:x-?` is `:x`, `-` and a stray `?`)
  "/a/:-x",
  "/a/**:x-",
  "/a/:x-?",
  "/api/:test-id?",
  "/api/:test-id+",
  "/api/**:test-id",
  // A non-ASCII char right after a name was a literal (`/:café` is `:caf` and
  // `é`), URLPattern reads it as part of the name (`/:caf\\é` is a literal).
  "/:café",
  "/a/:x\u00e9.png",
  "/a/:x(\\d+)/:y\u00a0",
  "/a/**:café",
  "/a/:x\ud83d\udeb2",
  "/a/:\ud83d\udeb2",
  // So is a `$` (a JS identifier char): `/a/:id$` was `:id` and a literal `$`
  // (`/a/:id\\$` still is).
  "/a/:id$",
  "/a/:x$.png",
  "/a/:x$?",
  "/a/pre-:x$",
  "/:$x",
  // A name must start with a letter or `_` (`/:0` collided with the unnamed
  // key `"0"`).
  "/:0",
  "/:1st",
  "/a/:0.txt",
  "/a/:0?",
  "/a/:0+",
  "/a/**:0",
  "/a/pre-:1(\\d+)",
  // A capturing group inside a constraint was a stray param (`/:x((a))`
  // gave `{ x: "a", "0": "a" }`, `/:n/:x((?<n>a))` overwrote `n`,
  // `/:x((?<x>a))` threw a raw `SyntaxError`).
  "/:x((a))",
  "/a/((b)c)",
  "/:x((?<x>a))",
  "/:n/:x((?<n>a))",
  "/(a)/:x((?<_0>b))",
  "/a/:x(a(?<n>b)c)",
  "/a/((?<n>b)c)",
  "/a/:x((?:a)|(b))",
  "/a/:x((?:(a)))",
  "/a/x((b))y",
  // A `?` after plain text was a literal no lookup path can contain (`\\?`
  // still is one).
  "/foo?",
  "/a/b?/c",
  "/a/what?",
  "/a/b?c",
  "/a//\\:x?",
  "/a/*/\\:x?",
  "/a/\\\\?",
  "/a{/b}?/c?",
  "/**/b?",
  // A `**` in the middle of a segment was two `*` captures, the second always
  // `""` (`/**.md`, a segment starting with `**`, is `/**\/*.md`).
  "/a**b",
  "/a/x**",
  "/a/x**y",
  "/a/*.**",
  "/a/:x.**",
  "/a/x***",
  "/a/**x**",
  // A modifier where none applies was a raw regex quantifier.
  "/a/**?",
  "/a/**+",
  "/a/*?",
  "/a/*+",
  "/a/:x??",
  "/a/:x?+",
  "/a/:x+?",
  "/a/:x.png?",
  "/a/:x+b",
  "/a/:x*.png",
  "/a/:x(\\d+)?.png",
  // `**:name?` read the `**` as text before the param (`/p/**:i?` gave
  // `{ _: "" }` on `/p`, an undeclared param); `**:name+` / `**:name*` throw.
  "/p/**:i?",
  "/p/**:i?/b",
  // `{…}+` / `{…}*` always threw an invalid-regex `SyntaxError`.
  "/a/{b}+",
  "/a/{b}*",
  "/a{/b}+",
  "/a/:x{-:y}*",
  // Unbalanced or nested braces were literals, or mis-parsed (`{{b}?}?`
  // matched `/a/}?`).
  "/a/{b",
  "/a/b}",
  "/a/{b}}",
  "/a/{{b}}",
  "/a/{{b}?}?",
  "/a{/b{/c}?}?",
  // Empty groups and `(?` at segment level (`(?<n>x)` was an undocumented
  // named param, `(?:x)` threw a raw `SyntaxError`).
  "/a/()",
  "/a/:x()",
  "/a/(?<n>x)",
  "/a/(?:x)",
  "/a/:x(?:a|b)",
  "/a/x(?=y)",
  // A `\` must escape a char of its segment: a `\/` kept a `\` in the tree
  // and was a `/` in the regex, a trailing `\` threw a raw `SyntaxError`.
  "/foo\\/bar",
  "/a/:x\\/b",
  "/a\\",
  "/a/\\\\\\",
  // An anchor or look-around in a constraint applied to the segment in the
  // tree and to the whole path in the regex (`/:x(^a)/b` routed `/a/b`, its
  // regex matched nothing).
  "/:x(^a)/b",
  "/:x(a$)/b",
  "/a/(^a|b)",
  "/a/:x((^a))",
  "/a/:x(a(?=b))",
  "/a/:x(a(?!b))",
  "/a/:x((?<=a)b)",
  "/a/:x((?<!a)b)",
  // A numbered backreference counts the groups of the segment in the tree and
  // of the whole path in the regex (`/:a/:b(x)(\1)`: `\1` is `b` or `a`).
  "/:a/:b(x)(\\1)",
  "/:a/((x)\\2)",
  "/a/:x((a)\\1)",
  // U+FFFD-U+FFFF are internal placeholders (escapes, the `:name*` marker):
  // written in a route, they read as syntax (`\uFFFD0` as an escaped `:`).
  "/a/**:\uFFFFx",
  "/a/\uFFFD0x",
  "/a/\uFFFEx",
  "/a/:x\uFFFF",
];

/** Whether `addRoute` accepts `pattern`. */
function routerAccepts(pattern: string): boolean {
  try {
    addRoute(createRouter(), "", pattern);
    return true;
  } catch {
    return false;
  }
}

/** Every short path, including empty segments and runs of trailing slashes. */
export function sweepPaths(): string[] {
  const paths = new Set(["/", "//", "///"]);
  const walk = (prefix: string, depth: number) => {
    // `x-` and `x-a-b.c.d` for params sharing a segment (`x-:y?`, `:x-:e`,
    // `:x.:e`: the first param takes as little as possible).
    for (const seg of ["a", "b", "1", "x.png", "", "x-", "x-a-b.c.d"]) {
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
