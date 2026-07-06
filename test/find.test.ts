import { describe, it, expect } from "vitest";
import { createRouter, formatTree } from "./_utils.ts";
import {
  addRoute,
  createRouter as createEmptyRouter,
  findRoute,
  removeRoute,
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
