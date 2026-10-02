import { describe, it, expect } from "vitest";
import { createRouter, formatTree } from "./_utils.ts";
import {
  addRoute,
  createRouter as createEmptyRouter,
  findAllRoutes,
  findRoute,
  removeRoute,
  routeToRegExp,
} from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";
import { getMatchParams, normalizePath } from "../src/_match.ts";
import { _findRanked } from "../src/operations/find-all.ts";
import { format } from "oxfmt";
import { isDeepStrictEqual } from "node:util";
import { DUPLICATE_NAMED_GROUPS, needsDuplicateNames } from "./_regexp-cases.ts";

describe("route matching", () => {
  const router = createRouter([
    "/test",
    "/test/:id",
    "/test/:idYZ/y/z",
    "/test/:idY/y",
    "/test/foo",
    "/test/foo/*",
    "/test/foo/**",
    "/test/foo/bar/qux",
    "/test/foo/baz",
    "/test/fooo",
    "/another/path",
    "/wildcard/**",
    "/static\\:path/\\*/\\*\\*",
    "/**",
  ]);

  const compiledLookup = compileRouter(router);

  it("snapshot", () => {
    expect(formatTree(router.root)).toMatchInlineSnapshot(`
      "<root>
          ├── /test ┈> [GET] /test
          │       ├── /foo ┈> [GET] /test/foo
          │       │       ├── /bar
          │       │       │       ├── /qux ┈> [GET] /test/foo/bar/qux
          │       │       ├── /baz ┈> [GET] /test/foo/baz
          │       │       ├── /** ┈> [GET] /test/foo/* + /test/foo/**
          │       ├── /fooo ┈> [GET] /test/fooo
          │       ├── /* ┈> [GET] /test/:id
          │       │       ├── /y ┈> [GET] /test/:idY/y
          │       │       │       ├── /z ┈> [GET] /test/:idYZ/y/z
          ├── /another
          │       ├── /path ┈> [GET] /another/path
          ├── /wildcard
          │       ├── /** ┈> [GET] /wildcard/**
          ├── /static:path
          │       ├── /*
          │       │       ├── /** ┈> [GET] /static\\:path/\\*/\\*\\*
          ├── /** ┈> [GET] /**"
    `);
  });

  it("snapshot (compiled)", async () => {
    await expect(
      (await format("snapshot.mjs", compiledLookup.toString())).code,
    ).toMatchFileSnapshot(".snapshot/compiled-jit.mjs");

    await expect(
      (await format("snapshot.mjs", compileRouterToString(router, "findRoute"))).code,
    ).toMatchFileSnapshot(".snapshot/compiled-aot.mjs");
  });

  it("snapshot (compiled - empty)", async () => {
    await expect(
      (await format("snapshot.mjs", compileRouterToString(createRouter([]), "findRoute"))).code,
    ).toMatchFileSnapshot(".snapshot/compiled-empty.mjs");
  });

  const lookups = [
    {
      name: "findRoute",
      match: (method: string, path: string) => findRoute(router, method, path),
    },
    {
      name: "compiledLookup",
      match: (method: string, path: string) => compiledLookup(method, path),
    },
  ];

  for (const { name, match } of lookups) {
    it(`match with ${name}`, () => {
      // Static
      expect(match("GET", "/test")).toMatchObject({
        data: { path: "/test" },
      });
      expect(match("GET", "/test/foo")).toMatchObject({
        data: { path: "/test/foo" },
      });
      expect(match("GET", "/test/fooo")).toMatchObject({
        data: { path: "/test/fooo" },
      });
      expect(match("GET", "/another/path")).toMatchObject({
        data: { path: "/another/path" },
      });
      // Param
      expect(match("GET", "/test/123")).toMatchObject({
        data: { path: "/test/:id" },
        params: { id: "123" },
      });
      expect(match("GET", "/test/123/y")).toMatchObject({
        data: { path: "/test/:idY/y" },
        params: { idY: "123" },
      });
      expect(match("GET", "/test/123/y/z")).toMatchObject({
        data: { path: "/test/:idYZ/y/z" },
        params: { idYZ: "123" },
      });
      expect(match("GET", "/test/foo/123")).toMatchObject({
        data: { path: "/test/foo/*" },
        params: { "0": "123" },
      });
      // Wildcard (a `*` takes several segments too, and outweighs `**`)
      expect(match("GET", "/test/foo/123/456")).toMatchObject({
        data: { path: "/test/foo/*" },
        params: { "0": "123/456" },
      });
      // (`/test/foo/` is `/test/foo`'s: the static route comes first)
      expect(match("GET", "/test/foo/")).toEqual({ data: { path: "/test/foo" } });
      expect(match("GET", "/wildcard/foo")).toMatchObject({
        data: { path: "/wildcard/**" },
        params: { "0": "foo" },
      });
      expect(match("GET", "/wildcard/foo/bar")).toMatchObject({
        data: { path: "/wildcard/**" },
        params: { "0": "foo/bar", _: "foo/bar" },
      });
      // Over zero segments the `**` is unset, as in URLPattern
      expect(match("GET", "/wildcard")).toEqual({
        data: { path: "/wildcard/**" },
        params: {},
      });
      // Root wildcard
      expect(match("GET", "/anything")).toMatchObject({
        data: { path: "/**" },
        params: { "0": "anything" },
      });
      expect(match("GET", "/any/deep/path")).toMatchObject({
        data: { path: "/**" },
        params: { "0": "any/deep/path" },
      });
      // Escaped characters
      expect(match("GET", "/static:path/*/**")).toMatchObject({
        data: { path: "/static\\:path/\\*/\\*\\*" },
      });
    });
  }

  it("remove works", () => {
    removeRoute(router, "GET", "/test");
    removeRoute(router, "GET", "/test/:id");
    removeRoute(router, "GET", "/test/foo/*");
    removeRoute(router, "GET", "/test/foo/**");
    removeRoute(router, "GET", "/**");
    expect(formatTree(router.root)).toMatchInlineSnapshot(`
      "<root>
          ├── /test
          │       ├── /foo ┈> [GET] /test/foo
          │       │       ├── /bar
          │       │       │       ├── /qux ┈> [GET] /test/foo/bar/qux
          │       │       ├── /baz ┈> [GET] /test/foo/baz
          │       ├── /fooo ┈> [GET] /test/fooo
          │       ├── /*
          │       │       ├── /y ┈> [GET] /test/:idY/y
          │       │       │       ├── /z ┈> [GET] /test/:idYZ/y/z
          ├── /another
          │       ├── /path ┈> [GET] /another/path
          ├── /wildcard
          │       ├── /** ┈> [GET] /wildcard/**
          ├── /static:path
          │       ├── /*
          │       │       ├── /** ┈> [GET] /static\\:path/\\*/\\*\\*"
    `);
    expect(findRoute(router, "GET", "/test")).toBeUndefined();
  });
});

describe("param names that are not valid capture-group names", () => {
  // Every param name is an identifier (`[A-Za-z_]\w*`), but `_N`-shaped ones
  // (the unnamed-capture form of `routeToRegExp`) and the reserved `__rou3_`
  // space are escaped as capture-group names in every regex-compiled position
  // (mixed segments, inline constraints, segment wildcards), and must surface
  // under their original names, distinct from the unnamed captures.
  const router = createRouter(["/n/:_0.txt", "/c/:_1(\\d+)", "/w/:_0.*", "/r/:__rou3_unnamed_0.*"]);

  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`params surface under their original names (${name})`, () => {
      expect(match("GET", "/n/42.txt")).toMatchObject({
        data: { path: "/n/:_0.txt" },
        params: { _0: "42" },
      });
      expect(match("GET", "/c/123")).toMatchObject({
        data: { path: "/c/:_1(\\d+)" },
        params: { _1: "123" },
      });
      expect(match("GET", "/c/abc")).toBeUndefined();
      // Escaped names alongside an unnamed segment wildcard capture.
      expect(match("GET", "/w/logo.dark")?.params).toEqual({ _0: "logo", "0": "dark" });
      expect(match("GET", "/r/logo.dark")?.params).toEqual({
        __rou3_unnamed_0: "logo",
        "0": "dark",
      });
    });
  }
});

describe("a `-` ends a param name", () => {
  // A name is `[A-Za-z_]\w*`, as in URLPattern: `:test-id` is `:test` and a
  // literal `-id` (it was a param `test-id`). `[\w-]+` before that swallowed
  // the `-` of `:year-:month` (`{ "year-": "2024-0" }`).
  const router = createRouter([
    "/blog/:year-:month",
    "/post/:id{-:title}?",
    "/a/:x-",
    "/b/:x-/c",
    "/d/pre-:x\\-suf",
    "/e/:test-id",
    "/f/:x-(\\d+)",
    "/g/:name-suffix",
    "/h/:test\\-id",
    "/users/:user-id/posts/:post-id",
    "/i/:id\\$",
  ]);
  const compiledLookup = compileRouter(router);
  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];
  for (const { name, match } of lookups) {
    it(`splits names at the \`-\` (${name})`, () => {
      expect(match("GET", "/blog/2024-05")?.params).toEqual({ year: "2024", month: "05" });
      expect(match("GET", "/post/1-hi")?.params).toEqual({ id: "1", title: "hi" });
      expect(match("GET", "/post/1")?.params).toEqual({ id: "1" });
      expect(match("GET", "/a/b-")?.params).toEqual({ x: "b" });
      expect(match("GET", "/a/b")).toBeUndefined();
      expect(match("GET", "/b/b-/c")?.params).toEqual({ x: "b" });
      expect(match("GET", "/d/pre-b-suf")?.params).toEqual({ x: "b" });
      // `:test-id` is `:test` then `-id`, with or without escaping the `-`.
      expect(match("GET", "/e/abc")).toBeUndefined();
      expect(match("GET", "/e/abc-id")?.params).toEqual({ test: "abc" });
      expect(match("GET", "/h/abc-id")?.params).toEqual({ test: "abc" });
      expect(match("GET", "/g/foo-suffix")?.params).toEqual({ name: "foo" });
      expect(match("GET", "/users/1-id/posts/2-id")?.params).toEqual({ user: "1", post: "2" });
      expect(match("GET", "/users/1/posts/2")).toBeUndefined();
      // `:x-(\d+)` is `:x`, `-` and an unnamed group, as in URLPattern.
      expect(match("GET", "/f/1-2")?.params).toEqual({ x: "1", "0": "2" });
      // An escaped `$` is a literal (`/i/:id$` throws: `id$` is one name in URLPattern).
      expect(match("GET", "/i/1$")?.params).toEqual({ id: "1" });
    });
  }
});

