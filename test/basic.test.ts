import { describe, it, expect } from "vitest";
import { createRouter, formatTree } from "./_utils.ts";
import { findRoute, removeRoute } from "../src/index.ts";

describe("Basic router", () => {
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
  ]);

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
          │       ├── /** ┈> [GET] /wildcard/**"
    `);
  });

  it("lookup works", () => {
    // Static
    expect(findRoute(router, "GET", "/test")).toEqual({
      data: { path: "/test" },
    });
    expect(findRoute(router, "GET", "/test/foo")).toEqual({
      data: { path: "/test/foo" },
    });
    expect(findRoute(router, "GET", "/test/fooo")).toEqual({
      data: { path: "/test/fooo" },
    });
    expect(findRoute(router, "GET", "/another/path")).toEqual({
      data: { path: "/another/path" },
    });
    // Param
    expect(findRoute(router, "GET", "/test/123")).toEqual({
      data: { path: "/test/:id" },
      params: { id: "123" },
    });
    expect(findRoute(router, "GET", "/test/123/y")).toEqual({
      data: { path: "/test/:idY/y" },
      params: { idY: "123" },
    });
    expect(findRoute(router, "GET", "/test/123/y/z")).toEqual({
      data: { path: "/test/:idYZ/y/z" },
      params: { idYZ: "123" },
    });
    expect(findRoute(router, "GET", "/test/foo/123")).toEqual({
      data: { path: "/test/foo/*" },
      params: { _0: "123" },
    });
    // Wildcard
    expect(findRoute(router, "GET", "/test/foo/123/456")).toEqual({
      data: { path: "/test/foo/**" },
      params: { _: "123/456" },
    });
    expect(findRoute(router, "GET", "/wildcard/foo")).toEqual({
      data: { path: "/wildcard/**" },
      params: { _: "foo" },
    });
    expect(findRoute(router, "GET", "/wildcard/foo/bar")).toEqual({
      data: { path: "/wildcard/**" },
      params: { _: "foo/bar" },
    });
    expect(findRoute(router, "GET", "/wildcard")).toEqual({
      data: { path: "/wildcard/**" },
      params: { _: "" },
    });
  });

  it("remove works", () => {
    removeRoute(router, "GET", "/test");
    removeRoute(router, "GET", "/test/*");
    removeRoute(router, "GET", "/test/foo/*");
    removeRoute(router, "GET", "/test/foo/**");
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
