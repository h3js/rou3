// Shared fixtures for routeToRegExp tests (interpreter + cross-engine PCRE checks).

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
    regex: /^\/path\/?$/,
    match: [["/path"], ["/path/"]],
    noMatch: ["/path//", "/path///", "/pathx"],
  },
  "/path/:param": {
    regex: /^\/path\/(?:(?<param>[^/]+)\/?|\/)$/,
    match: [
      ["/path/value", { param: "value" }],
      ["/path/value/", { param: "value" }],
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
    regex: /^\/path(?:\/(?<_>(?:.*[^/])?\/*?))?\/?$/,
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
    ],
    noMatch: ["/pathfoo", "/pathfoo/bar"],
  },
  "/path/**/suffix": {
    regex: /^\/path(?:\/(?<_>(?:.*[^/])?\/*?))?\/?$/,
    match: [
      ["/path/anything/more", { _: "anything/more" }],
      ["/path/suffix", { _: "suffix" }],
    ],
  },
  // A trailing group after a terminal `**` adds nothing, so it must not be
  // inlined as an empty `(?:)?`: that hides the catch-all from the ending
  // analysis, `.*` stays greedy and swallows the stripped trailing slash
  // (`_: "b/"` on `/a/b/`, where the router reports `"b"`).
  "/a/**/b{.json}?": {
    regex: /^\/a(?:\/(?<_>(?:.*[^/])?\/*?))?\/?$/,
    match: [
      ["/a", { _: undefined }, { _: "" }],
      ["/a/", { _: "" }],
      ["/a/b", { _: "b" }],
      ["/a/b/", { _: "b" }],
      ["/a/b//", { _: "b/" }],
      ["/a/b.json/", { _: "b.json" }],
      ["/a/x/y/", { _: "x/y" }],
    ],
    noMatch: ["/ab", "/ab/b"],
  },
  "/base/**:path": {
    regex: /^\/base\/(?:\/|(?<path>(?:.*[^/]|\/)\/*?)\/?)$/,
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
    ],
    noMatch: ["/base", "/base/", "/basefoo", "/basefoo/bar"],
  },
  "/base/**:path/suffix": {
    regex: /^\/base\/(?:\/|(?<path>(?:.*[^/]|\/)\/*?)\/?)$/,
    match: [["/base/anything/more", { path: "anything/more" }]],
  },
  "/static%3Apath/\\*/\\*\\*": {
    regex: /^\/static%3Apath\/\*\/\*\*\/?$/,
    match: [["/static%3Apath/*/**"]],
  },
  "/**": {
    regex: /^\/?(?<_>(?:.*[^/])?\/*?)\/?$/,
    match: [
      ["/", { _: "" }],
      ["//", { _: "" }],
      ["/a/", { _: "a" }],
      ["/a//", { _: "a/" }],
      ["/anything", { _: "anything" }],
      ["/any/deep/path", { _: "any/deep/path" }],
    ],
  },
  "/**:path": {
    regex: /^\/(?:\/|(?<path>(?:.*[^/]|\/)\/*?)\/?)$/,
    match: [
      ["/anything", { path: "anything" }],
      ["/any/deep/path", { path: "any/deep/path" }],
    ],
    noMatch: ["/"],
  },
  "/:path+": {
    regex: /^\/(?:\/|(?<path>(?:.*[^/]|\/)\/*?)\/?)$/,
    match: [["/a/b", { path: "a/b" }]],
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
    regex: /^\/path\/(?:\/|(?<rest>(?:.*[^/]|\/)\/*?)\/?)$/,
    match: [
      ["/path/a/b", { rest: "a/b" }],
      ["/path/a", { rest: "a" }],
    ],
  },
  // A `+`/`*` modifier before the last segment becomes a terminal `**:name` in
  // the tree; the segments after it are dropped (`/path/:rest+/suffix` is
  // `/path/**:rest`), and `*` additionally keeps the route without it.
  "/path/:rest+/suffix": {
    regex: /^\/path\/(?:\/|(?<rest>(?:.*[^/]|\/)\/*?)\/?)$/,
    match: [
      ["/path/a", { rest: "a" }],
      ["/path/a/b", { rest: "a/b" }],
    ],
    noMatch: ["/path", "/path/"],
  },
  "/path/:rest*": {
    regex: /^\/path(?:\/(?<rest>(?:.*[^/])?\/*?))??\/?$/,
    match: [
      ["/path/a/b", { rest: "a/b" }],
      ["/path/a/b/", { rest: "a/b" }],
      ["/path/a//", { rest: "a/" }],
      ["/path", { rest: undefined }],
      ["/path/", { rest: undefined }],
    ],
  },
  "/path/(\\d+)": {
    regex: /^\/path\/(?<_0>\d+)\/?$/,
    match: [["/path/123", { "0": "123" }]],
  },
  // A trailing unnamed `(.*)` constraint must reverse to `(.*)`, not `:_0+`.
  "/path/(.*)": {
    regex: /^\/path\/(?:\/|(?<_0>(?:.*[^/]|\/)\/*?)\/?)$/,
    match: [["/path/a", { "0": "a" }]],
  },
  // A mid-route repeat stays terminal even when a trailing group follows it.
  "/path/:rest+/meta{.json}?": {
    regex: /^\/path\/(?:\/|(?<rest>(?:.*[^/]|\/)\/*?)\/?)$/,
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
    regex: /^\/api\/(?:\/|(?<__rou3_esc_test_hid>(?:.*[^/]|\/)\/*?)\/?)$/,
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
  // must not match, but `/path//` (`id: ""`) and `/path//tab` must. Without
  // look-around that needs `id` in two alternation branches (see
  // LOOKBEHIND_ROUTES).
  "/path/:id/:tab?": {
    regex: /^\/path\/(?<id>[^/]*)(?:\/(?<tab>[^/]*))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path/1", { id: "1", tab: undefined }],
      ["/path/1/", { id: "1", tab: undefined }],
      ["/path/1/t", { id: "1", tab: "t" }],
      ["/path//", { id: "", tab: undefined }],
      ["/path//t", { id: "", tab: "t" }],
    ],
    noMatch: ["/path", "/path/", "/path/1/t//"],
  },
  // An optional group spanning segments whose last one can be empty: `/path/sub/`
  // must not match (it strips to `/path/sub`, which is neither branch).
  "/path{/sub/:id}?": {
    regex: /^\/path(?:\/sub\/(?<id>[^/]*))?(?:(?<=\/)\/|(?<!\/)\/?)$/,
    match: [
      ["/path", { id: undefined }],
      ["/path/", { id: undefined }],
      ["/path/sub/1", { id: "1" }],
      ["/path/sub//", { id: "" }],
    ],
    noMatch: ["/path/sub", "/path/sub/"],
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
    regex: /^(?:\/?(?<path>(?:.*[^/])?\/*?))??\/?$/,
    match: [
      ["/", { path: undefined }],
      ["//", { path: "" }],
      ["/a", { path: "a" }],
      ["/a/b/", { path: "a/b" }],
      ["/a/b//", { path: "a/b/" }],
    ],
  },
  // Trailing optionals nested in an inline group get the same endings as
  // top-level ones: a catch-all never keeps the stripped trailing slash, an
  // inner `*` / `:x?` / `:x*` stays unset where the router takes the route
  // without it, and no look-behind is needed.
  "/path{/sub/**}?": {
    regex: /^\/path(?:\/sub(?:\/(?<_>(?:.*[^/])?\/*?))?)?\/?$/,
    match: [
      ["/path", { _: undefined }],
      ["/path/", { _: undefined }],
      ["/path/sub/", { _: "" }],
      ["/path/sub//", { _: "" }],
      ["/path/sub/a", { _: "a" }],
      ["/path/sub/a/", { _: "a" }],
      ["/path/sub/a//", { _: "a/" }],
      ["/path/sub/a/b", { _: "a/b" }],
    ],
    noMatch: ["/path//", "/path/subx", "/path/other"],
  },
  "/path{/sub/:rest*}?": {
    regex: /^\/path(?:\/sub(?:\/(?<rest>(?:.*[^/])?\/*?))??)?\/?$/,
    match: [
      ["/path", { rest: undefined }],
      ["/path/sub", { rest: undefined }],
      ["/path/sub/", { rest: undefined }],
      ["/path/sub//", { rest: "" }],
      ["/path/sub/a/", { rest: "a" }],
      ["/path/sub/a/b//", { rest: "a/b/" }],
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
    regex: /^\/path(?:\/(?<rest>(?:.*[^/])?\/*?))??\/?$/,
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
// pinned in SWEEP_LOOKBEHIND_PATTERNS. The suffix remains where the path must
// not stop right after a separator but the capture that decides it has to
// stay a single named group: a required empty-capable param followed by
// optional segments, a constraint that can match empty, an empty segment
// before a trailing wildcard (`/a//*`), several empty-capable optionals in a
// row, or an optional group spanning segments whose last one can be empty.
// It also stays when a match can end in `/` (a constraint like `[^.]+`), so
// that the stripped trailing slash never lands in the capture.
export const LOOKBEHIND_ROUTES: ReadonlySet<string> = new Set([
  "/path/:id/:tab?",
  "/path/:id(\\d*)",
  "/path{/sub/:id}?",
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
  // A required empty-capable segment followed by optional ones.
  "/:x/*",
  "/:x/**",
  "/:x/:y?",
  "/*/*",
  "/*/**",
  "/*/:y?",
  "/a/:x/*",
  "/a/:x/**",
  "/a/:x/:y?",
  "/a/*/*",
  "/a/*/**",
  "/a/*/:y?",
  "/path/:id/:tab?",
  // Several empty-capable optionals in a row.
  "/:x?/*",
  "/:x?/**",
  "/:x?/:y?",
  "/a/:x?/*",
  "/a/:x?/**",
  "/a/:x?/:y?",
  "/a{/*/:y?}?",
  "/a{/b/*/:y?}?",
  // An empty segment before a trailing wildcard (`{b}?` leaves one when absent).
  "//*",
  "//**",
  "/a//*",
  "/a//**",
  "/{b}?/*",
  "/{b}?/**",
  "/a/{b}?/*",
  "/a/{b}?/**",
  // A constraint that can match empty.
  "/path/:id(\\d*)",
  // An optional group spanning segments whose last one can be empty.
  "/a{/b/:x}?",
  "/a{/b/:y}?",
  "/a{/b/:y+}?",
  "/a{/b/**:r}?",
  "/a{/b/:x/*}?",
  "/a{/b/:x/**}?",
  "/path{/sub/:id}?",
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
  // A mid-route `:x*` expands, and so does the trailing group after it.
  "/:x*/b{.json}?",
  "/a/:x*/b{.json}?",
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
 * fixtures above.
 */
export function sweepPatterns(): string[] {
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
  return [...paths];
}