describe("a `{` / `}` ends a param name", () => {
  // As in URLPattern (and `InferRouteParams`): group expansion joined the text
  // after a `{` / `}` onto the name (`/:a{b}?` gave `{ ab: "x" }` on `/x`).
  const routes = [
    "/o/:a{b}?",
    "/r/:a{b}",
    "/e/:foo{}bar",
    "/c/{:a}b",
    "/w/:a{-x}?y",
    "/x/:a{-:b}?",
    // A regex group after it is an unnamed capture, not the param's
    // constraint (`/{:foo}(.*)` read as `/:foo(.*)`)
    "/g1/{:foo}(.*)",
    "/g2/{:foo}(barbaz)",
    "/g3/{:foo}{(.*)}",
    "/g4/{:foo}?(.*)",
    "/g5/:foo{}(.*)",
    "/g6/:foo{x}?(.*)",
    "/g7/:foo{(x)}?",
    "/g8/{:foo}{}{(\\d+)}",
    "/g9/{pre-:foo}(\\d+)",
  ];
  const router = createRouter(routes);
  const compiledLookup = compileRouter(router);
  // eslint-disable-next-line no-new-func
  const aotLookup = new Function(
    `return ${compileRouterToString(router)}`,
  )() as typeof compiledLookup;
  const lookups = [
    { name: "findRoute", match: (p: string) => findRoute(router, "GET", p) },
    { name: "compiledLookup", match: (p: string) => compiledLookup("GET", p) },
    { name: "aotLookup", match: (p: string) => aotLookup("GET", p) },
  ];
  for (const { name, match } of lookups) {
    it(`reads the text after it as a literal (${name})`, () => {
      expect(match("/o/x")?.params).toEqual({ a: "x" });
      expect(match("/o/xb")?.params).toEqual({ a: "x" });
      expect(match("/r/xb")?.params).toEqual({ a: "x" });
      expect(match("/r/x")).toBeUndefined();
      expect(match("/e/xbar")?.params).toEqual({ foo: "x" });
      expect(match("/e/x")).toBeUndefined();
      expect(match("/c/xb")?.params).toEqual({ a: "x" });
      expect(match("/w/qy")?.params).toEqual({ a: "q" });
      expect(match("/w/q-xy")?.params).toEqual({ a: "q" });
      expect(match("/x/q")?.params).toEqual({ a: "q" });
      expect(match("/x/q-r")?.params).toEqual({ a: "q", b: "r" });
    });

    it(`reads a regex group after it as an unnamed capture (${name})`, () => {
      // As URLPattern: the param is lazy, the group a separate `"0"`
      expect(match("/g1/foobarbaz")?.params).toEqual({ foo: "f", "0": "oobarbaz" });
      expect(match("/g1/f")?.params).toEqual({ foo: "f", "0": "" });
      expect(match("/g2/foobarbaz")?.params).toEqual({ foo: "foo", "0": "barbaz" });
      expect(match("/g2/barbaz")).toBeUndefined();
      expect(match("/g3/foobarbaz")?.params).toEqual({ foo: "f", "0": "oobarbaz" });
      expect(match("/g4/foobarbaz")?.params).toEqual({ foo: "f", "0": "oobarbaz" });
      expect(match("/g4/x")?.params).toEqual({ foo: "x", "0": "" });
      expect(match("/g5/foobarbaz")?.params).toEqual({ foo: "f", "0": "oobarbaz" });
      expect(match("/g6/foobar")?.params).toEqual({ foo: "f", "0": "oobar" });
      expect(match("/g7/abcx")?.params).toEqual({ foo: "abc", "0": "x" });
      expect(match("/g7/x")?.params).toEqual({ foo: "x" });
      expect(match("/g8/a12")?.params).toEqual({ foo: "a", "0": "12" });
      expect(match("/g8/12")?.params).toEqual({ foo: "1", "0": "2" });
      expect(match("/g8/ab")).toBeUndefined();
      expect(match("/g9/pre-a12")?.params).toEqual({ foo: "a", "0": "12" });
    });
  }

  it("removes by the pattern as written", () => {
    const r = createRouter(routes);
    for (const route of routes) removeRoute(r, "GET", route);
    expect(r.root).toEqual(createEmptyRouter().root);
  });
});

describe("a pattern starting with a `{…}` group", () => {
  // Read expansion by expansion: one starting with `/` is absolute, as in
  // URLPattern (`{/:a}?/b` is `/:a/b` or `/b`, never `//b`); any other one,
  // the empty one too, is relative and gets a `/` like a pattern without one
  // (`{a}/b` is `/a/b`, `{/:a}?` also `/`). `[pattern, path, params]`, `null`
  // for no match.
  const cases: [string, string, Record<string, string> | null][] = [
    ["{/:a}?/b", "/b", {}],
    ["{/:a}?/b", "/x/b", { a: "x" }],
    ["{/:a}?/b", "//b", null],
    ["{/:a}?/b", "//x/b", null],
    ["{/:a}/b", "/x/b", { a: "x" }],
    ["{/:a}/b", "//x/b", null],
    ["{/:a}/b", "/b", null],
    ["{/:a}?", "/", {}],
    ["{/:a}?", "/x", { a: "x" }],
    ["{/:a}?", "//x", null],
    ["{/:a}?", "//", null],
    ["{/:a(\\d+)}?/b", "/1/b", { a: "1" }],
    ["{/:a(\\d+)}?/b", "/b", {}],
    ["{/:a(\\d+)}?/b", "/x/b", null],
    ["{/*}?/b", "/b", {}],
    ["{/*}?/b", "/x/b", { "0": "x" }],
    ["{/*}?/b", "//b", { "0": "" }],
    ["{/a/:b}?", "/", {}],
    ["{/a/:b}?", "/a/x", { b: "x" }],
    ["{/a/:b}?", "//a/x", null],
    ["{/:foo}bar", "/bazbar", { foo: "baz" }],
    ["{/a}b", "/ab", {}],
    ["{/}a", "/a", {}],
    ["{}/a", "/a", {}],
    ["{}/a", "//a", null],
    ["{/:a}?/:b?", "/", {}],
    ["{/:a}?/:b?", "/x", { a: "x" }],
    ["{/:a}?/:b?", "/x/y", { a: "x", b: "y" }],
    // Several leading groups: the one left after the first is read the same
    ["{/a}?{/:b}?/c", "/c", {}],
    ["{/a}?{/:b}?/c", "/a/c", {}],
    ["{/a}?{/:b}?/c", "/x/c", { b: "x" }],
    ["{/a}?{/:b}?/c", "/a/x/c", { b: "x" }],
    ["{/a}?{/:b}?/c", "//c", null],
    ["{/a}?{/b}?", "/", {}],
    ["{/a}?{/b}?", "/b", {}],
    ["{/a}?{/b}?", "/a/b", {}],
    ["{/a}?{/b}?", "//b", null],
    // A relative expansion gets a `/` (URLPattern never matches one)
    ["{a}/b", "/a/b", {}],
    ["{:x}/b", "/y/b", { x: "y" }],
    ["{a}?/b", "/a/b", {}],
    ["{a}?/b", "/b", {}],
    ["{a}?/b", "//b", null],
    ["{:x}?/b", "/y/b", { x: "y" }],
    ["{:x}?/b", "/b", {}],
    ["{:x}?/b", "//b", null],
    // Unnamed captures in a relative leading group are counted after its `/`
    ["{(\\d+)}?/*", "/x", { "1": "x" }],
    ["{(\\d+)}?/*", "/5/x", { "0": "5", "1": "x" }],
    ["{*}?/(\\d+)", "/5", { "1": "5" }],
    ["{a}?{/b}?/c", "/a/b/c", {}],
    ["{a}?{/b}?/c", "/b/c", {}],
    ["{a}?{/b}?/c", "/c", {}],
    // An escaped `{` is a literal: the pattern is relative
    ["\\{/a\\}", "/%7B/a%7D", {}],
  ];
  const patterns = [...new Set(cases.map(([pattern]) => pattern))];
  const routers = new Map(patterns.map((pattern) => [pattern, createRouter([pattern])]));
  const lookups = {
    findRoute: (pattern: string, path: string) => findRoute(routers.get(pattern)!, "GET", path),
    compiledLookup: (pattern: string, path: string) =>
      compileRouter(routers.get(pattern)!)("GET", path),
    aotLookup: (pattern: string, path: string) =>
      // eslint-disable-next-line no-new-func
      new Function(`return ${compileRouterToString(routers.get(pattern)!)}`)()("GET", path),
  };
  for (const [name, match] of Object.entries(lookups)) {
    it.each(cases)(`%j on %j (${name})`, (pattern, path, params) => {
      const result = match(pattern, path);
      expect(result ? { ...result.params } : null).toEqual(params);
    });
  }

  it.each(cases)("%j on %j (routeToRegExp)", (pattern, path, params) => {
    // An alternation fallback (`{/a}?{/:b}?/c`) needs duplicate named groups
    if (needsDuplicateNames(pattern)) {
      expect(() => routeToRegExp(pattern)).toThrow(/^rou3: .*duplicate named groups/);
      return;
    }
    expect(routeToRegExp(pattern).test(path)).toBe(params !== null);
  });

  it("removes by the pattern as written", () => {
    const r = createRouter(patterns);
    // The same expansions after a `/` are other routes, left alone
    addRoute(r, "GET", "/b", { path: "/b" });
    addRoute(r, "GET", "/{/:a}?/b", { path: "/{/:a}?/b" });
    for (const pattern of patterns) removeRoute(r, "GET", pattern);
    expect(findRoute(r, "GET", "/b")?.data).toEqual({ path: "/b" });
    expect(findRoute(r, "GET", "//b")?.data).toEqual({ path: "/{/:a}?/b" });
    expect(findRoute(r, "GET", "//x/b")?.data).toEqual({ path: "/{/:a}?/b" });
    expect(findRoute(r, "GET", "/x/b")).toBeUndefined();
    removeRoute(r, "GET", "/b");
    removeRoute(r, "GET", "/{/:a}?/b");
    // `hasSuffix` (set by `{/*}?/b`'s `/*/b`) is never cleared
    expect({ ...r.root, hasSuffix: undefined }).toEqual(createEmptyRouter().root);

    // Two leading groups that differ only before their first `/` share the
    // `/b` node: removing one leaves the other's entry
    const s = createRouter(["{/:a}?/b", "{x/:a}?/b"]);
    removeRoute(s, "GET", "{/:a}?/b/");
    expect(findRoute(s, "GET", "/b")?.data).toEqual({ path: "{x/:a}?/b" });
    expect(findRoute(s, "GET", "/y/b")).toBeUndefined();
    removeRoute(s, "GET", "{x/:a}?/b");
    expect(s.root).toEqual(createEmptyRouter().root);
  });

  it("keeps a leading group's identity apart from the same group after a `/`", () => {
    // Both register `/a/b` (`{a}?/b` as `/a/b` or `/b`, `/{a}?/b` as `/a/b` or `//b`)
    for (const [removed, kept] of [
      ["{a}?/b", "/{a}?/b"],
      ["/{a}?/b", "{a}?/b"],
    ]) {
      const r = createRouter([removed, kept]);
      removeRoute(r, "GET", removed);
      expect(findRoute(r, "GET", "/a/b")?.data, removed).toEqual({ path: kept });
    }
  });

  it("removes nothing for a malformed pattern starting with `{`", () => {
    // `addRoute` rejects these; without a group to expand they have no
    // leading `/` and would split into another route's segments
    for (const pattern of ["{oops/users/:id", "{abc/x", "{(}/x", "{", "{a"]) {
      const r = createRouter(["/", "/x", "/users/:id"]);
      expect(() => addRoute(createEmptyRouter(), "", pattern), pattern).toThrow(/^rou3: /);
      removeRoute(r, "GET", pattern);
      expect(findRoute(r, "GET", "/")?.data, pattern).toEqual({ path: "/" });
      expect(findRoute(r, "GET", "/x")?.data, pattern).toEqual({ path: "/x" });
      expect(findRoute(r, "GET", "/users/1")?.data, pattern).toEqual({ path: "/users/:id" });
    }
  });

  it("rejects text right after a leading `{/…}?` group", () => {
    // Without the group the route would be relative: URLPattern gives that
    // form no meaning (`{/a}?b` matches only `/ab`), so it is reserved
    for (const pattern of [
      "{/a}?b",
      "{/:a}?.png",
      "{/a}?{.json}?",
      "{/a}?{b}?/c",
      "{/a}?\\{x",
      "{/a}?{/b}?c",
    ]) {
      const message = `rou3: text after a leading \`{/...}?\` (${pattern})`;
      expect(() => addRoute(createEmptyRouter(), "", pattern), pattern).toThrow(message);
      // `removeRoute` quotes the pattern as written too, not an expansion
      expect(() => removeRoute(createEmptyRouter(), "", pattern), pattern).toThrow(message);
    }
    // ... and so for a misplaced modifier (it quoted `undefined`)
    for (const pattern of ["/a/pre-:x+", "{/a}?/:x(\\d+)+"]) {
      expect(() => removeRoute(createEmptyRouter(), "", pattern), pattern).toThrow(
        new RegExp(`^rou3: misplaced .* \\(${pattern.replace(/[{}()?+\\]/g, "\\$&")}\\)$`),
      );
    }
    // Followed by `/`, another `{/…}` group or nothing, it is fine
    for (const pattern of ["{/a}?/b", "{/a}?{/b}?", "{/a}?", "{/a}b", "{a}?b"]) {
      expect(() => addRoute(createEmptyRouter(), "", pattern), pattern).not.toThrow();
    }
  });

  it("rejects `{/…}+` / `{/…}*`, quoting the pattern as written", () => {
    expect(() => addRoute(createEmptyRouter(), "", "{/a}+")).toThrow(
      "rou3: unsupported `{}+` ({/a}+)",
    );
    expect(() => addRoute(createEmptyRouter(), "", "{/:a}*/b")).toThrow(
      "rou3: unsupported `{}*` ({/:a}*/b)",
    );
  });
});

