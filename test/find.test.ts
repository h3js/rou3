import { describe, it, expect } from "vitest";
import { createRouter, formatTree } from "./_utils.ts";
import { findRoute, removeRoute } from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";
import { format } from "prettier";

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
          ├── /** ┈> [GET] /**"
    `);
  });

  it("snapshot (compiled)", async () => {
    await expect(
      await format(compiledLookup.toString(), { parser: "acorn" }),
    ).toMatchFileSnapshot(".snapshot/compiled-jit.mjs");

    await expect(
      await format(compileRouterToString(router, "findRoute"), {
        parser: "acorn",
      }),
    ).toMatchFileSnapshot(".snapshot/compiled-aot.mjs");
  });

  it("snapshot (compiled - empty)", async () => {
    await expect(
      await format(compileRouter(createRouter([])).toString(), {
        parser: "acorn",
      }),
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
        params: { _0: "123" },
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
          │       ├── /** ┈> [GET] /wildcard/**"
    `);
    expect(findRoute(router, "GET", "/test")).toBeUndefined();
  });
});
