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
  // A `*` is a catch-all, URLPattern's `(.*)` after its `/`: one segment or
  // more, or none after the trailing slash lookup strips (`/path/`), but not
  // `/path`.
  "/path/*": {
    regex: /^\/path\/(?<_0>(?:[\s\S]*[^/])?\/*?)\/?$/,
    match: [
      // Nothing after the stripped trailing slash, as in URLPattern
      ["/path/", { "0": "" }],
      ["/path//", { "0": "" }],
      ["/path/x", { "0": "x" }],
      ["/path/x/", { "0": "x" }],
      ["/path/x/y", { "0": "x/y" }],
      ["/path/x//", { "0": "x/" }],
      ["/path/\r", { "0": "\r" }],
      ["/path/x/\n", { "0": "x/\n" }],
    ],
    noMatch: ["/path", "/pathx", "/pathx/"],
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
    regex: /^\/path\/(?<_0>[\s\S]*)\/foo\/?$/,
    match: [
      ["/path/anything/foo", { "0": "anything" }],
      ["/path/a/b/foo", { "0": "a/b" }],
      ["/path/foo/foo", { "0": "foo" }],
      ["/path//foo", { "0": "" }],
      ["/path//foo/", { "0": "" }],
    ],
    noMatch: ["/path/foo", "/path/a/foo/b"],
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
    regex: /^\/path\/(?<_0>[\s\S]*)\.png\/?$/,
    match: [
      ["/path/icon.png", { "0": "icon" }],
      // A `*` inside a segment takes `/` too, as in URLPattern
      ["/path/a/icon.png", { "0": "a/icon" }],
      ["/path/.png", { "0": "" }],
    ],
    noMatch: ["/path/icon", "/path/icon.png/x", "/icon.png"],
  },
  "/path/file-*.png": {
    regex: /^\/path\/file-(?<_0>[\s\S]*)\.png\/?$/,
    match: [
      ["/path/file-a.png", { "0": "a" }],
      ["/path/file-a/b.png", { "0": "a/b" }],
      ["/path/file-.png", { "0": "" }],
    ],
    noMatch: ["/path/file-a", "/path/a/file-b.png"],
  },
  "/path/**": {
    regex: /^\/path(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$/,
    match: [
      // Over zero segments the `**` is unset, as in the router (and
      // URLPattern); the lazy group leaves the stripped trailing slash.
      ["/path", { "0": undefined }],
      ["/path/", { "0": undefined }],
      // The catch-all leaves the stripped trailing slash out of the capture.
      ["/path//", { "0": "" }],
      ["/path/a/", { "0": "a" }],
      ["/path/a//", { "0": "a/" }],
      ["/path/anything/more", { "0": "anything/more" }],
      // The router splits on `/` only: line terminators are ordinary chars,
      // mid-path and last alike (a JS `.` excludes all four).
      ["/path/\n", { "0": "\n" }],
      ["/path/a\rb/c", { "0": "a\rb/c" }],
      ["/path/a/\u2028/", { "0": "a/\u2028" }],
      ["/path/\u2029x//", { "0": "\u2029x/" }],
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
  // A literal `?` is percent-encoded, as in URLPattern.
  "/a\\\\b/c\\*d/\\?": {
    regex: /^\/a\\b\/c\*d\/%3F\/?$/,
    match: [["/a\\b/c*d/%3F"]],
    noMatch: ["/a\\b/c*d/?", "/a\\\\b/c*d/%3F", "/ab/c*d/%3F", "/a\\b/c\\*d/\\%3F"],
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
    regex: /^(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$/,
    match: [
      ["/", { "0": undefined }],
      ["//", { "0": "" }],
      ["/a/", { "0": "a" }],
      ["/a//", { "0": "a/" }],
      ["/anything", { "0": "anything" }],
      ["/any/deep/path", { "0": "any/deep/path" }],
      ["/\u2028\u2029", { "0": "\u2028\u2029" }],
      ["/a\n/b\r/", { "0": "a\n/b\r" }],
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
  // An optional unnamed constraint stays unnamed (key `"0"`), no `:_0(…)?`.
  "/a{/(\\d+)}?": {
    regex: /^\/a(?:\/(?<_0>\d+))?\/?$/,
    match: [
      ["/a/12", { "0": "12" }],
      ["/a", { "0": undefined }],
      ["/a/", { "0": undefined }],
    ],
    noMatch: ["/a/x", "/a//"],
  },
  "/{/(\\d+)}?/.": {
    regex: /^\/(?:\/(?<_0>\d+))?\/\.\/?$/,
    match: [
      ["//12/.", { "0": "12" }],
      ["//.", { "0": undefined }],
    ],
    noMatch: ["/12/.", "//x/."],
  },
  "/:y{/(\\d+)}?": {
    regex: /^\/(?<y>[^/]+)(?:\/(?<_0>\d+))?\/?$/,
    match: [
      ["/b/12", { y: "b", "0": "12" }],
      ["/b", { y: "b", "0": undefined }],
    ],
    noMatch: ["/b/x", "/b//"],
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
  // `:rest*` is `{/:rest+}?`: the same closed ending in an optional group.
  "/path/:rest*": {
    regex: /^\/path(?:\/(?:(?:\/\/|(?<rest>(?:[\s\S]*[^/]|\/\/)\/*?)\/?))?)?$/,
    match: [
      ["/path/a/b", { rest: "a/b" }],
      ["/path/a/b/", { rest: "a/b" }],
      ["/path/a//", { rest: "a/" }],
      ["/path", { rest: undefined }],
      ["/path/", { rest: undefined }],
      ["/path/a\n/b\r/", { rest: "a\n/b\r" }],
      ["/path///", { rest: undefined }, { rest: "/" }],
      ["/path//a", { rest: "/a" }],
    ],
    // `:rest*` never captures `""` (as `:rest+`)
    noMatch: ["/path//"],
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
  // A group right after a `*` (a catch-all) adds an optional part the router
  // ranks against the route without it: an alternation, as for a `**`.
  "/files/*{.:ext}?/raw": {
    regex: duplicateNames(
      String.raw`^(?:\/files\/(?<_0>[\s\S]*)\.(?<ext>[^/]+?)\/raw\/?|\/files\/(?<_0>[\s\S]*)\/raw\/?)$`,
    ),
    match: [
      ["/files/a/raw", { "0": "a", ext: undefined }],
      ["/files/archive.tar.gz/raw", { "0": "archive.tar", ext: "gz" }],
      ["/files/.b/raw", { "0": "", ext: "b" }],
      ["/files//raw", { "0": "", ext: undefined }],
      ["/files/a/b.c/raw", { "0": "a/b", ext: "c" }],
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
    regex: /^\/(?<a>[^/]+?)-(?<_0>(?:[\s\S]*[^/])?\/*?)\/?$/,
    match: [
      ["/x-y-z", { a: "x", "0": "y-z" }],
      ["/x-y/z", { a: "x", "0": "y/z" }],
      ["/x-/", { a: "x", "0": "" }],
    ],
    noMatch: ["/x/y-z"],
  },
  "/*-:a": {
    regex: /^\/(?<_0>[\s\S]*)-(?<a>[^/]+?)\/?$/,
    match: [
      ["/x-y-z", { "0": "x-y", a: "z" }],
      ["/x-y/z-w", { "0": "x-y/z", a: "w" }],
    ],
    noMatch: ["/x-y/z", "/x-"],
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
  // After a greedy `*` (or a constraint) too: the capture before it takes
  // what it can, as in URLPattern (`a-b-` is `0: "a-b"`, no `x`).
  "/f/*-:x?": {
    regex: /^\/f\/(?<_0>[\s\S]*)-(?:(?<x>[^/]+?))?\/?$/,
    match: [
      ["/f/a-b-", { "0": "a-b", x: undefined }],
      ["/f/a-b-c", { "0": "a-b", x: "c" }],
      ["/f/a-", { "0": "a", x: undefined }],
      ["/f/--", { "0": "-", x: undefined }],
      ["/f/a/b-c", { "0": "a/b", x: "c" }],
    ],
    noMatch: ["/f/a", "/f", "/f/a-b/c"],
  },
  "/x/:a(\\d+):b?": {
    regex: /^\/x\/(?<a>\d+)(?:(?<b>[^/]+?))?\/?$/,
    match: [
      ["/x/12", { a: "12", b: undefined }],
      ["/x/1", { a: "1", b: undefined }],
      ["/x/12a", { a: "12", b: "a" }],
    ],
    noMatch: ["/x/a", "/x"],
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
    regex: /^\/(?<_0>[\s\S]*)-x(?:\.png)?\/?$/,
    match: [
      ["/a-x-x", { "0": "a-x" }],
      ["/a-x.png", { "0": "a" }],
      ["/a-x.png-x", { "0": "a-x.png" }],
      ["/a/b-x.png", { "0": "a/b" }],
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
    regex: duplicateNames(String.raw`^(?:\/(?<_0>[\s\S]*)-x-x\/?|\/(?<_0>[\s\S]*)-x\/?)$`),
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
      /^\/run\/(?<__rou3_esc_____rou3__esc__a>[^/]+?)\.(?<__rou3_esc_____rou3__unnamed__1>[^/]+?)\.(?<_0>(?:[\s\S]*[^/])?\/*?)\/?$/,
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
  // An optional part right after a greedy `*`: inlining it as
  // `(?<_0>[\s\S]*)(?:\.webp)?` would let the capture swallow `.webp`
  // (`photo.webp` instead of `photo`), so this falls back to alternation,
  // which anchors the literal outside the capture and keeps `_0` = `photo`.
  // The fallback reuses the `_0` named group across branches (see
  // PCRE2_DUPLICATE_NAME_ROUTES).
  "/media/*{.webp}?": {
    regex: duplicateNames(
      String.raw`^(?:\/media\/(?<_0>[\s\S]*)\.webp\/?|\/media\/(?<_0>(?:[\s\S]*[^/])?\/*?)\/?)$`,
    ),
    match: [
      ["/media/photo.webp", { "0": "photo" }],
      ["/media/photo", { "0": "photo" }],
      ["/media/a/photo.webp", { "0": "a/photo" }],
      ["/media/", { "0": "" }],
    ],
    noMatch: ["/media"],
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
    regex: /^\/users\/(?<id>[^/]+)\/(?<_0>(?:[\s\S]*[^/])?\/*?)\/?$/,
    match: [
      ["/users/1/", { id: "1", "0": "" }],
      ["/users/1//", { id: "1", "0": "" }],
      ["/users/1/x", { id: "1", "0": "x" }],
      ["/users/1/x/", { id: "1", "0": "x" }],
      ["/users/1/x/y", { id: "1", "0": "x/y" }],
      ["/users/1/x//", { id: "1", "0": "x/" }],
    ],
    noMatch: ["/users", "/users/", "/users//", "/users//x", "/users/1"],
  },
  // A `**` after a required segment, unset over zero segments (like the
  // `**` of `/path/**` on `/path`).
  "/users/:id/**": {
    regex: /^\/users\/(?<id>[^/]+)(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$/,
    match: [
      ["/users/1", { id: "1", "0": undefined }],
      ["/users/1/", { id: "1", "0": undefined }],
      ["/users/1//", { id: "1", "0": "" }],
      ["/users/1/a/b", { id: "1", "0": "a/b" }],
      ["/users/1/a/b/", { id: "1", "0": "a/b" }],
      ["/users/1/a//", { id: "1", "0": "a/" }],
    ],
    noMatch: ["/users", "/users/", "/users//", "/users///", "/usersx/1"],
  },
  "/docs/:lang/:page*": {
    regex: /^\/docs\/(?<lang>[^/]+)(?:\/(?:(?:\/\/|(?<page>(?:[\s\S]*[^/]|\/\/)\/*?)\/?))?)?$/,
    match: [
      ["/docs/en", { lang: "en", page: undefined }],
      ["/docs/en/", { lang: "en", page: undefined }],
      ["/docs/en/a/b", { lang: "en", page: "a/b" }],
      ["/docs/en/a/b/", { lang: "en", page: "a/b" }],
      ["/docs/en/a//", { lang: "en", page: "a/" }],
    ],
    noMatch: ["/docs", "/docs/", "/docs//", "/docs//a", "/docs/en//"],
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
  // `/a/:x/*` where `x` has a segment and the `*` takes the rest (`/a/b/` gives
  // it nothing), else `/a/*`.
  "/a/:x?/*": {
    regex: /^\/a(?:\/(?<x>[^/]+))?\/(?<_0>(?:[\s\S]*[^/])?\/*?)\/?$/,
    match: [
      ["/a/", { x: undefined, "0": "" }],
      ["/a//", { x: undefined, "0": "" }],
      ["/a/b/c", { x: "b", "0": "c" }],
      ["/a/b//", { x: "b", "0": "" }],
      ["/a/b", { x: undefined, "0": "b" }],
      ["/a//c", { x: undefined, "0": "/c" }],
      ["/a///", { x: undefined, "0": "/" }],
    ],
    noMatch: ["/a", "/ab"],
  },
  // An empty segment before a `*` is required too.
  "/a//*": {
    regex: /^\/a\/\/(?<_0>(?:[\s\S]*[^/])?\/*?)\/?$/,
    match: [
      ["/a//", { "0": "" }],
      ["/a///", { "0": "" }],
      ["/a//x", { "0": "x" }],
      ["/a//x/", { "0": "x" }],
      ["/a//x//", { "0": "x/" }],
      ["/a//x/y", { "0": "x/y" }],
    ],
    noMatch: ["/a", "/a/", "/a/x"],
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
  // A group ending in a `*` (lazy: the route without it wins where both match).
  "/path{/sub/:id/*}?": {
    regex: /^\/path(?:\/sub\/(?<id>[^/]+)\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$/,
    match: [
      ["/path", { id: undefined, "0": undefined }],
      ["/path/", { id: undefined, "0": undefined }],
      ["/path/sub/1/", { id: "1", "0": "" }],
      ["/path/sub/1//", { id: "1", "0": "" }],
      ["/path/sub/1/x/", { id: "1", "0": "x" }],
      ["/path/sub/1/x//", { id: "1", "0": "x/" }],
    ],
    noMatch: ["/path/sub", "/path/sub/", "/path/sub//", "/path/sub//x", "/path//", "/path/sub/1"],
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
  // route without it there, and `//` is no match (`x` would be `""`).
  "/:path*": {
    regex: /^(?:\/(?:(?:\/\/|(?<path>(?:[\s\S]*[^/]|\/\/)\/*?)\/?))?)?$/,
    match: [
      ["/", { path: undefined }],
      ["/a", { path: "a" }],
      ["/a/b/", { path: "a/b" }],
      ["/a/b//", { path: "a/b/" }],
      ["/\n", { path: "\n" }],
      ["/a\u2028b/", { path: "a\u2028b" }],
    ],
    noMatch: ["//"],
  },
  // Trailing optionals nested in an inline group get the same endings as
  // top-level ones: a catch-all never keeps the stripped trailing slash, an
  // inner `*` / `:x?` / `:x*` stays unset where the router takes the route
  // without it, and no look-behind is needed.
  "/path{/sub/**}?": {
    regex: /^\/path(?:\/sub(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??)?\/?$/,
    match: [
      ["/path", { "0": undefined }],
      ["/path/", { "0": undefined }],
      ["/path/sub/", { "0": undefined }],
      ["/path/sub//", { "0": "" }],
      ["/path/sub/a", { "0": "a" }],
      ["/path/sub/a/", { "0": "a" }],
      ["/path/sub/a//", { "0": "a/" }],
      ["/path/sub/a/b", { "0": "a/b" }],
      ["/path/sub/\ra\n/", { "0": "\ra\n" }],
    ],
    noMatch: ["/path//", "/path/subx", "/path/other"],
  },
  "/path{/sub/:rest*}?": {
    regex: /^\/path(?:\/(?:sub(?:\/(?:(?:\/\/|(?<rest>(?:[\s\S]*[^/]|\/\/)\/*?)\/?))?)?)?)?$/,
    match: [
      ["/path", { rest: undefined }],
      ["/path/sub", { rest: undefined }],
      ["/path/sub/", { rest: undefined }],
      ["/path/sub/a/", { rest: "a" }],
      ["/path/sub/a/b//", { rest: "a/b/" }],
      ["/path/sub/\u2028x/y", { rest: "\u2028x/y" }],
    ],
    noMatch: ["/path//", "/path/subx", "/path/sub//"],
  },
  "/path{/sub/*}?": {
    regex: /^\/path(?:\/sub\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$/,
    match: [
      ["/path", { "0": undefined }],
      ["/path/sub/", { "0": "" }],
      ["/path/sub//", { "0": "" }],
      ["/path/sub/a", { "0": "a" }],
      ["/path/sub/a/", { "0": "a" }],
      ["/path/sub/a//", { "0": "a/" }],
      ["/path/sub/a/b", { "0": "a/b" }],
    ],
    noMatch: ["/path//", "/path/sub"],
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
    regex: /^\/path(?:\/(?:(?:\/\/|(?<rest>(?:[\s\S]*[^/]|\/\/)\/*?)\/?))?)?$/,
    match: [
      ["/path", { rest: undefined }],
      ["/path/", { rest: undefined }],
      ["/path/a/", { rest: "a" }],
      ["/path/a//", { rest: "a/" }],
    ],
    noMatch: ["/pathx", "/path//"],
  },
  // Segments after `**` match the end of the path, the `**` what is between
  // (empty segments included), unset where it matches no segment. At the
  // root its group carries its own separator.
  "/**/_payload.json": {
    regex: /^(?:\/(?<_0>[\s\S]*))?\/_payload\.json\/?$/,
    match: [
      ["/_payload.json", { "0": undefined }],
      ["//_payload.json", { "0": "" }],
      ["/blog/post/_payload.json", { "0": "blog/post" }],
      ["/blog/post/_payload.json/", { "0": "blog/post" }],
      ["/a//_payload.json", { "0": "a/" }],
      ["/a/\n/_payload.json", { "0": "a/\n" }],
    ],
    noMatch: ["/", "/_payload.json//", "/_payload.jsonx", "/x_payload.json", "/_payload.json/x"],
  },
  // After a prefix, the separator stays with it (`/pathx/suffix` must not
  // match).
  "/path/**/suffix": {
    regex: /^\/path(?:\/(?<_0>[\s\S]*))?\/suffix\/?$/,
    match: [
      ["/path/suffix", { "0": undefined }],
      ["/path//suffix", { "0": "" }],
      ["/path/a/b/suffix", { "0": "a/b" }],
      ["/path/suffix/suffix/", { "0": "suffix" }],
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
    regex: /^\/a(?:\/(?<_0>[\s\S]*))?\/b(?:\.json)?\/?$/,
    match: [
      ["/a/b", { "0": undefined }],
      ["/a/b.json/", { "0": undefined }],
      ["/a/x/b.json", { "0": "x" }],
      ["/a/b/b", { "0": "b" }],
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
    regex: /^\/path(?:\/(?<rest>[\s\S]+))??\/suffix\/?$/,
    match: [
      ["/path/suffix", { rest: undefined }],
      ["/path/a/b/suffix", { rest: "a/b" }],
      ["/path///suffix", { rest: "/" }],
    ],
    noMatch: ["/path", "/path/a", "/pathsuffix", "/path//suffix"],
  },
  "/path/:rest+/meta{.json}?": {
    regex: /^\/path\/(?<rest>[\s\S]+)\/meta(?:\.json)?\/?$/,
    match: [
      ["/path/a/meta", { rest: "a" }],
      ["/path/a/b/meta.json/", { rest: "a/b" }],
    ],
    noMatch: ["/path/meta", "/path//meta", "/path/a/metax", "/path/secret"],
  },
  // A param after a `**` takes one segment (a `*` there is a second
  // catch-all, see TWO_CATCH_ALL_ROUTES).
  "/**/:name.png": {
    regex: /^(?:\/(?<_0>[\s\S]*))?\/(?<name>[^/]+?)\.png\/?$/,
    match: [
      ["/x.png", { "0": undefined, name: "x" }],
      ["/a/b/x.png", { "0": "a/b", name: "x" }],
      ["/a/x.png/", { "0": "a", name: "x" }],
    ],
    noMatch: ["/", "/.png", "/x.jpg", "/x.png/y"],
  },
  "/:id/**/:file(\\w+).json": {
    regex: /^\/(?<id>[^/]+)(?:\/(?<_0>[\s\S]*))?\/(?<file>\w+)\.json\/?$/,
    match: [
      ["/1/c.json", { id: "1", "0": undefined, file: "c" }],
      ["/1/a/b/c.json", { id: "1", "0": "a/b", file: "c" }],
    ],
    noMatch: ["/c.json", "//c.json", "/1/c-d.json", "/1/a/.json"],
  },
  // `**<rest>` reads like `*<rest>`, as in URLPattern: one capture.
  "/**.md": {
    regex: /^\/(?<_0>[\s\S]*)\.md\/?$/,
    match: [
      ["/readme.md", { "0": "readme" }],
      ["/docs/guide/intro.md/", { "0": "docs/guide/intro" }],
      ["/.md", { "0": "" }],
    ],
    noMatch: ["/", "/a.mdx", "/a.md/b"],
  },
  "/blog/**.json": {
    regex: /^\/blog\/(?<_0>[\s\S]*)\.json\/?$/,
    match: [
      ["/blog/post.json", { "0": "post" }],
      ["/blog/a/post.json", { "0": "a/post" }],
    ],
    noMatch: ["/blog", "/post.json", "/blogpost.json"],
  },
  // A `:x` after `**` needs a value too (`//` is no match).
  "/**/:file": {
    regex: /^(?:\/(?<_0>[\s\S]*))?\/(?<file>[^/]+)\/?$/,
    match: [
      ["/a", { "0": undefined, file: "a" }],
      ["/a/b/c", { "0": "a/b", file: "c" }],
      ["/a/b/", { "0": "a", file: "b" }],
      ["//a", { "0": "", file: "a" }],
    ],
    noMatch: ["/", "//", "/a//"],
  },
  // A lone optional segment after `**`: it is lazy, so `page` takes the last
  // segment where it has a value, and the `**` takes the rest (an empty last
  // segment included: `/a/x//` gives `0: "x/"`).
  "/a/**/:page?": {
    regex: /^\/a(?:\/(?<_0>[\s\S]*?))??(?:\/(?<page>[^/]+))?\/?$/,
    match: [
      ["/a", { "0": undefined, page: undefined }],
      ["/a/", { "0": undefined, page: undefined }],
      ["/a/x", { "0": undefined, page: "x" }],
      ["/a/x/y", { "0": "x", page: "y" }],
      ["/a/x/y/", { "0": "x", page: "y" }],
      ["/a//", { "0": "", page: undefined }],
      ["/a/x//", { "0": "x/", page: undefined }],
    ],
    noMatch: ["/ab", "/b"],
  },
  // Other optionals right after a `**`: it is lazy, so they take the end
  // of the path where they match, and `/?$` is exact (the `**` absorbs a
  // stripped slash).
  "/a/**/:n(\\d+)?": {
    regex: /^\/a(?:\/(?<_0>[\s\S]*?))??(?:\/(?<n>\d+))?\/?$/,
    match: [
      ["/a", { "0": undefined, n: undefined }],
      ["/a/1", { "0": undefined, n: "1" }],
      ["/a/b/1", { "0": "b", n: "1" }],
      ["/a/b/c", { "0": "b/c", n: undefined }],
      ["/a/b/", { "0": "b", n: undefined }],
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
  // Literal text is percent-encoded like URLPattern (`%` kept); a constraint
  // is regex, kept as written.
  "/café/:id-é": {
    regex: /^\/caf%C3%A9\/(?<id>[^/]+?)-%C3%A9\/?$/,
    match: [["/caf%C3%A9/1-%C3%A9", { id: "1" }]],
    noMatch: ["/café/1-é", "/caf%c3%a9/1-%C3%A9", "/caf%C3%A9/1-é"],
  },
  "/a\\{b\\} \\?^/:x(é)": {
    regex: /^\/a%7Bb%7D%20%3F%5E\/(?<x>é)\/?$/,
    match: [["/a%7Bb%7D%20%3F%5E/é", { x: "é" }]],
    noMatch: ["/a{b} ?^/é", "/a%7Bb%7D%20%3F%5E/%C3%A9"],
  },
  "/100%/caf{é}?": {
    regex: /^\/100%\/caf(?:%C3%A9)?\/?$/,
    match: [["/100%/caf"], ["/100%/caf%C3%A9"]],
    noMatch: ["/100%25/caf", "/100%/café"],
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

// Fixtures whose regex holds a capture with a look-ahead (a constraint
// extended by an optional group in its own segment, see `mergeCapture` in
// src/regexp.ts; a `:name` there is lazy and needs none, and a group right
// after a `*` falls back to alternation). RE2-family engines reject them and
// `regExpToRoute` can't read them back.
export const LOOKAHEAD_ROUTES: ReadonlySet<string> = new Set([]);

// Routes whose generated regex reuses the same named capture group across
// alternation branches (e.g. `(?<id>…)|(?<id>…)`). Such output is legal in JS
// (per the TC39 duplicate-named-groups proposal) and in Perl, but PCRE2-family
// engines reject it unless PCRE2_DUPNAMES is set.
//
// A trailing single optional group is normally compiled inline as `(?:...)?`
// (see inlineOptionalGroup in src/regexp.ts), which avoids duplicate names. But
// an optional part after a greedy capture (a `*`) cannot be inlined safely
// (the capture would swallow the optional literal), so it falls back to
// alternation and reuses the capture name across branches. These routes exercise
// that fallback and are asserted to be rejected by strict PCRE2 engines.
export const PCRE2_DUPLICATE_NAME_ROUTES: ReadonlySet<string> = new Set([
  "/media/*{.webp}?",
  "/files/*{.:ext}?/raw",
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
  // A catch-all that needs a value (`**:r`, `:x+`, `:x*`) right before an
  // optional segment: where that segment is absent the catch-all takes a
  // single one, and telling a trailing slash from it needs the look-behind.
  "/**:r/:y?",
  "/a/**:r/:y?",
  "/:x+/:y?",
  "/a/:x+/:y?",
  "/:x*/:y?",
  "/a/:x*/:y?",
  "/:p/:r*/:y(\\d+)?",
  // Likewise a `*` ending its segment (its `**` in the tree takes none to
  // more segments, the segment's text before it is required).
  "/a/x-*/:y?",
  // A segment that can be empty right before a lazy catch-all: a plain `/?$`
  // would let the stripped slash end it.
  "/a//**/:n(\\d+)?",
  // An inline group after a catch-all and an optional segment (or an empty
  // one) that can be empty.
  "/a/**/:y?{/b}?",
  "/a/**/{/b}?",
  "/a/:r*/:y?{/b}?",
  // An optional group after a catch-all's segment (`/**/{b}?`, inlined), or
  // after an optional `{/**}?`.
  "/**/{b}?",
  "/a/**/{b}?",
  "/**/{(\\d+)}?",
  "/a/**/{(\\d+)}?",
  "/**:r/{b}?",
  "/**:r/{(\\d+)}?",
  "/:x+/{b}?",
  "/a/:x+/{b}?",
  "/:x+/{(\\d+)}?",
  "/a/:x+/{(\\d+)}?",
  "/{/**}?/:y?",
  "/a/{/**}?/:y?",
  "/{/**}?/{b}?",
  "/a/{/**}?/{b}?",
  "/{/**}?/{(\\d+)}?",
  "/a/{/**}?/{(\\d+)}?",
]);

// Sweep patterns whose regex holds a capture with a look-ahead (see
// LOOKAHEAD_ROUTES). Pinned like the set above.
// (A `:name` extended by a group in its segment is lazy and needs none, and a
// group right after a `*` falls back to alternation.)
export const SWEEP_LOOKAHEAD_PATTERNS: ReadonlySet<string> = new Set([]);

// Sweep patterns whose regex reuses a capture group name across alternation
// branches (see PCRE2_DUPLICATE_NAME_ROUTES). Pinned like the set above.
export const SWEEP_DUPLICATE_NAME_PATTERNS: ReadonlySet<string> = new Set([
  // A group whose segment then folds in a trailing optional (`:y?`, `**`):
  // the two expansions don't line up segment by segment.
  "/{b}?/**",
  "/{b}?/:y?",
  "/a/{b}?/**",
  "/a/{b}?/:y?",
  "/:x{.:e}?/**",
  "/:x{.:e}?/:y?",
  "/a/:x{.:e}?/**",
  "/a/:x{.:e}?/:y?",
  // An empty segment followed only by optional ones expands like the router.
  "/{en}?/:page?",
  "/docs/{v2}?/:page?",
  // Two groups.
  "/:x{.:e}?/b{.json}?",
  "/a/:x{.:e}?/b{.json}?",
  // A mid-segment optional group after a greedy capture, also where both can
  // end the same way (`-x` / `-x-x`). (An optional param, `*-:x?`, compiles
  // in place like the tree.)
  "/media/*{.webp}?",
  "/files/*{.:ext}?/raw",
  "/*-x{-x}?",
  // A `*` before optional segments only, where the segment before it can be
  // empty: each route ends in its own way.
  "/:x?/*/:y?",
  "/a//*/:y?",
  "/a/:x(\\d*)/*/:y?",
  // A group right after a catch-all (static segments after a `*` inline).
  "/a/**{/b/:c?}?",
  "/a/**{.png}?",
  // An optional unnamed group before a trailing optional or another optional
  // group: the expansions don't line up segment by segment.
  "/{(\\d+)}?/:y?",
  "/a/{(\\d+)}?/:y?",
  "/{(\\d+)}?/**",
  "/a/{(\\d+)}?/**",
  "/{(\\d+)}?/{(\\d+)}?",
  "/a/{(\\d+)}?/{(\\d+)}?",
  "/{b}?/{(\\d+)}?",
  "/a/{b}?/{(\\d+)}?",
  "/a{/(\\d+)}?/**",
  // An optional group after a trailing optional or `**:r`.
  "/*/{(\\d+)}?",
  "/a/*/{(\\d+)}?",
  "/a/**:r/{b}?",
  "/a/**:r/{(\\d+)}?",
  // An optional `{/**}?` before a trailing optional.
  "/{/**}?/:y?",
  "/a/{/**}?/:y?",
  "/{/**}?/{(\\d+)}?",
  "/a/{/**}?/{(\\d+)}?",
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
    // ... after a `**` (`**-:e?` is `**` then `*-:e?`, see `splitRoute`).
    "**-:e?",
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
    // A `*` before optional segments only takes none after a trailing slash
    // where they are absent (`/a/*/:y?` on `/a/`), also inside a group, and
    // where the segment before it can be empty.
    "/a/*/:y?",
    "/a{/*/:y?}?",
    "/a{/b/*/:y?}?",
    "/:x?/*/:y?",
    "/a//*/:y?",
    "/a/:x(\\d*)/*/:y?",
    // A `*` inside a segment, with optional segments after it: lazy or
    // greedy like a `**` (with text after it, its segment ranks as a regex
    // param: `*.png`)
    "/a/x-*/:y?",
    "/*.png/:y?",
    "/a-*.png/b",
    "/a/*-:x/:y?",
    "/a/x-*{/b}?",
    // A segment that can be empty right before a lazy catch-all: the stripped
    // trailing slash must not end it (`/a/` is not `/a//` for `/a/:p/**/…`).
    "/a/:p/**/:n(\\d+)?",
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
    // An unnamed optional segment mid-route (a `*` is optional alone only at
    // the end).
    "/a{/*}?/b",
    "/a{/*}?/:q",
    "/a/*{/*}?/b",
    "/{/*}?/b",
    "/a{/(\\d+)}?/b",
    "/a{/(\\d+)}?/:q",
    "/a/:x{/(\\d+)}?/b",
    "/a/**.:ext?",
    // A left-out optional group uses up its unnamed numbers.
    "/a{/**}?/*.png",
    "/{(\\d+)}?/a/**",
    "/{/**}?/(\\d+)",
    "/a{/(\\d+)}?/**",
    "/x{(\\d+)}?/*",
    "/a{/**}?/*-:x?",
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
  // Unnamed captures next to optional groups: numbered over the whole
  // pattern, so every route a pattern registers keys a capture alike (and
  // both routes of an inline group line up).
  for (const u of ["*", "**", "**:r", ":x+", ":x?", "(\\d+)", "{(\\d+)}?", "{/**}?", "{b}?"]) {
    for (const t of ["*", "**", ":y?", "*.png", "(\\d+)", "{b}?", "{(\\d+)}?"]) {
      patterns.add(`/${u}/${t}`).add(`/a/${u}/${t}`);
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
  // A `*` is one too, inside a segment as well
  "/*/x/*",
  "/*/**",
  "/**/*",
  "/***",
  "/*/:p+",
  "/a/:x*/*",
  "/file-*-*.png",
  "/**/*.png",
  "/*.png/*",
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
  // U+FFFD-U+FFFF are reserved for internal placeholders (escapes, and
  // U+FFFF for the next one): written in a route, they would read as syntax
  // (`\uFFFD0` as an escaped `:`).
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