describe("params sharing a segment (URLPattern)", () => {
  const router = createRouter([
    "/a/:a-:b",
    "/n/:name.:ext",
    "/c/:a:b",
    "/w/:a-*",
    "/v/*-:a",
    "/f/:name{.:ext}?",
    "/p/pre-:x?",
    "/d/pre-:x(\\d+)?",
    "/m/pre-:x?/end",
    "/s/{pre-:x}?",
    "/e/:a:b?",
    "/g/*-:x?",
    "/h/:a(\\d+)-:x?",
    "/k/:a(\\d+):b?",
    "/i/*:x?",
  ]);
  const compiledLookup = compileRouter(router);
  // eslint-disable-next-line no-new-func
  const aotLookup = new Function(
    `return ${compileRouterToString(router)}`,
  )() as typeof compiledLookup;
  const lookups = [
    { name: "findRoute", match: (p: string) => findRoute(router, "GET", p) },
    { name: "compiledLookup", match: (p: string) => compiledLookup("GET", p) },
    { name: "aotLookup", match: (p: string) => aotLookup("GET", p) },
  ];
  for (const { name, match } of lookups) {
    it(`the first param takes as little as possible (${name})`, () => {
      expect(match("/a/x-y-z")?.params).toEqual({ a: "x", b: "y-z" });
      expect(match("/n/a.tar.gz")?.params).toEqual({ name: "a", ext: "tar.gz" });
      expect(match("/c/xyz")?.params).toEqual({ a: "x", b: "yz" });
      // A `*` stays greedy (URLPattern's `(.*)`).
      expect(match("/w/x-y-z")?.params).toEqual({ a: "x", "0": "y-z" });
      expect(match("/v/x-y-z")?.params).toEqual({ "0": "x-y", a: "z" });
      expect(match("/f/archive.tar.gz")?.params).toEqual({ name: "archive", ext: "tar.gz" });
      expect(match("/f/archive")?.params).toEqual({ name: "archive" });
    });

    it(`\`pre-:x?\` makes only the param optional (${name})`, () => {
      // The route without the param is static (no `params`).
      expect(match("/p/pre-")?.data).toEqual({ path: "/p/pre-:x?" });
      expect(match("/p/pre-a")?.params).toEqual({ x: "a" });
      expect(match("/p")).toBeUndefined();
      expect(match("/d/pre-")?.data).toEqual({ path: "/d/pre-:x(\\d+)?" });
      expect(match("/d/pre-12")?.params).toEqual({ x: "12" });
      expect(match("/d/pre-a")).toBeUndefined();
      expect(match("/d")).toBeUndefined();
      expect(match("/m/pre-/end")?.data).toEqual({ path: "/m/pre-:x?/end" });
      expect(match("/m/pre-1/end")?.params).toEqual({ x: "1" });
      expect(match("/m/end")).toBeUndefined();
      // `{pre-:x}?` makes the whole segment optional.
      expect(match("/s")?.data).toEqual({ path: "/s/{pre-:x}?" });
      expect(match("/s/pre-a")?.params).toEqual({ x: "a" });
      expect(match("/s/pre-")).toBeUndefined();
      // The route without `b` is `/e/:a`, which needs a value too.
      expect(match("/e/")).toBeUndefined();
      expect(match("/e//")).toBeUndefined();
      expect(match("/e/x")?.params).toEqual({ a: "x" });
      expect(match("/e/xyz")?.params).toEqual({ a: "x", b: "yz" });
      expect(match("/h/1-")?.params).toEqual({ a: "1" });
      expect(match("/h/1-a")?.params).toEqual({ a: "1", x: "a" });
    });

    it(`a greedy capture before \`:x?\` takes what it can, as in URLPattern (${name})`, () => {
      // An absent param has no key (`toStrictEqual` on a plain copy).
      const params = (p: string) => {
        const m = match(p);
        return m && { ...m.params };
      };
      expect(params("/g/a-b-")).toStrictEqual({ "0": "a-b" });
      expect(params("/g/a-b-c")).toStrictEqual({ "0": "a-b", x: "c" });
      expect(params("/g/a-")).toStrictEqual({ "0": "a" });
      expect(params("/g/--")).toStrictEqual({ "0": "-" });
      expect(params("/g/-")).toStrictEqual({ "0": "" });
      expect(params("/g/a")).toBeUndefined();
      expect(params("/k/12")).toStrictEqual({ a: "12" });
      expect(params("/k/1")).toStrictEqual({ a: "1" });
      expect(params("/k/12a")).toStrictEqual({ a: "12", b: "a" });
      expect(params("/k/a")).toBeUndefined();
      // The `*` takes it all, and the segment is required (as `/i/*.png`'s)
      expect(params("/i/ab")).toStrictEqual({ "0": "ab" });
      expect(params("/i")).toBeUndefined();
    });
  }
});

// A `?` param sharing its segment splits it like URLPattern's single regex
// (a greedy capture before it takes what it can), in every matcher and in
// `routeToRegExp`, and a `*` spans `/` as there (rou3 ignores one trailing
// slash, so no path ends in one here). Each pattern is also checked
// mid-route (`/p/<seg>/q`), after a `**` (`/**/<seg>`, `_` takes the segments
// before it; not with a `*`: one catch-all per route) and registered
// method-agnostic (`""`).
describe.skipIf(typeof (globalThis as any).URLPattern !== "function")(
  "params sharing a segment with an optional one (URLPattern parity)",
  () => {
    const patterns = [
      "/:a(\\d+):b?",
      "/*-:x?",
      "/*.:ext?",
      "/:a-:b?",
      "/:a.:b?",
      "/:a:b?",
      "/:a:b(\\d+)?",
      "/:a(\\d+)-:b?",
      "/:a(\\d+):b(\\d+)?",
      "/:a([a-z]+)-:b([a-z1]+)?",
      "/pre-:x?",
      "/pre-:x(\\d+)?",
      "/(\\d+)-*-:x?",
      "/*:x?",
      // A group holding only an optional param is that param (URLPattern
      // reads `{:x}?` as `:x?`), unless it starts its segment.
      "/*-{:x}?",
      "/:a(\\d+){:b}?",
      "/:a{:b}?",
      "/:a(\\d+){:b(\\d+)}?",
      "/pre-{:x}?",
      "/pre{:x(\\d+)}?",
    ];
    const chars = ["a", "1", "-", ".", "/"];
    const segments: string[] = [];
    // URLPattern resolves `.` / `..` segments
    const grow = (s: string) => {
      if (s && !/(^|\/)\.\.?(\/|$)/.test(s) && !s.endsWith("/")) segments.push(s);
      if (s.length < 4) for (const c of chars) grow(s + c);
    };
    grow("");
    const plain = (params: object | undefined) => ({ ...params });
    // [label, route, URLPattern prefix, path prefix, registration method]. A
    // `**` is URLPattern's `*` there (its first unnamed capture, `z` on these
    // paths), plus the router's deprecated `_` alias.
    const shapes: [string, (p: string) => string, string, string, string][] = [
      ["", (p) => p, "", "", "GET"],
      ["mid-route", (p) => `/p${p}/q`, "", "/p", "GET"],
      ["after **", (p) => `/**${p}`, "/*", "/z", "GET"],
      ['method ""', (p) => p, "", "", ""],
    ];

    for (const pattern of patterns) {
      for (const [label, toRoute, urlPrefix, pathPrefix, method] of shapes) {
        if (label === "after **" && pattern.includes("*")) continue;
        const route = toRoute(pattern);
        it(`${route}${label && ` (${label})`}`, () => {
          const urlPattern = new (globalThis as any).URLPattern({
            pathname: urlPrefix + pattern,
          });
          const router = createEmptyRouter();
          addRoute(router, method, route, route);
          const compiled = compileRouter(router);
          const compiledAll = compileRouter(router, { matchAll: true });
          const regex = routeToRegExp(route);
          const diffs: string[] = [];
          for (const segment of segments) {
            const path = `${pathPrefix}/${segment}${label === "mid-route" ? "/q" : ""}`;
            const groups = urlPattern.exec({
              pathname: `${urlPrefix && pathPrefix}/${segment}`,
            })?.pathname.groups;
            const regexExpected =
              groups &&
              Object.fromEntries(Object.entries(groups).filter(([, v]) => v !== undefined));
            const expected = regexExpected && {
              ...regexExpected,
              ...(label === "after **" && { _: regexExpected["0"] }),
            };
            const found = findRoute(router, "GET", path);
            const all = findAllRoutes(router, "GET", path);
            const got = {
              findRoute: found && plain(found.params),
              compiled: compiled("GET", path) && plain(compiled("GET", path)!.params),
              findAllRoutes: all.map((m) => plain(m.params)),
              matchAll: compiledAll("GET", path).map((m) => plain(m.params)),
              regex: (() => {
                const m = regex.exec(path);
                if (!m) return undefined;
                const g: Record<string, string> = {};
                for (const [k, v] of Object.entries(m.groups || {})) {
                  if (v !== undefined) g[k.replace(/^_(\d+)$/, "$1")] = v;
                }
                return g;
              })(),
            };
            const want = {
              findRoute: expected,
              compiled: expected,
              findAllRoutes: expected ? [expected] : [],
              matchAll: expected ? [expected] : [],
              regex: regexExpected,
            };
            for (const key of Object.keys(want) as (keyof typeof want)[]) {
              if (!isDeepStrictEqual(got[key], want[key])) {
                diffs.push(
                  `${path} ${key}: ${JSON.stringify(got[key])} (${JSON.stringify(want[key])})`,
                );
              }
            }
          }
          expect(diffs).toEqual([]);
        });
      }
    }
  },
);

