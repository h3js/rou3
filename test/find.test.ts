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
import { format } from "oxfmt";

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
          │       │       ├── /* ┈> [GET] /test/foo/*
          │       │       ├── /** ┈> [GET] /test/foo/**
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
      // Wildcard
      expect(match("GET", "/test/foo/123/456")).toMatchObject({
        data: { path: "/test/foo/**" },
        params: { _: "123/456" },
      });
      expect(match("GET", "/wildcard/foo")).toMatchObject({
        data: { path: "/wildcard/**" },
        params: { _: "foo" },
      });
      expect(match("GET", "/wildcard/foo/bar")).toMatchObject({
        data: { path: "/wildcard/**" },
        params: { _: "foo/bar" },
      });
      expect(match("GET", "/wildcard")).toMatchObject({
        data: { path: "/wildcard/**" },
        params: { _: "" },
      });
      // Root wildcard
      expect(match("GET", "/anything")).toMatchObject({
        data: { path: "/**" },
        params: { _: "anything" },
      });
      expect(match("GET", "/any/deep/path")).toMatchObject({
        data: { path: "/**" },
        params: { _: "any/deep/path" },
      });
      // Escaped characters
      expect(match("GET", "/static:path/*/**")).toMatchObject({
        data: { path: "/static\\:path/\\*/\\*\\*" },
      });
    });
  }

  it("remove works", () => {
    removeRoute(router, "GET", "/test");
    removeRoute(router, "GET", "/test/*");
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

describe("hyphenated param names", () => {
  const router = createRouter([
    "/users/:user-id",
    "/users/:user-id/posts/:post-id",
    "/items/:item-name/details",
  ]);

  const compiledLookup = compileRouter(router);

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
    it(`match hyphenated params with ${name}`, () => {
      expect(match("GET", "/users/123")).toMatchObject({
        data: { path: "/users/:user-id" },
        params: { "user-id": "123" },
      });
      expect(match("GET", "/users/abc/posts/456")).toMatchObject({
        data: { path: "/users/:user-id/posts/:post-id" },
        params: { "user-id": "abc", "post-id": "456" },
      });
      expect(match("GET", "/items/widget/details")).toMatchObject({
        data: { path: "/items/:item-name/details" },
        params: { "item-name": "widget" },
      });
      // Hyphenated param should still be single-segment
      expect(match("GET", "/users/foo/bar")).not.toMatchObject({
        data: { path: "/users/:user-id" },
      });
    });
  }
});

describe("param names that are not valid capture-group names", () => {
  // Param names accept `[\w-]+`, but a JS/PCRE capture group name must be an
  // identifier (no `-`, no leading digit). Whole-segment params store the name
  // as a plain string key and always worked; every regex-compiled position
  // (mixed segments, inline constraints, segment wildcards) used to emit the
  // raw name as `(?<test-id>…)` and throw `SyntaxError: Invalid capture group
  // name` from addRoute().
  const router = createRouter([
    "/files/:file-name.json",
    "/blog/:post-id(\\d+)",
    "/n/:0.txt",
    "/mix/:a-b.:a_b",
    "/run/:a--b.:a_-b",
    "/w/:file-name.*",
  ]);

  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`params surface under their original names (${name})`, () => {
      expect(match("GET", "/files/readme.json")).toMatchObject({
        data: { path: "/files/:file-name.json" },
        params: { "file-name": "readme" },
      });
      expect(match("GET", "/blog/123")).toMatchObject({
        data: { path: "/blog/:post-id(\\d+)" },
        params: { "post-id": "123" },
      });
      expect(match("GET", "/blog/abc")).toBeUndefined();
      expect(match("GET", "/n/42.txt")).toMatchObject({
        data: { path: "/n/:0.txt" },
        params: { "0": "42" },
      });
      // Distinct names must stay distinct through the escape. A `-` -> `_`
      // sanitize collapses `a-b`/`a_b` onto one group name, corrupts `a--b`
      // into `a_b`, and makes `a-_b`/`a_-b` a duplicate group (SyntaxError).
      expect(match("GET", "/mix/x.y")).toMatchObject({
        data: { path: "/mix/:a-b.:a_b" },
        params: { "a-b": "x", a_b: "y" },
      });
      expect(match("GET", "/run/x.y")).toMatchObject({
        data: { path: "/run/:a--b.:a_-b" },
        params: { "a--b": "x", "a_-b": "y" },
      });
      // Escaped name alongside an unnamed segment wildcard capture.
      expect(match("GET", "/w/logo.dark")).toMatchObject({
        data: { path: "/w/:file-name.*" },
        params: { "file-name": "logo", "0": "dark" },
      });
    });
  }
});

