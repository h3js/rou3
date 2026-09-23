// Shared fixtures for routeToRegExp tests (interpreter + cross-engine PCRE checks).

export interface RegExpCase {
  regex: RegExp;
  match: ReadonlyArray<readonly [string, Record<string, string>?]>;
  /** Paths neither the router nor the regex may match. */
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
    regex: /^\/path(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path"], ["/path/"]],
    noMatch: ["/path//", "/path///", "/pathx"],
  },
  "/path/:param": {
    regex: /^\/path\/(?<param>[^/]*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path/value", { param: "value" }],
      ["/path/value/", { param: "value" }],
      ["/path//", { param: "" }],
    ],
    noMatch: ["/path", "/path/", "/path///", "/path/value//"],
  },
  // A trailing `*` is optional in the tree, so `/path` matches too (#200).
  "/path/*": {
    regex: /^\/path(?:\/(?<_0>[^/]*))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path"], ["/path/"], ["/path/x", { "0": "x" }], ["/path/x/", { "0": "x" }]],
    noMatch: ["/pathx", "/path/x/y", "/path/x//"],
  },
  "/path/get-:file.:ext": {
    regex: /^\/path\/get-(?<file>[^/]+)\.(?<ext>[^/]+)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/get-file.txt", { file: "file", ext: "txt" }]],
  },
  "/path/:param1/:param2": {
    regex: /^\/path\/(?<param1>[^/]*)\/(?<param2>[^/]*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path/value1/value2", { param1: "value1", param2: "value2" }],
      // A whole-segment `:name` takes an empty segment in the tree (#200).
      ["/path//value2", { param1: "", param2: "value2" }],
    ],
  },
  "/path/*/foo": {
    regex: /^\/path\/(?<_0>[^/]*)\/foo(?:(?<=\/)\/|(?<!\/)\/?)$/,
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
    regex: /^\/path\/\/sub(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path//sub"], ["/path//sub/"]],
  },
  "/path//:id": {
    regex: /^\/path\/\/(?<id>[^/]*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path//value", { id: "value" }]],
  },
  "/path/*.png": {
    regex: /^\/path\/(?<_0>[^/]*)\.png(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/icon.png", { "0": "icon" }]],
  },
  "/path/file-*-*.png": {
    regex: /^\/path\/file-(?<_0>[^/]*)-(?<_1>[^/]*)\.png(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/file-a-b.png", { "0": "a", "1": "b" }]],
  },
  "/path/**": {
    regex: /^\/path(?:\/(?<_>.*))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      // The whole catch-all group is skipped, so the regex leaves `_` unset
      // while the router reports `""`.
      ["/path"],
      ["/path/"],
      ["/path//"],
      ["/path/anything/more", { _: "anything/more" }],
    ],
    noMatch: ["/pathfoo", "/pathfoo/bar"],
  },
  "/path/**/suffix": {
    regex: /^\/path(?:\/(?<_>.*))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path/anything/more", { _: "anything/more" }],
      ["/path/suffix", { _: "suffix" }],
    ],
  },
  "/base/**:path": {
    regex: /^\/base\/(?<path>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/base/anything/more", { path: "anything/more" }],
      // One or more segments, and a segment may be empty.
      ["/base//", { path: "" }],
    ],
    noMatch: ["/base", "/base/", "/basefoo", "/basefoo/bar"],
  },
  "/base/**:path/suffix": {
    regex: /^\/base\/(?<path>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/base/anything/more", { path: "anything/more" }]],
  },
  "/static%3Apath/\\*/\\*\\*": {
    regex: /^\/static%3Apath\/\*\/\*\*(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/static%3Apath/*/**"]],
  },
  "/**": {
    regex: /^\/?(?<_>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/", { _: "" }],
      ["/anything", { _: "anything" }],
      ["/any/deep/path", { _: "any/deep/path" }],
    ],
  },
  "/**:path": {
    regex: /^\/(?<path>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/anything", { path: "anything" }],
      ["/any/deep/path", { path: "any/deep/path" }],
    ],
    noMatch: ["/"],
  },
  "/:path+": {
    regex: /^\/(?<path>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/a/b", { path: "a/b" }]],
    noMatch: ["/"],
  },
  "/path/:id(\\d+)": {
    regex: /^\/path\/(?<id>\d+)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/123", { id: "123" }]],
  },
  "/path/:ext(png|jpg|gif)": {
    regex: /^\/path\/(?<ext>png|jpg|gif)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/png", { ext: "png" }]],
  },
  "/path/:version(v\\d+)/:resource": {
    regex: /^\/path\/(?<version>v\d+)\/(?<resource>[^/]*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/v2/users", { version: "v2", resource: "users" }]],
  },
  "/path/:id?": {
    regex: /^\/path(?:\/(?<id>[^/]*))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/123", { id: "123" }], ["/path"]],
  },
  "/path/:id(\\d+)?": {
    regex: /^\/path(?:\/(?<id>\d+))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/123", { id: "123" }], ["/path"]],
  },
  "/path/:rest+": {
    regex: /^\/path\/(?<rest>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path/a/b", { rest: "a/b" }],
      ["/path/a", { rest: "a" }],
    ],
  },
  // A `+`/`*` modifier before the last segment becomes a terminal `**:name` in
  // the tree; the segments after it are dropped (`/path/:rest+/suffix` is
  // `/path/**:rest`), and `*` additionally keeps the route without it.
  "/path/:rest+/suffix": {
    regex: /^\/path\/(?<rest>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path/a", { rest: "a" }],
      ["/path/a/b", { rest: "a/b" }],
    ],
    noMatch: ["/path", "/path/"],
  },
  "/path/:rest*": {
    regex: /^\/path(?:\/(?<rest>.*))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/a/b", { rest: "a/b" }], ["/path"]],
  },
  "/path/(\\d+)": {
    regex: /^\/path\/(?<_0>\d+)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/123", { "0": "123" }]],
  },
  // A trailing unnamed `(.*)` constraint must reverse to `(.*)`, not `:_0+`.
  "/path/(.*)": {
    regex: /^\/path\/(?<_0>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/a", { "0": "a" }]],
  },
  // A mid-route repeat stays terminal even when a trailing group follows it.
  "/path/:rest+/meta{.json}?": {
    regex: /^\/path\/(?<rest>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path/a", { rest: "a" }],
      ["/path/a/b", { rest: "a/b" }],
    ],
    noMatch: ["/path"],
  },
  // An empty segment turns trailing, and is dropped, once the optionals after
  // it are absent: `/docs/{v2}?/:page?` also registers `/docs`.
  "/docs/{v2}?/:page?": {
    regex:
      /^(?:\/docs\/v2(?:\/(?<page>[^/]*))?(?:(?<=\/)\/|(?<!\/)\/?)|(?:\/docs\/\/(?<page>[^/]*)(?:(?<=\/)\/|(?<!\/)\/?)|\/docs(?:(?<=\/)\/|(?<!\/)\/?)))$/,
    match: [["/docs"], ["/docs/"], ["/docs/v2"], ["/docs/v2/intro", { page: "intro" }]],
    noMatch: ["/docs/intro"],
  },
  "/path/(png|jpg|gif)": {
    regex: /^\/path\/(?<_0>png|jpg|gif)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/png", { "0": "png" }]],
  },
  "/path/:id(\\d+)+": {
    regex: /^\/path\/(?<id>\d+(?:\/\d+)*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path/123", { id: "123" }],
      ["/path/123/456", { id: "123/456" }],
    ],
  },
  "/path/:id(\\d+)*": {
    regex: /^\/path(?:\/(?<id>\d+(?:\/\d+)*))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/path/123", { id: "123" }], ["/path"]],
  },
  "/book{s}?": {
    regex: /^\/book(?:s)?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/book"], ["/books"]],
  },
  // Constraint bodies are opaque regex: dots inside them (escaped `\.` or a
  // char class) must be preserved verbatim, not blanket-escaped to `\\.`.
  "/blog/:slug(\\d+\\.\\d+)": {
    regex: /^\/blog\/(?<slug>\d+\.\d+)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/blog/1.2", { slug: "1.2" }]],
  },
  "/img/:name([a-z.]+)": {
    regex: /^\/img\/(?<name>[a-z.]+)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/img/a.b.c", { name: "a.b.c" }]],
  },
  "/blog/:id(\\d+){-:title}?": {
    regex: /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/blog/123", { id: "123" }],
      ["/blog/123-my-post", { id: "123", title: "my-post" }],
    ],
  },
  "/foo{/bar}?": {
    regex: /^\/foo(?:\/bar)?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/foo"], ["/foo/bar"]],
  },
  // Param names accept `[\w-]+`, but a capture group name must be an identifier
  // (no `-`, no leading digit) in JS and PCRE alike. Such names are emitted in a
  // reserved, injective escaped form (`_` -> `__`, `-` -> `_h`) and decoded back
  // to the original param name when groups are read.
  "/api/:test-id": {
    regex: /^\/api\/(?<__rou3_esc_test_hid>[^/]*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/api/abc", { "test-id": "abc" }]],
  },
  "/api/:test-id?": {
    regex: /^\/api(?:\/(?<__rou3_esc_test_hid>[^/]*))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/api/abc", { "test-id": "abc" }], ["/api"]],
  },
  "/api/**:test-id": {
    regex: /^\/api\/(?<__rou3_esc_test_hid>.*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/api/a/b", { "test-id": "a/b" }]],
    noMatch: ["/api", "/api/", "/apifoo"],
  },
  "/files/:file-name.json": {
    regex: /^\/files\/(?<__rou3_esc_file_hname>[^/]+)\.json(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/files/readme.json", { "file-name": "readme" }]],
  },
  // `a-b` and `a_b` must not collapse onto one group name.
  "/mix/:a-b.:a_b": {
    regex: /^\/mix\/(?<__rou3_esc_a_hb>[^/]+)\.(?<a_b>[^/]+)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/mix/x.y", { "a-b": "x", a_b: "y" }]],
  },
  // Runs of `-`/`_` must survive: the escape is a prefix code, so `a--b` and
  // `a_-b` stay distinct. A `-` -> `_` sanitize maps `a--b` onto `a_b` (wrong
  // name) and collides `a-_b` with `a_-b` (duplicate group name -> SyntaxError).
  "/run/:a--b.:a_-b": {
    regex:
      /^\/run\/(?<__rou3_esc_a_h_hb>[^/]+)\.(?<__rou3_esc_a___hb>[^/]+)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/run/x.y", { "a--b": "x", "a_-b": "y" }]],
  },
  // Leading digit: also not a valid group name.
  "/api/:0": {
    regex: /^\/api\/(?<__rou3_esc_0>[^/]*)(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [["/api/abc", { "0": "abc" }]],
  },
  // Mid-segment optional after a greedy open-ended capture (`*` -> `[^/]*`).
  // Inlining as `(?<_0>[^/]*)(?:\.webp)?` would let the greedy capture swallow
  // `.webp` (capturing `photo.webp` instead of `photo`), so this must fall back
  // to alternation — which anchors the literal outside the capture and keeps
  // `_0` = `photo`. The fallback reuses the `_0` named group across branches
  // (see PCRE2_DUPLICATE_NAME_ROUTES).
  "/media/*{.webp}?": {
    regex:
      /^(?:\/media\/(?<_0>[^/]*)\.webp(?:(?<=\/)\/|(?<!\/)\/?)|\/media(?:\/(?<_0>[^/]*))?(?:(?<=\/)\/|(?<!\/)\/?))$/,
    match: [
      ["/media/photo.webp", { "0": "photo" }],
      ["/media/photo", { "0": "photo" }],
    ],
  },
};

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