// A `{…}?` group holding a param with more of its segment after it, where
// the `{:x}?` → `:x?` rewrite (only for a group ending its segment) and
// `joinGroup` (a regex group after a param is an unnamed capture) meet: two
// routes, which every matcher and `routeToRegExp` pick alike, as URLPattern
// does unless a greedy capture before the group could take its text (docs/reference.md
// "Differences from URLPattern": the route with the group wins).
describe("a param group before a regex group in its segment", () => {
  const segments: string[] = [];
  const grow = (s: string) => {
    if (s && s !== "." && s !== "..") segments.push(s);
    if (s.length < 4) for (const c of ["a", "1", "-", "y"]) grow(s + c);
  };
  grow("");
  const matchers = (route: string) => {
    const router = createEmptyRouter();
    addRoute(router, "GET", route, route);
    const compiled = compileRouter(router);
    // eslint-disable-next-line no-new-func
    const aot = new Function(`return ${compileRouterToString(router)}`)() as typeof compiled;
    const regex = DUPLICATE_NAMED_GROUPS || !needsDuplicateNames(route) ? routeToRegExp(route) : 0;
    const plain = (m: { params?: object } | undefined) => (m ? { ...m.params } : null);
    return (path: string) => ({
      findRoute: plain(findRoute(router, "GET", path)),
      compiled: plain(compiled("GET", path)),
      aot: plain(aot("GET", path)),
      ...(regex && {
        regex: (() => {
          const m = regex.exec(path);
          if (!m) return null;
          const g: Record<string, string> = {};
          for (const [k, v] of Object.entries(m.groups || {})) {
            if (v !== undefined) g[k.replace(/^_(\d+)$/, "$1")] = v;
          }
          return g;
        })(),
      }),
    });
  };
  const urlPattern = (route: string, path: string) => {
    const groups = new (globalThis as any).URLPattern({ pathname: route }).exec({ pathname: path })
      ?.pathname.groups;
    return groups
      ? Object.fromEntries(Object.entries(groups).filter(([, v]) => v !== undefined))
      : null;
  };

  it.runIf(typeof (globalThis as any).URLPattern === "function")("matches like URLPattern", () => {
    for (const route of [
      "/{:a}?(\\d+)",
      "/{:a}(\\d+)",
      "/:a{:b}?(1)",
      "/:a{(\\d+)}?",
      "/a-{:x}?(1)",
    ]) {
      const match = matchers(route);
      for (const segment of segments) {
        const path = `/${segment}`;
        const want = urlPattern(route, path);
        for (const [name, got] of Object.entries(match(path))) {
          expect(got, `${route} ${path} (${name})`).toEqual(want);
        }
      }
    }
  });

  it("lets the route with the param win after a greedy capture", () => {
    for (const [route, path, params, urlPatternParams] of [
      ["/a/*{:x}?(\\d+)", "/a/b12", { "0": "b", x: "1", "1": "2" }, { "0": "b1", "1": "2" }],
      ["/a/*{:x}?(\\d+)", "/a/12", { "0": "", x: "1", "1": "2" }, { "0": "1", "1": "2" }],
      ["/*-{:x}?(y)", "/a--y", { "0": "a", x: "-", "1": "y" }, { "0": "a-", "1": "y" }],
      ["/:a(\\d+){:b}?(y)", "/111y", { a: "11", b: "1", "0": "y" }, { a: "111", "0": "y" }],
    ] as const) {
      for (const [name, got] of Object.entries(matchers(route)(path))) {
        expect(got, `${route} ${path} (${name})`).toEqual(params);
      }
      if (typeof (globalThis as any).URLPattern === "function") {
        expect(urlPattern(route, path), `${route} ${path} (URLPattern)`).toEqual(urlPatternParams);
      }
    }
  });
});

describe("method-agnostic fallback (compiled parity)", () => {
  // A node's method-agnostic (`""`) entries are siblings of its method-scoped
  // ones: when every method-scoped matcher fails (regex), the `""` one still
  // matches (it used to be hidden, see test/method-agnostic.test.ts).
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/x/:id(\\d+)", { path: "GET-DATA" });
  addRoute(router, "", "/x/:id", { path: "AGN" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`agnostic sibling is a fallback for a failed method-scoped matcher (${name})`, () => {
      expect(match("GET", "/x/42")).toMatchObject({ data: { path: "GET-DATA" } });
      expect(match("GET", "/x/abc")).toMatchObject({ data: { path: "AGN" } });
      expect(match("POST", "/x/abc")).toMatchObject({ data: { path: "AGN" } });
    });
  }
});

describe("duplicate route registrations (compiled parity)", () => {
  // findRoute resolves duplicates in insertion order (`staticMatch[0]` /
  // first regex-passing entry); compiled single-match must agree instead of
  // returning the last-registered entry.
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/dup", { path: "S-FIRST" });
  addRoute(router, "GET", "/dup", { path: "S-SECOND" });
  addRoute(router, "GET", "/dup/:x", { path: "P-FIRST" });
  addRoute(router, "GET", "/dup/:x", { path: "P-SECOND" });
  addRoute(router, "GET", "/dup/:x(\\d+)/r", { path: "R-FIRST" });
  addRoute(router, "GET", "/dup/:x(\\d+)/r", { path: "R-SECOND" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`returns the first-registered duplicate (${name})`, () => {
      expect(match("GET", "/dup")).toMatchObject({ data: { path: "S-FIRST" } });
      expect(match("GET", "/dup/1")).toMatchObject({ data: { path: "P-FIRST" } });
      expect(match("GET", "/dup/1/r")).toMatchObject({ data: { path: "R-FIRST" } });
    });
  }
});

describe("prototype-key lookups (compiled parity)", () => {
  // Neither an Object.prototype member used as a path/method nor a
  // "__proto__" segment may leak a match (interpreter uses null-proto maps).
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/static", { path: "S" });
  addRoute(router, "GET", "/:p", { path: "P" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`does not match via prototype keys (${name})`, () => {
      expect(match("__proto__", "/static")).toBeUndefined();
      expect(match("constructor", "/static")).toBeUndefined();
      expect(match("toString", "/static")).toBeUndefined();
      expect(match("GET", "/__proto__")).toMatchObject({
        data: { path: "P" },
        params: { p: "__proto__" },
      });
    });
  }
});

describe("__proto__ param names (compiled parity)", () => {
  // A `"__proto__":` property in an object literal is the prototype setter, not
  // a data property — the compiled params literal must use a computed key or
  // the param silently disappears from the compiled result (the interpreter
  // builds params on a null-proto object and keeps it).
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/p/:__proto__", { path: "PARAM" });
  addRoute(router, "GET", "/r/:__proto__(\\d+)", { path: "REGEX" });
  addRoute(router, "GET", "/rp/x:__proto__(\\d+)y", { path: "REGEX-PARTIAL" });
  addRoute(router, "GET", "/w/**:__proto__", { path: "WILDCARD" });
  addRoute(router, "GET", "/o/:__proto__?", { path: "OPTIONAL" });
  addRoute(router, "GET", "/u/*", { path: "UNNAMED" });
  const compiledLookup = compileRouter(router);
  const compiledMatchAll = compileRouter(router, { matchAll: true });
  // eslint-disable-next-line no-new-func
  const aotLookup = new Function(
    `return ${compileRouterToString(router)}`,
  )() as typeof compiledLookup;

  const cases: [path: string, data: string, key: string, value: string][] = [
    ["/p/EVIL", "PARAM", "__proto__", "EVIL"],
    ["/r/42", "REGEX", "__proto__", "42"],
    ["/rp/x42y", "REGEX-PARTIAL", "__proto__", "42"],
    ["/w/a/b", "WILDCARD", "__proto__", "a/b"],
    ["/o/EVIL", "OPTIONAL", "__proto__", "EVIL"],
    ["/u/EVIL", "UNNAMED", "0", "EVIL"],
  ];

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
    { name: "aotLookup", match: (m: string, p: string) => aotLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`keeps a "__proto__" param as an own property (${name})`, () => {
      for (const [path, data, key, value] of cases) {
        const matched = match("GET", path);
        expect(matched?.data).toMatchObject({ path: data });
        // A bare `toEqual` passes vacuously against a prototype-setter result
        const params = matched!.params!;
        expect(Object.keys(params)).toEqual([key]);
        expect(Object.hasOwn(params, key)).toBe(true);
        expect(params[key]).toBe(value);
      }
      // The optional form still matches without the param
      expect(match("GET", "/o")).toMatchObject({ data: { path: "OPTIONAL" } });
    });
  }

  it("matchAll agrees with findAllRoutes (__proto__ params)", () => {
    for (const [path] of cases) {
      expect(compiledMatchAll("GET", path).map((mr) => [mr.data.path, { ...mr.params }])).toEqual(
        findAllRoutes(router, "GET", path).map((mr) => [mr.data.path, { ...mr.params }]),
      );
    }
  });
});

describe("many static routes (compiled static-map parity)", () => {
  // More than STATIC_CHAIN_MAX static paths switch the compiled static
  // dispatch from an `else if` chain to a null-proto map lookup — pin that
  // codegen path: hits, misses, root, method-agnostic fallback,
  // first-registered duplicates, prototype keys, and matchAll ordering.
  const router = createEmptyRouter<{ path: string }>();
  for (let i = 0; i < 10; i++) {
    addRoute(router, "GET", `/page${i}`, { path: `/page${i}` });
  }
  addRoute(router, "GET", "/", { path: "ROOT" });
  addRoute(router, "", "/any", { path: "ANY" });
  addRoute(router, "GET", "/dup", { path: "D-FIRST" });
  addRoute(router, "GET", "/dup", { path: "D-SECOND" });
  addRoute(router, "POST", "/page0/:id", { path: "/page0/:id" });
  const compiledLookup = compileRouter(router);
  const compiledMatchAll = compileRouter(router, { matchAll: true });

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`resolves static routes via the map (${name})`, () => {
      expect(match("GET", "/page0")).toMatchObject({ data: { path: "/page0" } });
      expect(match("GET", "/page9")).toMatchObject({ data: { path: "/page9" } });
      expect(match("GET", "/page9/")).toMatchObject({ data: { path: "/page9" } });
      expect(match("GET", "/")).toMatchObject({ data: { path: "ROOT" } });
      expect(match("GET", "//")).toBeUndefined();
      expect(match("GET", "/page9//")).toBeUndefined();
      expect(match("GET", "/nope")).toBeUndefined();
      // method-agnostic fallback + method miss falling through to the tree
      expect(match("DELETE", "/any")).toMatchObject({ data: { path: "ANY" } });
      expect(match("POST", "/page0/42")).toMatchObject({
        data: { path: "/page0/:id" },
        params: { id: "42" },
      });
      expect(match("POST", "/page1")).toBeUndefined();
      // duplicates resolve to the first-registered entry
      expect(match("GET", "/dup")).toMatchObject({ data: { path: "D-FIRST" } });
      // prototype keys must not leak through the map
      expect(match("__proto__", "/page0")).toBeUndefined();
      expect(match("GET", "/__proto__")).toBeUndefined();
      expect(match("GET", "/constructor")).toBeUndefined();
    });
  }

  it("matchAll agrees with findAllRoutes (map codegen)", () => {
    for (const path of ["/page0", "/dup", "/any", "/", "/nope"]) {
      for (const method of ["GET", "POST", "__proto__"]) {
        expect(compiledMatchAll(method, path).map((mr) => mr.data.path)).toEqual(
          findAllRoutes(router, method, path).map((mr) => mr.data.path),
        );
      }
    }
  });
});

describe("unusual method names (compiled parity)", () => {
  // Method keys are user input; the interpreter treats them as plain map keys,
  // so the compiler must escape them when embedding in generated code (a raw
  // quote used to be a SyntaxError in JIT mode and code injection in AOT).
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, 'GE"T', "/x/:id", { path: "QUOTED" });
  addRoute(router, "M\\N", "/x/:id", { path: "BACKSLASH" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`escapes method names in generated code (${name})`, () => {
      expect(match('GE"T', "/x/1")).toMatchObject({ data: { path: "QUOTED" } });
      expect(match("M\\N", "/x/1")).toMatchObject({ data: { path: "BACKSLASH" } });
      expect(match("GET", "/x/1")).toBeUndefined();
    });
  }
});

