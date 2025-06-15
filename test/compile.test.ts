import { describe, it, expect } from "vitest";
import { createRouter, formatTree } from "./_utils.ts";
import { compileRouter } from "../src/compiler.ts";

describe("Compiled router", () => {
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
    const compiledLookup = compileRouter(router);

    // Static
    expect(compiledLookup("GET", "/test")).toEqual({
      data: { path: "/test" },
    });
    expect(compiledLookup("GET", "/test/foo")).toEqual({
      data: { path: "/test/foo" },
    });
    expect(compiledLookup("GET", "/test/fooo")).toEqual({
      data: { path: "/test/fooo" },
    });
    expect(compiledLookup("GET", "/another/path")).toEqual({
      data: { path: "/another/path" },
    });
    // Param
    expect(compiledLookup("GET", "/test/123")).toEqual({
      data: { path: "/test/:id" },
      params: { id: "123" },
    });
    expect(compiledLookup("GET", "/test/123/y")).toEqual({
      data: { path: "/test/:idY/y" },
      params: { idY: "123" },
    });
    expect(compiledLookup("GET", "/test/123/y/z")).toEqual({
      data: { path: "/test/:idYZ/y/z" },
      params: { idYZ: "123" },
    });
    expect(compiledLookup("GET", "/test/foo/123")).toEqual({
      data: { path: "/test/foo/*" },
      params: { _0: "123" },
    });
    // Wildcard
    expect(compiledLookup("GET", "/test/foo/123/456")).toEqual({
      data: { path: "/test/foo/**" },
      params: { _: "123/456" },
    });
    expect(compiledLookup("GET", "/wildcard/foo")).toEqual({
      data: { path: "/wildcard/**" },
      params: { _: "foo" },
    });
    expect(compiledLookup("GET", "/wildcard/foo/bar")).toEqual({
      data: { path: "/wildcard/**" },
      params: { _: "foo/bar" },
    });
    expect(compiledLookup("GET", "/wildcard")).toEqual({
      data: { path: "/wildcard/**" },
      params: { _: "" },
    });
  });
});
