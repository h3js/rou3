// Shared fixtures for routeToRegExp tests (interpreter + cross-engine PCRE checks).

export interface RegExpCase {
  regex: RegExp;
  match: ReadonlyArray<readonly [string, Record<string, string>?]>;
}

export const regexpCases: Record<string, RegExpCase> = {
  "/path": { regex: /^\/path\/?$/, match: [["/path"], ["/path/"]] },
  "/path/:param": {
    regex: /^\/path\/(?<param>[^/]+)\/?$/,
    match: [
      ["/path/value", { param: "value" }],
      ["/path/value/", { param: "value" }],
    ],
  },
  "/path/get-:file.:ext": {
    regex: /^\/path\/get-(?<file>[^/]+)\.(?<ext>[^/]+)\/?$/,
    match: [["/path/get-file.txt", { file: "file", ext: "txt" }]],
  },
  "/path/:param1/:param2": {
    regex: /^\/path\/(?<param1>[^/]+)\/(?<param2>[^/]+)\/?$/,
    match: [["/path/value1/value2", { param1: "value1", param2: "value2" }]],
  },
  "/path/*/foo": {
    regex: /^\/path\/(?<_0>[^/]*)\/foo\/?$/,
    match: [
      ["/path/anything/foo", { "0": "anything" }],
      ["/path//foo", { "0": "" }],
      ["/path//foo/", { "0": "" }],
    ],
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
    regex: /^\/path\/?(?<_>.*)\/?$/,
    match: [
      ["/path/", { _: "" }],
      ["/path", { _: "" }],
      ["/path/anything/more", { _: "anything/more" }],
    ],
  },
  "/base/**:path": {
    regex: /^\/base\/?(?<path>.+)\/?$/,
    match: [["/base/anything/more", { path: "anything/more" }]],
  },
  "/static%3Apath/\\*/\\*\\*": {
    regex: /^\/static%3Apath\/\*\/\*\*\/?$/,
    match: [["/static%3Apath/*/**"]],
  },
  "/**": {
    regex: /^\/?(?<_>.*)\/?$/,
    match: [
      ["/", { _: "" }],
      ["/anything", { _: "anything" }],
      ["/any/deep/path", { _: "any/deep/path" }],
    ],
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
    match: [["/path/123", { id: "123" }], ["/path"]],
  },
  "/path/:id(\\d+)?": {
    regex: /^\/path(?:\/(?<id>\d+))?\/?$/,
    match: [["/path/123", { id: "123" }], ["/path"]],
  },
  "/path/:rest+": {
    regex: /^\/path\/(?<rest>.+)\/?$/,
    match: [
      ["/path/a/b", { rest: "a/b" }],
      ["/path/a", { rest: "a" }],
    ],
  },
  "/path/:rest*": {
    regex: /^\/path(?:\/(?<rest>.*))?\/?$/,
    match: [["/path/a/b", { rest: "a/b" }], ["/path"]],
  },
  "/path/(\\d+)": {
    regex: /^\/path\/(?<_0>\d+)\/?$/,
    match: [["/path/123", { "0": "123" }]],
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
    match: [["/path/123", { id: "123" }], ["/path"]],
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
      ["/blog/123", { id: "123" }],
      ["/blog/123-my-post", { id: "123", title: "my-post" }],
    ],
  },
  "/foo{/bar}?": {
    regex: /^\/foo(?:\/bar)?\/?$/,
    match: [["/foo"], ["/foo/bar"]],
  },
  // Mid-segment optional after a greedy open-ended capture (`*` -> `[^/]*`).
  // Inlining as `(?<_0>[^/]*)(?:\.webp)?` would let the greedy capture swallow
  // `.webp` (capturing `photo.webp` instead of `photo`), so this must fall back
  // to alternation — which anchors the literal outside the capture and keeps
  // `_0` = `photo`. The fallback reuses the `_0` named group across branches
  // (see PCRE2_DUPLICATE_NAME_ROUTES).
  "/media/*{.webp}?": {
    regex: /^(?:\/media\/(?<_0>[^/]*)\.webp\/?|\/media\/(?<_0>[^/]*)\/?)$/,
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
export const PCRE2_DUPLICATE_NAME_ROUTES: ReadonlySet<string> = new Set(["/media/*{.webp}?"]);