describe("wide static fan-out (compiled segment-switch parity)", () => {
  // More than SEGMENT_CHAIN_MAX static siblings at one tree level switch the
  // compiled dispatch from an `else if(s[i]==="...")` chain to a null-proto
  // `{segment: index}` map + integer switch — pin that codegen path: hits at
  // both ends, misses, prototype/`undefined` segment keys, short paths (the
  // out-of-bounds `s[i]` must not coerce into the map), deeper subtrees,
  // matchAll ordering, and the AOT emission.
  const N = 40;
  const router = createEmptyRouter<{ path: string }>();
  for (let i = 0; i < N; i++) {
    addRoute(router, "GET", `/res${i}/:id`, { path: `/res${i}/:id` });
  }
  addRoute(router, "GET", "/undefined/:id", { path: "/undefined/:id" });
  addRoute(router, "GET", "/__proto__/:id", { path: "/__proto__/:id" });
  addRoute(router, "GET", "/res0/:id/deep", { path: "/res0/:id/deep" });
  addRoute(router, "GET", "/:top", { path: "/:top" });
  addRoute(router, "GET", "/**", { path: "/**" });
  const compiledLookup = compileRouter(router);
  const compiledMatchAll = compileRouter(router, { matchAll: true });
  // eslint-disable-next-line no-new-func
  const aotLookup = new Function(
    `return ${compileRouterToString(router)}`,
  )() as typeof compiledLookup;

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
    { name: "aotLookup", match: (m: string, p: string) => aotLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`dispatches wide sibling sets via the segment switch (${name})`, () => {
      expect(match("GET", "/res0/1")).toMatchObject({
        data: { path: "/res0/:id" },
        params: { id: "1" },
      });
      expect(match("GET", `/res${N - 1}/x`)).toMatchObject({
        data: { path: `/res${N - 1}/:id` },
        params: { id: "x" },
      });
      expect(match("GET", "/res0/1/deep")).toMatchObject({
        data: { path: "/res0/:id/deep" },
        params: { id: "1" },
      });
      // switch miss falls through to the param/wildcard siblings
      expect(match("GET", "/nope")).toMatchObject({
        data: { path: "/:top" },
        params: { top: "nope" },
      });
      expect(match("GET", "/nope/deeper")).toMatchObject({ data: { path: "/**" } });
      // method miss inside a switch case must not fall through to other cases
      expect(match("POST", "/res0/1")).toBeUndefined();
      // segments that collide with object plumbing stay plain map keys
      expect(match("GET", "/undefined/7")).toMatchObject({
        data: { path: "/undefined/:id" },
        params: { id: "7" },
      });
      expect(match("GET", "/__proto__/7")).toMatchObject({
        data: { path: "/__proto__/:id" },
        params: { id: "7" },
      });
      expect(match("GET", "/constructor/7")).toMatchObject({ data: { path: "/**" } });
      // a short path must not reach the "undefined" map entry via s[i]===undefined
      expect(match("GET", "/undefined")).toMatchObject({
        data: { path: "/:top" },
        params: { top: "undefined" },
      });
    });
  }

  it("matchAll agrees with findAllRoutes (segment-switch codegen)", () => {
    for (const path of ["/res0/1", "/res39/x", "/res0/1/deep", "/undefined/7", "/nope", "/"]) {
      expect(compiledMatchAll("GET", path).map((mr) => mr.data.path)).toEqual(
        findAllRoutes(router, "GET", path).map((mr) => mr.data.path),
      );
    }
  });
});

describe("data slots above the argument limit (compiled)", () => {
  it("falls back to a single array argument for huge routers", () => {
    const router = createEmptyRouter<{ i: number }>();
    const N = 33_000; // > DATA_ARGS_MAX distinct data values
    for (let i = 0; i < N; i++) {
      addRoute(router, "GET", `/r${i}/:id`, { i });
    }
    const compiledLookup = compileRouter(router);
    expect(compiledLookup("GET", "/r0/x")).toMatchObject({ data: { i: 0 }, params: { id: "x" } });
    expect(compiledLookup("GET", `/r${N - 1}/x`)).toMatchObject({ data: { i: N - 1 } });
    expect(compiledLookup("GET", "/nope/x")).toBeUndefined();
    expect(compiledLookup.toString()).toContain("$[0]");
  });
});

describe("regex constraints with embedded groups (compiled parity)", () => {
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/c/:id(a(?:b)?c)", { path: "INNER-NONCAPTURING" });
  addRoute(router, "GET", "/m/:a(\\d+)/:b([a-z]+)", { path: "MULTI" });
  addRoute(router, "GET", "/n/:num(\\d+)", { path: "WHOLE" });
  addRoute(router, "GET", "/file/*.png", { path: "MID-WILDCARD" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`resolves nested and multiple regex groups (${name})`, () => {
      expect(match("GET", "/c/abc")?.params).toEqual({ id: "abc" });
      expect(match("GET", "/c/ac")?.params).toEqual({ id: "ac" });
      expect(match("GET", "/c/ax")).toBeUndefined();
      expect(match("GET", "/m/12/ab")).toMatchObject({
        data: { path: "MULTI" },
        params: { a: "12", b: "ab" },
      });
      expect(match("GET", "/m/12/34")).toBeUndefined();
      expect(match("GET", "/n/42")).toMatchObject({
        data: { path: "WHOLE" },
        params: { num: "42" },
      });
      expect(match("GET", "/n/x")).toBeUndefined();
      expect(match("GET", "/file/logo.png")).toMatchObject({
        data: { path: "MID-WILDCARD" },
        params: { "0": "logo" },
      });
    });
  }

  it("hoists regexes into data slots instead of inline literals", () => {
    // An inline literal would allocate a fresh RegExp per evaluation.
    const aot = compileRouterToString(router);
    expect(aot).toMatch(/\$\d+=\/\^/);
    expect(compiledLookup.toString()).not.toContain("/^(");
  });
});

describe("wildcard tail extraction (compiled parity)", () => {
  // Static-prefix wildcards compile to a constant `p.slice(K)`; these pin the
  // edge cases where `p` and the popped segment array could drift apart
  // (doubled slashes), plus the param-prefix form that must keep slice/join.
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/files/**:path", { path: "FILES" });
  addRoute(router, "GET", "/opt/**", { path: "OPT" });
  addRoute(router, "GET", "/pre/:x/**:rest", { path: "PRE" });
  addRoute(router, "GET", "/segment/*/", { path: "SEGMENT" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`extracts wildcard tails (${name})`, () => {
      expect(match("GET", "/files/a/b")).toMatchObject({
        data: { path: "FILES" },
        params: { path: "a/b" },
      });
      // doubled trailing slash: one is stripped, the other ends a real empty
      // segment, which a `**:name` can't take (nor one inside its value)
      expect(match("GET", "/files/a//")).toBeUndefined();
      expect(match("GET", "/files//a")).toBeUndefined();
      // ... unlike a `**`
      expect(match("GET", "/opt//a")).toEqual({
        data: { path: "OPT" },
        params: { 0: "/a", _: "/a" },
      });
      // required tail must not match empty
      expect(match("GET", "/files")).toBeUndefined();
      expect(match("GET", "/files/")).toBeUndefined();
      // optional tail matches zero segments (unset) and an empty one
      expect(match("GET", "/opt")).toEqual({ data: { path: "OPT" }, params: {} });
      expect(match("GET", "/opt/")).toEqual({ data: { path: "OPT" }, params: {} });
      expect(match("GET", "/opt//")).toEqual({ data: { path: "OPT" }, params: { 0: "", _: "" } });
      expect(match("GET", "/opt/a/b")).toMatchObject({
        data: { path: "OPT" },
        params: { "0": "a/b" },
      });
      // param before the wildcard: offset is unknown at compile time
      expect(match("GET", "/pre/v/a/b")).toMatchObject({
        data: { path: "PRE" },
        params: { x: "v", rest: "a/b" },
      });
      // a trailing `*` is optional (no key), takes nothing after the trailing
      // slash (`""`), or one segment or more
      expect(match("GET", "/segment")).toEqual({ data: { path: "SEGMENT" }, params: {} });
      expect(match("GET", "/segment/")).toEqual({ data: { path: "SEGMENT" }, params: { 0: "" } });
      expect(match("GET", "/segment//")).toEqual({ data: { path: "SEGMENT" }, params: { 0: "" } });
      expect(match("GET", "/segment/a/b")).toEqual({
        data: { path: "SEGMENT" },
        params: { 0: "a/b" },
      });
      expect(match("GET", "/segment/a//")).toEqual({
        data: { path: "SEGMENT" },
        params: { 0: "a/" },
      });
    });
  }
});