describe("method-agnostic fallback (compiled parity)", () => {
  // Runtime resolves `methods[m] || methods[""]` per node: when a
  // method-scoped entry exists, the agnostic sibling is never consulted for
  // that method — even if the scoped matcher's conditions (regex) fail.
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/x/:id(\\d+)", { path: "GET-DATA" });
  addRoute(router, "", "/x/:id", { path: "AGN" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`agnostic sibling is not a fallback for a failed method-scoped matcher (${name})`, () => {
      expect(match("GET", "/x/42")).toMatchObject({ data: { path: "GET-DATA" } });
      expect(match("GET", "/x/abc")).toBeUndefined();
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
      expect(match("GET", "//")).toMatchObject({ data: { path: "ROOT" } });
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
  addRoute(router, "GET", "/c/:id(a(?<extra>b)?c)", { path: "INNER-NAMED" });
  addRoute(router, "GET", "/m/:a(\\d+)/:b([a-z]+)", { path: "MULTI" });
  addRoute(router, "GET", "/n/:num(\\d+)", { path: "WHOLE" });
  addRoute(router, "GET", "/file/*.png", { path: "MID-WILDCARD" });
  // Unicode group name: unsafe as a `.name` access, takes the
  // `_normalizeGroups` runtime-fallback codegen path
  addRoute(router, "GET", "/uni/:id(a(?<é>b)c)", { path: "UNI-FALLBACK" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`resolves nested and multiple regex groups (${name})`, () => {
      expect(match("GET", "/c/abc")).toMatchObject({
        data: { path: "INNER-NAMED" },
        params: { id: "abc", extra: "b" },
      });
      expect(match("GET", "/c/ac")).toMatchObject({
        data: { path: "INNER-NAMED" },
        params: { id: "ac" },
      });
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
      expect(match("GET", "/uni/abc")).toMatchObject({
        data: { path: "UNI-FALLBACK" },
        params: { id: "abc", é: "b" },
      });
      expect(match("GET", "/uni/axc")).toBeUndefined();
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
      // doubled trailing slash: one is stripped, one is a popped empty segment
      expect(match("GET", "/files/a//")).toMatchObject({
        data: { path: "FILES" },
        params: { path: "a" },
      });
      // doubled internal slash is preserved in the tail
      expect(match("GET", "/files//a")).toMatchObject({
        data: { path: "FILES" },
        params: { path: "/a" },
      });
      // required tail must not match empty
      expect(match("GET", "/files")).toBeUndefined();
      expect(match("GET", "/files/")).toBeUndefined();
      // optional tail matches empty (with and without doubled slash)
      expect(match("GET", "/opt")).toMatchObject({ data: { path: "OPT" }, params: { _: "" } });
      expect(match("GET", "/opt//")).toMatchObject({ data: { path: "OPT" }, params: { _: "" } });
      expect(match("GET", "/opt/a/b")).toMatchObject({
        data: { path: "OPT" },
        params: { _: "a/b" },
      });
      // param before the wildcard: offset is unknown at compile time
      expect(match("GET", "/pre/v/a/b")).toMatchObject({
        data: { path: "PRE" },
        params: { x: "v", rest: "a/b" },
      });
    });
  }
});

describe("static routes reached with a doubled trailing slash (compiled parity)", () => {
  // "/w5//" strips one slash to "/w5/": the raw string misses an exact-match
  // static dispatch, but its segments equal the static route's, so the
  // interpreter tree matches — the compiled static dispatch must accept the
  // trailing-slash form too. Exercise both codegen modes (chain and map).
  for (const mode of ["chain", "map"] as const) {
    const router = createEmptyRouter<{ path: string }>();
    addRoute(router, "GET", "/w5", { path: "/w5" });
    addRoute(router, "GET", "/:top", { path: "/:top" });
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
      it(`matches the static route for path//, not beyond (${mode}, ${name})`, () => {
        expect(match("GET", "/w5//")).toMatchObject({ data: { path: "/w5" } });
        expect(match("GET", "/w5/")).toMatchObject({ data: { path: "/w5" } });
        // three slashes leave a real empty segment -> no match anywhere
        expect(match("GET", "/w5///")).toBeUndefined();
      });
    }

    it(`matchAll agrees with findAllRoutes (${mode})`, () => {
      for (const path of ["/w5//", "/w5/", "/w5", "/w5///"]) {
        expect(compiledMatchAll("GET", path).map((mr) => mr.data.path)).toEqual(
          findAllRoutes(router, "GET", path).map((mr) => mr.data.path),
        );
      }
    });
  }
});

describe("route patterns with trailing empty segments (#193)", () => {
  // A route registered as "/a//" used to keep a trailing empty segment, so the
  // radix tree ("/a///"), the ctx.static key ("/a/") and the compiled static
  // dispatch ("/a") each matched a different set of paths. Trailing slashes are
  // already "don't care" for routes (/a === /a/), so the extras fold in too:
  // /a// registers exactly as /a. Middle empties stay meaningful (see "/a//b").
  for (const route of ["/a", "/a/", "/a//", "/a///"]) {
    const router = createEmptyRouter<{ route: string }>();
    addRoute(router, "GET", route, { route });
    const compiledLookup = compileRouter(router);
    const compiledMatchAll = compileRouter(router, { matchAll: true });

    it(`route "${route}" matches /a, /a/ and /a// in every matcher`, () => {
      for (const path of ["/a", "/a/", "/a//"]) {
        expect(findRoute(router, "GET", path), `findRoute ${path}`).toMatchObject({
          data: { route },
        });
        expect(compiledLookup("GET", path), `compiled ${path}`).toMatchObject({ data: { route } });
        expect(findAllRoutes(router, "GET", path).map((m) => m.data.route)).toEqual([route]);
        expect(compiledMatchAll("GET", path).map((m) => m.data.route)).toEqual([route]);
      }
      // beyond the doubled slash a real empty segment remains -> no match
      expect(findRoute(router, "GET", "/a///")).toBeUndefined();
      expect(compiledLookup("GET", "/a///")).toBeUndefined();
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
  addRoute(router, "GET", "/*/*", { path: "/*/*" });
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
      expect(match("GET", "/t")).toMatchObject({ data: { path: "/t/*" } });
      expect(match("GET", "/w/v")).toMatchObject({
        data: { path: "/w/**:rest" },
        params: { rest: "v" },
      });
      expect(match("GET", "/w")).toMatchObject({ data: { path: "/w/**" } });
    });

    it(`regex miss falls through to the less specific sibling (${name})`, () => {
      expect(match("GET", "/a")).toMatchObject({
        data: { path: "/*/*" },
        params: { "0": "a" },
      });
      expect(match("GET", "/7")).toMatchObject({
        data: { path: "/:y(\\d+)" },
        params: { y: "7" },
      });
      expect(match("GET", "/x/a")).toMatchObject({
        data: { path: "/x/**" },
        params: { _: "a" },
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
  // One param/wildcard node can hold both required (`:id`, `**:name`) and
  // optional (`*`, `**`) routes for the same method. The end-of-path fallback
  // must scan all entries, not just the first-inserted one.
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/p/:id", { path: "P-REQUIRED" });
  addRoute(router, "GET", "/p/*", { path: "P-OPTIONAL" });
  addRoute(router, "GET", "/w/**:name", { path: "W-REQUIRED" });
  addRoute(router, "GET", "/w/**", { path: "W-OPTIONAL" });
  const compiledLookup = compileRouter(router);

  const lookups = [
    { name: "findRoute", match: (m: string, p: string) => findRoute(router, m, p) },
    { name: "compiledLookup", match: (m: string, p: string) => compiledLookup(m, p) },
  ];

  for (const { name, match } of lookups) {
    it(`optional sibling matches even when a required one was inserted first (${name})`, () => {
      expect(match("GET", "/p")).toMatchObject({ data: { path: "P-OPTIONAL" } });
      expect(match("GET", "/w")).toMatchObject({ data: { path: "W-OPTIONAL" } });
      expect(match("GET", "/p/1")).toMatchObject({ data: { path: "P-REQUIRED" } });
      expect(match("GET", "/w/1")).toMatchObject({ data: { path: "W-REQUIRED" } });
    });
  }
});