describe("at most one trailing slash is ignored (#209)", () => {
  // Lookup strips exactly one trailing "/"; whatever remains is matched
  // literally, so "/w5//" leaves a real empty last segment and misses the
  // static route (it used to strip a second one). Exercise both static
  // codegen modes (chain and map) plus the tree.
  for (const mode of ["chain", "map"] as const) {
    const router = createEmptyRouter<{ path: string }>();
    addRoute(router, "GET", "/w5", { path: "/w5" });
    addRoute(router, "GET", "/users/:id", { path: "/users/:id" });
    addRoute(router, "GET", "/opt/**", { path: "/opt/**" });
    addRoute(router, "GET", "/", { path: "/" });
    if (mode === "map") {
      for (let i = 0; i < 10; i++) {
        addRoute(router, "GET", `/page${i}`, { path: `/page${i}` });
      }
    }
    const compiledLookup = compileRouter(router);
    const compiledMatchAll = compileRouter(router, { matchAll: true });

    const lookups = [
      { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
      { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
    ];

    for (const { name, match } of lookups) {
      it(`matches path/ but not path// (${mode}, ${name})`, () => {
        expect(match("GET", "/w5")).toMatchObject({ data: { path: "/w5" } });
        expect(match("GET", "/w5/")).toMatchObject({ data: { path: "/w5" } });
        expect(match("GET", "/w5//")).toBeUndefined();
        expect(match("GET", "/")).toMatchObject({ data: { path: "/" } });
        expect(match("GET", "//")).toBeUndefined();
        expect(match("GET", "/users/123/")).toMatchObject({ params: { id: "123" } });
        expect(match("GET", "/users/123//")).toBeUndefined();
        // a slash after a real empty last segment is still the one ignored,
        // and a `:name` needs a value
        expect(match("GET", "/users//")).toBeUndefined();
        expect(match("GET", "/opt/a/")).toMatchObject({ params: { "0": "a" } });
        expect(match("GET", "/users/")).toBeUndefined();
        expect(match("GET", "/opt/a//")).toMatchObject({ params: { "0": "a/" } });
      });
    }

    it(`matchAll agrees with findAllRoutes (${mode})`, () => {
      for (const path of ["/", "//", "/w5//", "/w5/", "/w5", "/users/1//", "/users//", "/opt//"]) {
        expect(compiledMatchAll("GET", path).map((mr) => mr.data.path)).toEqual(
          findAllRoutes(router, "GET", path).map((mr) => mr.data.path),
        );
      }
    });
  }
});

describe("route patterns with trailing empty segments (#193)", () => {
  // A route registered as "/a//" used to keep a trailing empty segment, so the
  // tree ("/a///"), the ctx.static key ("/a/") and the compiled static
  // dispatch ("/a") each matched a different set of paths. Trailing slashes are
  // already "don't care" for routes (/a === /a/), so the extras fold in too:
  // /a// registers exactly as /a. Middle empties stay meaningful (see "/a//b").
  for (const route of ["/a", "/a/", "/a//", "/a///"]) {
    const router = createEmptyRouter<{ route: string }>();
    addRoute(router, "GET", route, { route });
    const compiledLookup = compileRouter(router);
    const compiledMatchAll = compileRouter(router, { matchAll: true });

    it(`route "${route}" matches /a and /a/ in every matcher`, () => {
      for (const path of ["/a", "/a/"]) {
        expect(findRoute(router, "GET", path), `findRoute ${path}`).toMatchObject({
          data: { route },
        });
        expect(compiledLookup("GET", path), `compiled ${path}`).toMatchObject({ data: { route } });
        expect(findAllRoutes(router, "GET", path).map((m) => m.data.route)).toEqual([route]);
        expect(compiledMatchAll("GET", path).map((m) => m.data.route)).toEqual([route]);
      }
      // beyond one trailing slash a real empty segment remains -> no match (#209)
      for (const path of ["/a//", "/a///"]) {
        expect(findRoute(router, "GET", path), `findRoute ${path}`).toBeUndefined();
        expect(compiledLookup("GET", path), `compiled ${path}`).toBeUndefined();
        expect(findAllRoutes(router, "GET", path)).toEqual([]);
        expect(compiledMatchAll("GET", path)).toEqual([]);
      }
    });

    it(`route "${route}" is removable by its registered form`, () => {
      const r = createEmptyRouter<{ route: string }>();
      addRoute(r, "GET", route, { route });
      removeRoute(r, "GET", route);
      expect(findRoute(r, "GET", "/a")).toBeUndefined();
    });
  }
});

describe("routes with an empty middle segment", () => {
  // Unlike trailing empties, an empty segment inside the path is a real static
  // segment (the request path keeps it too), so "/a//b" must not answer "/a/b".
  const router = createEmptyRouter<{ route: string }>();
  addRoute(router, "GET", "/a//b", { route: "/a//b" });
  const compiledLookup = compileRouter(router);

  it("matches only the doubled-slash path", () => {
    for (const match of [
      (p: string) => findRoute(router, "GET", p),
      (p: string) => compiledLookup("GET", p),
    ]) {
      expect(match("/a//b")).toMatchObject({ data: { route: "/a//b" } });
      expect(match("/a/b")).toBeUndefined();
    }
    expect(routeToRegExp("/a//b").test("/a//b")).toBe(true);
    expect(routeToRegExp("/a//b").test("/a/b")).toBe(false);
  });
});

describe("path normalization above the root (normalize: true)", () => {
  // A ".." that would climb above "/" is a no-op (like path.posix.normalize),
  // never a literal ".." segment. It used to leak one when the path was
  // already unwound to the root, so a "/**" route captured "../foo/bar".
  const router = createEmptyRouter<{ route: string }>();
  addRoute(router, "GET", "/**", { route: "/**" });
  addRoute(router, "GET", "/files/**", { route: "/files/**" });
  const compiledLookup = compileRouter(router, { normalize: true });
  const compiledMatchAll = compileRouter(router, { normalize: true, matchAll: true });

  it("normalizePath() drops excess .. segments", () => {
    expect(normalizePath("/x/../../foo/bar")).toBe("/foo/bar");
    expect(normalizePath("/../foo/bar")).toBe("/foo/bar");
    expect(normalizePath("/x/../../../foo/bar")).toBe("/foo/bar");
    expect(normalizePath("/..")).toBe("/");
    expect(normalizePath("/../..")).toBe("/");
    expect(normalizePath("/a/b/../c")).toBe("/a/c");
  });

  it("never captures a literal .. (findRoute/compiled parity)", () => {
    for (const match of [
      (p: string) => findRoute(router, "GET", p, { normalize: true }),
      (p: string) => compiledLookup("GET", p),
      (p: string) => findAllRoutes(router, "GET", p, { normalize: true }).at(-1),
      (p: string) => compiledMatchAll("GET", p).at(-1),
    ]) {
      expect(match("/x/../../foo/bar")).toEqual({
        data: { route: "/**" },
        params: { "0": "foo/bar", _: "foo/bar" },
      });
      expect(match("/../foo/bar")).toEqual({
        data: { route: "/**" },
        params: { "0": "foo/bar", _: "foo/bar" },
      });
      expect(match("/../files/a")).toEqual({
        data: { route: "/files/**" },
        params: { "0": "a", _: "a" },
      });
    }
  });

  it("keeps the trailing slash of a last `.` / `..` (WHATWG)", () => {
    // `new URL("http://x/foo/bar/..").pathname` is `/foo/`, which a `/foo/*`
    // matches (a trailing `*` takes nothing after a trailing slash)
    expect(normalizePath("/foo/bar/..")).toBe("/foo/");
    expect(normalizePath("/foo/.")).toBe("/foo/");
    expect(normalizePath("/foo/..")).toBe("/");
    expect(normalizePath("/..")).toBe("/");
    expect(normalizePath("/foo/./bar")).toBe("/foo/bar");
    const star = createEmptyRouter<string>();
    addRoute(star, "GET", "/foo/*", "/foo/*");
    const jit = compileRouter(star, { normalize: true });
    const jitAll = compileRouter(star, { normalize: true, matchAll: true });
    for (const path of ["/foo/bar/..", "/foo/."]) {
      const expected = { data: "/foo/*", params: { "0": "" } };
      expect(findRoute(star, "GET", path, { normalize: true }), path).toEqual(expected);
      expect(findAllRoutes(star, "GET", path, { normalize: true }), path).toEqual([expected]);
      expect(jit("GET", path), path).toEqual(expected);
      expect(jitAll("GET", path), path).toEqual([expected]);
    }
  });
});

describe("same-node sibling selection (findRoute/compiled parity)", () => {
  // One rule everywhere: among fully-matching siblings on one node, the
  // highest weight (regex count + required-last on a dynamic terminal) wins,
  // ties resolve to the first-registered — same model as findAllRoutes'
  // pushSorted and the compiled matcher.
  const router = createEmptyRouter<{ path: string }>();
  // optional registered BEFORE required: required is more specific and wins
  addRoute(router, "GET", "/t/*", { path: "/t/*" });
  addRoute(router, "GET", "/t/:id", { path: "/t/:id" });
  addRoute(router, "GET", "/w/**", { path: "/w/**" });
  addRoute(router, "GET", "/w/**:rest", { path: "/w/**:rest" });
  // regex fail must fall through to the optional/wildcard sibling, not abort
  addRoute(router, "GET", "/:y(\\d+)", { path: "/:y(\\d+)" });
  addRoute(router, "GET", "/*", { path: "/*" });
  addRoute(router, "GET", "/x/:id(\\d+)", { path: "/x/:id(\\d+)" });
  addRoute(router, "GET", "/x/**", { path: "/x/**" });
  // equal-weight regex siblings at different depths: first-registered wins
  addRoute(router, "GET", "/d/:a(\\d+)/:x", { path: "/d/:a(\\d+)/:x" });
  addRoute(router, "GET", "/d/:a/:x([a-z]+)", { path: "/d/:a/:x([a-z]+)" });
  // a sibling must still match when the greedier one fails its regex
  addRoute(router, "GET", "/e/:a(\\d+)/:x([a-z]+)", { path: "/e/:a(\\d+)/:x([a-z]+)" });
  addRoute(router, "GET", "/e/:a/:x([a-z]+)", { path: "/e/:a/:x([a-z]+)" });
  const compiledLookup = compileRouter(router);
  const compiledMatchAll = compileRouter(router, { matchAll: true });

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`required beats optional regardless of insertion order (${name})`, () => {
      expect(match("GET", "/t/v")).toMatchObject({
        data: { path: "/t/:id" },
        params: { id: "v" },
      });
      // (a `*` is a catch-all: on `/t/` it takes nothing after the slash)
      expect(match("GET", "/t/")).toMatchObject({ data: { path: "/t/*" } });
      expect(match("GET", "/w/v")).toMatchObject({
        data: { path: "/w/**:rest" },
        params: { rest: "v" },
      });
      expect(match("GET", "/w")).toMatchObject({ data: { path: "/w/**" } });
    });

    it(`regex miss falls through to the less specific sibling (${name})`, () => {
      expect(match("GET", "/a")).toMatchObject({
        data: { path: "/*" },
        params: { "0": "a" },
      });
      expect(match("GET", "/7")).toMatchObject({
        data: { path: "/:y(\\d+)" },
        params: { y: "7" },
      });
      expect(match("GET", "/x/a")).toMatchObject({
        data: { path: "/x/**" },
        params: { "0": "a", _: "a" },
      });
      expect(match("GET", "/x/7")).toMatchObject({
        data: { path: "/x/:id(\\d+)" },
        params: { id: "7" },
      });
    });

    it(`equal weights resolve to the first-registered sibling (${name})`, () => {
      expect(match("GET", "/d/9/abc")).toMatchObject({ data: { path: "/d/:a(\\d+)/:x" } });
      expect(match("GET", "/e/q/abc")).toMatchObject({ data: { path: "/e/:a/:x([a-z]+)" } });
    });
  }

  it("single match is the most specific entry of findAllRoutes", () => {
    for (const path of ["/t/v", "/t", "/w/v", "/w", "/a", "/7", "/x/a", "/x/7", "/e/q/abc"]) {
      const all = findAllRoutes(router, "GET", path);
      expect(compiledMatchAll("GET", path)).toEqual(all);
      expect(findRoute(router, "GET", path)).toEqual(all.at(-1));
    }
  });
});

describe("end-of-path optional fallback with mixed same-node siblings", () => {
  // One wildcard node can hold routes that need a segment (`**:name`) and
  // ones that don't (`**`, a trailing `*`) for the same method. The end-of-path fallback must scan all entries, not just the
  // first-inserted one.
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/p/:id", { path: "P-REQUIRED" });
  addRoute(router, "GET", "/p/*", { path: "P-OPTIONAL" });
  addRoute(router, "GET", "/w/**:name", { path: "W-REQUIRED" });
  addRoute(router, "GET", "/w/**", { path: "W-OPTIONAL" });
  addRoute(router, "GET", "/v/**:name", { path: "V-REQUIRED" });
  addRoute(router, "GET", "/v/*", { path: "V-OPTIONAL" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`optional sibling matches even when a required one was inserted first (${name})`, () => {
      expect(match("GET", "/p")).toMatchObject({ data: { path: "P-OPTIONAL" }, params: {} });
      expect(match("GET", "/p/")).toMatchObject({ data: { path: "P-OPTIONAL" } });
      expect(match("GET", "/w")).toMatchObject({ data: { path: "W-OPTIONAL" } });
      expect(match("GET", "/p/1")).toMatchObject({ data: { path: "P-REQUIRED" } });
      expect(match("GET", "/p/1/2")).toMatchObject({ data: { path: "P-OPTIONAL" } });
      expect(match("GET", "/w/1")).toMatchObject({ data: { path: "W-REQUIRED" } });
      expect(match("GET", "/v")).toMatchObject({ data: { path: "V-OPTIONAL" }, params: {} });
      expect(match("GET", "/v/")).toMatchObject({ data: { path: "V-OPTIONAL" } });
      expect(match("GET", "/v//")).toMatchObject({ data: { path: "V-OPTIONAL" } });
      expect(match("GET", "/v/1")).toMatchObject({ data: { path: "V-REQUIRED" } });
    });
  }
});

describe("match results are fresh objects (static fast path, params: false)", () => {
  // Every lookup must hand out a new `{ data, params? }` object: the
  // interpreter used to return the router's internal entry for static hits
  // and `params: false` (internal keys exposed, one shared object, mutations
  // leaking into later lookups). The compiled matcher always returned fresh.
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/static", { path: "STATIC" });
  addRoute(router, "GET", "/param/:id", { path: "PARAM" });
  addRoute(router, "GET", "/wild/**", { path: "WILD" });
  addRoute(router, "GET", "/sfx/**/end", { path: "SUFFIX" });
  const compiledLookup = compileRouter(router);
  const compiledMatchAll = compileRouter(router, { matchAll: true });
  const paths = ["/static", "/static/", "/param/1", "/wild/a/b", "/sfx/a/end"];
  const internal = ["paramsRegexp", "paramsMap", "route", "suffix"];

  it("results carry no internal keys", () => {
    for (const path of paths) {
      for (const params of [undefined, false]) {
        const one = findRoute(router, "GET", path, { params })!;
        expect(
          Object.keys(one).filter((k) => internal.includes(k)),
          path,
        ).toEqual([]);
        for (const m of findAllRoutes(router, "GET", path, { params })) {
          expect(
            Object.keys(m).filter((k) => internal.includes(k)),
            path,
          ).toEqual([]);
        }
      }
    }
  });

  it("params: false returns only `data`", () => {
    for (const path of paths) {
      expect(Object.keys(findRoute(router, "GET", path, { params: false })!)).toEqual(["data"]);
      for (const m of findAllRoutes(router, "GET", path, { params: false })) {
        expect(Object.keys(m)).toEqual(["data"]);
      }
    }
  });

  it("mutating a result does not leak into later lookups", () => {
    for (const path of paths) {
      for (const params of [undefined, false]) {
        const before = findRoute(router, "GET", path)!;
        const expected = { ...before };
        const one = findRoute(router, "GET", path, { params }) as any;
        one.params = { evil: "1" };
        one.data = { path: "EVIL" };
        for (const m of findAllRoutes(router, "GET", path, { params }) as any[]) {
          m.params = { evil: "1" };
          m.data = { path: "EVIL" };
        }
        expect(findRoute(router, "GET", path), path).toStrictEqual(expected);
        expect(findRoute(router, "GET", path)).not.toBe(findRoute(router, "GET", path));
        expect(findAllRoutes(router, "GET", path).at(-1), path).toStrictEqual(expected);
      }
    }
  });

  it("interpreter results have the compiled shape", () => {
    // Same keys (a static hit has no `params` key) and values; the params
    // objects differ only in prototype (null-proto in the interpreter)
    const shape = (r: any) => [Object.keys(r), { ...r, params: r.params && { ...r.params } }];
    for (const path of paths) {
      expect(shape(findRoute(router, "GET", path)), path).toStrictEqual(
        shape(compiledLookup("GET", path)),
      );
      expect(findAllRoutes(router, "GET", path).map(shape), path).toStrictEqual(
        compiledMatchAll("GET", path).map(shape),
      );
    }
  });
});

describe("falsy route data is kept", () => {
  // `addRoute` used to store `data || null`, so `0`, `""` and `false` came
  // back as `null`; missing data is still `null`.
  const values = [0, "", false, null] as const;
  // Few static routes compile to an `if` chain, more than STATIC_CHAIN_MAX to a map
  for (const extra of [0, 10]) {
    const router = createEmptyRouter<unknown>();
    for (let i = 0; i < extra; i++) addRoute(router, "GET", `/filler${i}`, i + 1);
    values.forEach((v, i) => {
      addRoute(router, "GET", `/s${i}`, v);
      addRoute(router, "GET", `/p${i}/:id`, v);
      addRoute(router, "GET", `/w${i}/**`, v);
    });
    addRoute(router, "GET", "/none");
    addRoute(router, "GET", "/none/:id", undefined);
    const compiledLookup = compileRouter(router);
    const compiledMatchAll = compileRouter(router, { matchAll: true });
    // eslint-disable-next-line no-new-func
    const aotLookup = new Function(
      `return ${compileRouterToString(router)}`,
    )() as typeof compiledLookup;
    // eslint-disable-next-line no-new-func
    const aotMatchAll = new Function(
      `return ${compileRouterToString(router, "", { matchAll: true })}`,
    )() as typeof compiledMatchAll;

    const lookups = [
      { name: "findRoute", match: (p: string) => findRoute(router, "GET", p)?.data },
      { name: "findAllRoutes", match: (p: string) => findAllRoutes(router, "GET", p)[0]?.data },
      { name: "compiledLookup", match: (p: string) => compiledLookup("GET", p)?.data },
      { name: "compiledMatchAll", match: (p: string) => compiledMatchAll("GET", p)[0]?.data },
      { name: "aotLookup", match: (p: string) => aotLookup("GET", p)?.data },
      { name: "aotMatchAll", match: (p: string) => aotMatchAll("GET", p)[0]?.data },
    ];

    for (const { name, match } of lookups) {
      it(`returns 0, "", false as registered (${name}, ${extra} extra static routes)`, () => {
        values.forEach((v, i) => {
          expect(match(`/s${i}`)).toBe(v);
          expect(match(`/p${i}/x`)).toBe(v);
          expect(match(`/w${i}/x/y`)).toBe(v);
        });
        expect(match("/none")).toBe(null);
        expect(match("/none/x")).toBe(null);
      });
    }
  }
});

// A `:name*` is `**:name` (as `:name+`) plus the route without it, so it never
// captures `""`, as in URLPattern: an empty segment alone falls through to
// a less specific route or no match, in every matcher.
describe("`:name*` never captures an empty value", () => {
  const router = createEmptyRouter<string>();
  for (const route of ["/a/:x*", "/b/:x*/c", "/:r*", "/d/:x*", "/d/*"]) {
    addRoute(router, "GET", route, route);
  }
  const jit = compileRouter(router);
  const jitAll = compileRouter(router, { matchAll: true });
  const aot = new Function(`return ${compileRouterToString(router)}`)();
  const aotAll = new Function(`return ${compileRouterToString(router, { matchAll: true })}`)();
  const cases: [string, { data: string; params?: Record<string, string> } | undefined][] = [
    ["/a", { data: "/a/:x*" }],
    // Nor an empty segment inside a longer value
    ["/a//", undefined],
    ["/a///", undefined],
    ["/a/b", { data: "/a/:x*", params: { x: "b" } }],
    ["/b/c", { data: "/b/:x*/c" }],
    ["/b//c", undefined],
    ["/b///c", undefined],
    ["/", { data: "/:r*" }],
    ["//", undefined],
    ["/d//", { data: "/d/*", params: { "0": "" } }],
  ];
  for (const [path, expected] of cases) {
    it(`${path} -> ${JSON.stringify(expected)}`, () => {
      const found = findRoute(router, "GET", path);
      expect(found && { data: found.data, params: found.params && { ...found.params } }).toEqual(
        expected,
      );
      const plain = JSON.parse(JSON.stringify(found ?? null));
      expect(jit("GET", path) ?? null).toEqual(plain);
      expect(aot("GET", path) ?? null).toEqual(plain);
      const all = findAllRoutes(router, "GET", path).map((m) => m.data);
      expect(jitAll("GET", path).map((m: { data: string }) => m.data)).toEqual(all);
      expect(aotAll("GET", path).map((m: { data: string }) => m.data)).toEqual(all);
      // No match gives any `:name*` an empty value
      for (const m of findAllRoutes(router, "GET", path)) {
        expect(Object.values(m.params ?? {}).filter((v) => v === "")).toEqual(
          m.data === "/d/*" ? [""] : [],
        );
      }
    });
  }
});

// URLPattern compiles `:name+` as `[^/]+(?:/[^/]+)*`: every segment it takes
// needs a value. So do `:name*` and `**:name` (the same catch-all), at the end
// of a route and before more of it; a bare `**` and a `*` still take empty
// segments, and lookup falls through to them. One trailing slash is still
// ignored (`/a/b/` is `/a/b`).
describe("`:name+` / `:name*` / `**:name` reject an empty segment in the value", () => {
  const routes = ["/a/:x+", "/a/**", "/b/:x*", "/c/:x+/d", "/c/*", "/e/**:x", "/f/:x*/g"];
  const router = createEmptyRouter<string>();
  for (const route of routes) addRoute(router, "GET", route, route);
  const jit = compileRouter(router);
  const jitAll = compileRouter(router, { matchAll: true });
  const aot = new Function(`return ${compileRouterToString(router)}`)();
  const aotAll = new Function(`return ${compileRouterToString(router, { matchAll: true })}`)();
  const cases: [string, { data: string; params?: Record<string, string> } | undefined][] = [
    ["/a/b/c", { data: "/a/:x+", params: { x: "b/c" } }],
    ["/a/b/", { data: "/a/:x+", params: { x: "b" } }],
    ["/a//b", { data: "/a/**", params: { 0: "/b", _: "/b" } }],
    ["/a/b//", { data: "/a/**", params: { 0: "b/", _: "b/" } }],
    ["/a/b//c", { data: "/a/**", params: { 0: "b//c", _: "b//c" } }],
    ["/b", { data: "/b/:x*" }],
    ["/b/x/y", { data: "/b/:x*", params: { x: "x/y" } }],
    ["/b//x", undefined],
    ["/b/x//", undefined],
    ["/b/x//y", undefined],
    ["/c/x/y/d", { data: "/c/:x+/d", params: { x: "x/y" } }],
    ["/c/x//d", { data: "/c/*", params: { 0: "x//d" } }],
    ["/c//x/d", { data: "/c/*", params: { 0: "/x/d" } }],
    ["/c/x///d", { data: "/c/*", params: { 0: "x///d" } }],
    ["/e/a/b", { data: "/e/**:x", params: { x: "a/b" } }],
    ["/e/a//b", undefined],
    ["/e//a", undefined],
    ["/e/a//", undefined],
    ["/f/g", { data: "/f/:x*/g" }],
    ["/f/a/b/g", { data: "/f/:x*/g", params: { x: "a/b" } }],
    ["/f/a//b/g", undefined],
    ["/f//g", undefined],
  ];
  for (const [path, expected] of cases) {
    it(`${path} -> ${JSON.stringify(expected)}`, () => {
      const found = findRoute(router, "GET", path);
      expect(found && { data: found.data, params: found.params && { ...found.params } }).toEqual(
        expected,
      );
      const plain = JSON.parse(JSON.stringify(found ?? null));
      expect(jit("GET", path) ?? null).toEqual(plain);
      expect(aot("GET", path) ?? null).toEqual(plain);
      const all = findAllRoutes(router, "GET", path).map((m) => m.data);
      expect(jitAll("GET", path).map((m: { data: string }) => m.data)).toEqual(all);
      expect(aotAll("GET", path).map((m: { data: string }) => m.data)).toEqual(all);
      // regex ≡ router, route by route
      for (const route of routes) {
        const single = createEmptyRouter<string>();
        addRoute(single, "GET", route, route);
        expect(routeToRegExp(route).test(path), `${route} on ${path}`).toBe(
          findRoute(single, "GET", path) !== undefined,
        );
      }
    });
  }
});

// Paths with an empty segment take `findAllRoutes`' walk in `findRoute` (a
// `:name` / `**:name` can't take one, #229), while the compiled matchers
// guard each param: both must still pick the same route, and list the same
// ones. Routers are random (seeded) picks from a pool, some method-agnostic.
describe("empty segments (compiled parity, sweep)", () => {
  const pool = [
    "/a/:x",
    "/a/*",
    "/:x/b",
    "/a/:x/b",
    "/a//b",
    "/a/**",
    "/a/**:r",
    "/a/:y*",
    "/a/:z+/b",
    "/**/:f",
    "/**/b",
    "/:x",
    "/*",
    "/a/:x?",
    "/a{/:x}?/b",
    "/a/:id(\\d*)",
    "/a/:id(\\d+)",
    "/a/pre-:x",
    "/**",
    "/a/b",
    "/:x/:y",
    "/*/:y",
    "/a/**/:y",
    "/:x/**:r",
    "/a/:x/*",
    // Constraints that also match the text `undefined` (a missing segment
    // must never reach a regex) or `""`
    "/:x([a-z]+)/*",
    "/a/:x(\\w+)/*",
    "/:x/(\\w*)/*",
    "/a/(.*)",
    "/a/(\\w+)/**",
    "/(\\w*)/b",
    "/a/:x([a-z]+)",
    "/a/pre-*",
    "/pre-*",
    // A `pre*` before more of the route
    "/pre-*/b",
    "/pre-*/:y",
    "/a/pre-*/:y?",
    "/pre-*{/b}?",
  ];
  const paths = ["/", "//"];
  for (let depth = 1, prev = [""]; depth <= 3; depth++) {
    prev = prev.flatMap((path) => ["a", "b", "", "1", "pre-", "pre-a"].map((s) => `${path}/${s}`));
    paths.push(...prev);
  }

  it("findRoute / findAllRoutes agree with JIT and AOT", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const failures: string[] = [];
    for (let n = 0; n < 300; n++) {
      const router = createEmptyRouter<string>();
      const routes = pool.filter(() => random() < 0.2);
      for (const route of routes) addRoute(router, random() < 0.3 ? "" : "GET", route, route);
      const jit = compileRouter(router);
      const jitAll = compileRouter(router, { matchAll: true });
      const aot = new Function(`return ${compileRouterToString(router)}`)();
      for (const path of paths) {
        const found = findRoute(router, "GET", path);
        const expected = JSON.stringify(found && { data: found.data, params: found.params });
        for (const [name, match] of [
          ["jit", jit("GET", path)],
          ["aot", aot("GET", path)],
        ]) {
          if (JSON.stringify(match) !== expected) {
            failures.push(`${name} [${routes}] ${path}: ${JSON.stringify(match)} vs ${expected}`);
          }
        }
        const all = findAllRoutes(router, "GET", path).map((m) => [m.data, m.params]);
        const compiledAll = jitAll("GET", path).map((m: { data: unknown; params?: object }) => [
          m.data,
          m.params,
        ]);
        if (JSON.stringify(all) !== JSON.stringify(compiledAll)) {
          failures.push(`matchAll [${routes}] ${path}: ${compiledAll} vs ${all}`);
        }
        // A pattern is listed at most once per path and expansion (a `*`
        // inside a segment is split into routes that never match the same
        // path; an optional after a catch-all can match with and without it,
        // as on main: `/a/**/:y?` on `/a/x/b`)
        const listed = all.map(([data]) => data as string);
        for (const route of new Set(listed)) {
          const count = listed.filter((data) => data === route).length;
          if (count > 2 ** (route.split("?").length - 1)) {
            failures.push(`listed ${count} times [${routes}] ${path}: ${route}`);
          }
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  }, 60_000);
});

// URLPattern reads `**` as `*` with a `*` modifier: an unnamed capture, keyed
// like a `*` or an unnamed group (`"0"`, `"1"`, …, in pattern order), and
// unset over zero segments. The router also reports a bare `**` as `_`
// (deprecated alias, 0.x compatibility), which the regex and URLPattern don't
// have. `differs`: URLPattern gives other groups (rou3 ignores one trailing
// slash, a `*` is one segment, `**.md` is `**\/*.md`, no `**:name` in
// URLPattern).
describe("bare `**` capture (URLPattern)", () => {
  const cases: [route: string, path: string, params: Record<string, string>, differs?: true][] = [
    ["/foo/**", "/foo/bar/baz", { 0: "bar/baz", _: "bar/baz" }],
    ["/foo/**", "/foo/bar", { 0: "bar", _: "bar" }],
    // Zero segments: both keys left out
    ["/foo/**", "/foo", {}],
    ["/foo/**", "/foo/", {}, true],
    ["/foo/**", "/foo//", { 0: "", _: "" }, true],
    ["/**", "/a/b", { 0: "a/b", _: "a/b" }],
    ["/**", "/", {}, true],
    ["/**", "//", { 0: "", _: "" }, true],
    ["/a/**/b", "/a/b", {}],
    ["/a/**/b", "/a//b", { 0: "", _: "" }],
    ["/a/**/b", "/a/x/y/b", { 0: "x/y", _: "x/y" }],
    ["/**/_payload.json", "/_payload.json", {}],
    ["/**/_payload.json", "/a/b/_payload.json", { 0: "a/b", _: "a/b" }],
    ["/:p/x/**", "/a/x/b/c", { p: "a", 0: "b/c", _: "b/c" }],
    ["/:p/x/**", "/a/x", { p: "a" }],
    ["/(\\d+)/**", "/1/b/c", { 0: "1", 1: "b/c", _: "b/c" }],
    ["/file-:f/**", "/file-a/b", { f: "a", 0: "b", _: "b" }],
    ["/**/:f", "/a/b", { 0: "a", _: "a", f: "b" }],
    ["/**/:f", "/a", { f: "a" }],
    ["/**/:f.png", "/a/b/x.png", { 0: "a/b", _: "a/b", f: "x" }],
    // `**<rest>` reads like `*<rest>`: one capture, no `_` alias
    ["/**.md", "/docs/intro.md", { 0: "docs/intro" }],
    ["/:id/**", "/a/b", { id: "a", 0: "b", _: "b" }],
    ["/:id/**", "/a", { id: "a" }],
    // A param named `_` without a bare `**` is an ordinary name
    ["/a/**:_", "/a/b/c", { _: "b/c" }, true],
    ["/a/:_*", "/a/b/c", { _: "b/c" }],
  ];

  for (const [route, path, params] of cases) {
    it(`${route} on ${path}`, () => {
      const router = createEmptyRouter<string>();
      addRoute(router, "GET", route, route);
      addRoute(router, "", route, `any ${route}`);
      const expected = { data: route, params };
      expect(findRoute(router, "GET", path)).toEqual(expected);
      expect(findRoute(router, "", path)).toEqual({ data: `any ${route}`, params });
      expect(findAllRoutes(router, "GET", path)).toEqual([
        { data: `any ${route}`, params },
        expected,
      ]);
      const jit = compileRouter(router);
      expect(jit("GET", path)).toEqual(expected);
      expect(jit("", path)).toEqual({ data: `any ${route}`, params });
      expect(compileRouter(router, { matchAll: true })("GET", path)).toEqual(
        findAllRoutes(router, "GET", path),
      );
      const aot = new Function(`return ${compileRouterToString(router)}`)();
      expect(aot("GET", path)).toEqual(expected);
      // A key is omitted, never `undefined`
      expect(Object.keys(findRoute(router, "GET", path)!.params!)).toEqual(Object.keys(params));
      expect(Object.keys(aot("GET", path).params)).toEqual(Object.keys(params));
      // `routeToRegExp` names unnamed captures `_N`, and has no `_` alias
      expect(definedGroups(path.match(routeToRegExp(route))?.groups)).toEqual(
        numberedOnly(route, params),
      );
    });
  }

  it("reserves `_` for the alias", () => {
    for (const route of ["/:_/**", "/**/:_", "/a/:_(\\d+)/**", "/**/x-:_"]) {
      expect(() => addRoute(createEmptyRouter(), "", route), route).toThrowError(
        `rou3: duplicate param name "_" (${route})`,
      );
      expect(() => routeToRegExp(route), route).toThrowError(/^rou3: duplicate param name "_"/);
    }
  });

  const URLPatternCtor = (globalThis as { URLPattern?: any }).URLPattern;
  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [route, path, params, differs] of cases) {
      const groups = new URLPatternCtor({ pathname: route }).exec({ pathname: path })?.pathname
        .groups;
      if (differs) {
        expect(definedGroups(groups), `${route} on ${path}`).not.toEqual(
          numberedOnly(route, params),
        );
      } else {
        expect(definedGroups(groups), `${route} on ${path}`).toEqual(numberedOnly(route, params));
      }
    }
  });
});

/** `params` without the router-only `_` alias of a bare `**`. */
function numberedOnly(route: string, params: Record<string, string>): Record<string, string> {
  if (!/\*\*(?!:)/.test(route)) return params;
  const { _: _alias, ...rest } = params;
  return rest;
}

function definedGroups(groups: Record<string, string | undefined> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(groups)) {
    if (value !== undefined) result[/^_\d+$/.test(key) ? key.slice(1) : key] = value;
  }
  return result;
}

// Unnamed captures are numbered over the whole pattern, as in URLPattern: a
// left-out optional group uses up the numbers of the captures in it, so a
// capture has one key in every route a pattern registers. `urlPattern`:
// "same" where URLPattern gives the same groups (without the `_` alias),
// "invalid" where it rejects the pattern (`{/**}`).
describe("unnamed captures are numbered over the whole pattern", () => {
  const cases: [
    route: string,
    path: string,
    params: Record<string, string>,
    urlPattern: "same" | "invalid",
  ][] = [
    ["/a{/(\\d+)}?/**", "/a/x/y", { 1: "x/y", _: "x/y" }, "same"],
    ["/a{/(\\d+)}?/**", "/a/1/y", { 0: "1", 1: "y", _: "y" }, "same"],
    ["/x{(\\d+)}?/*", "/x/b", { 1: "b" }, "same"],
    ["/x{(\\d+)}?/*", "/x1/b", { 0: "1", 1: "b" }, "same"],
    ["/a{-(\\d+)}?/*", "/a/y", { 1: "y" }, "same"],
    ["/a{-(\\d+)}?/*", "/a-1/y/z", { 0: "1", 1: "y/z" }, "same"],
    ["/a{/(\\d+)}?/*", "/a/x/y", { 1: "x/y" }, "same"],
    ["/a{/(\\d+)}?/*", "/a/1/y", { 0: "1", 1: "y" }, "same"],
    ["/a{/*}?/(\\d+)", "/a/1", { 1: "1" }, "same"],
    ["/a{/*}?/(\\d+)", "/a/x/1", { 0: "x", 1: "1" }, "same"],
    ["/{(\\d+)}?/a/**", "/1/a/b", { 0: "1", 1: "b", _: "b" }, "same"],
    ["/{(\\d+)}?/a/**", "//a/b", { 1: "b", _: "b" }, "same"],
    ["/**/{(\\d+)}?", "/a/1", { 0: "a", 1: "1", _: "a" }, "same"],
    ["/**/{b}?", "/a/b", { 0: "a", _: "a" }, "same"],
    ["/**/(\\d+)-:x?", "/a/1-c", { 0: "a", 1: "1", x: "c", _: "a" }, "same"],
    ["/**/(\\d+)-:x?", "/a/1-", { 0: "a", 1: "1", _: "a" }, "same"],
    ["/a{/:x}?/*", "/a/b/c", { x: "b", 0: "c" }, "same"],
    ["/a{/**}?/(\\d+).png", "/a/1.png", { 1: "1" }, "invalid"],
    ["/a{/**}?/(\\d+).png", "/a/b/1.png", { 0: "b", 1: "1", _: "b" }, "invalid"],
    ["/{/**}?/(\\d+)", "//1", { 1: "1" }, "invalid"],
    ["/{/**}?/(\\d+)", "//b/1", { 0: "b", 1: "1", _: "b" }, "invalid"],
    ["/a{/**}?/(\\d+)-:x?", "/a/1-c", { 1: "1", x: "c" }, "invalid"],
    ["/a{/**}?/(\\d+)-:x?", "/a/z/1-c", { 0: "z", 1: "1", x: "c", _: "z" }, "invalid"],
  ];

  for (const [route, path, params] of cases) {
    it(`${route} on ${path}`, () => {
      const router = createEmptyRouter<string>();
      addRoute(router, "GET", route, route);
      const expected = { data: route, params };
      expect(findRoute(router, "GET", path)).toEqual(expected);
      expect(findAllRoutes(router, "GET", path).at(-1)).toEqual(expected);
      expect(compileRouter(router)("GET", path)).toEqual(expected);
      expect(compileRouter(router, { matchAll: true })("GET", path)).toEqual(
        findAllRoutes(router, "GET", path),
      );
      const aot = new Function(`return ${compileRouterToString(router)}`)();
      expect(aot("GET", path)).toEqual(expected);
      // Without duplicate named groups (Node 22) an alternation regex throws
      if (!DUPLICATE_NAMED_GROUPS && needsDuplicateNames(route)) return;
      const groups = definedGroups(path.match(routeToRegExp(route))?.groups);
      if (route.startsWith("/**/{")) {
        // Known (`KNOWN_CAPTURE_DIFFS` in regexp.test.ts): the regex's greedy
        // `**` takes the optional group's segment, the router ranks the two
        // routes from the end of the path
        expect(groups).not.toEqual(numberedOnly(route, params));
      } else {
        expect(groups).toEqual(numberedOnly(route, params));
      }
    });
  }

  it("gives a capture one key in every route a pattern registers", () => {
    const router = createEmptyRouter<string>();
    addRoute(router, "GET", "/a{/**}?/(\\d+).png", "png");
    // Both routes match (the `**` over zero segments), the file is `1` in
    // each (listed once)
    expect(findAllRoutes(router, "GET", "/a/1.png").map((m) => ({ ...m.params }))).toEqual([
      { 1: "1" },
    ]);
    const segments = ["a", "1.png"];
    const entries = _findRanked(router, "GET", segments);
    expect(entries.map((m) => ({ ...getMatchParams(segments, m.paramsMap!, m.suffix) }))).toEqual([
      { 1: "1" },
      { 1: "1" },
    ]);
  });

  const URLPatternCtor = (globalThis as { URLPattern?: any }).URLPattern;
  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [route, path, params, urlPattern] of cases) {
      if (urlPattern === "invalid") {
        expect(() => new URLPatternCtor({ pathname: route }), route).toThrow();
        continue;
      }
      const groups = new URLPatternCtor({ pathname: route }).exec({ pathname: path })?.pathname
        .groups;
      expect(definedGroups(groups), `${route} on ${path}`).toEqual(numberedOnly(route, params));
    }
  });
});
