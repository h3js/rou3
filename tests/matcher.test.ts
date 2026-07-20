import { describe, it, expect } from "vitest";
import { createRouter, exportMatcher, toRouteMatcher } from "../src";

export function createRoutes(paths) {
  return Object.fromEntries(paths.map((path) => [path, { pattern: path }]));
}

describe("Route matcher", function () {
  it("readme example works", () => {
    const router = createRouter({
      routes: {
        "/foo": { m: "foo" },
        "/foo/**": { m: "foo/**", order: "2" },
        "/foo/bar": { m: "foo/bar" },
        "/foo/bar/baz": { m: "foo/bar/baz", order: "4" },
        "/foo/*/baz": { m: "foo/*/baz", order: "3" },
        "/**": { order: "1" },
      },
    });

    const matcher = toRouteMatcher(router);
    const matches = matcher.matchAll("/foo/bar/baz");

    expect(matches).to.toMatchInlineSnapshot(`
      [
        {
          "order": "1",
        },
        {
          "m": "foo/**",
          "order": "2",
        },
        {
          "m": "foo/*/baz",
          "order": "3",
        },
        {
          "m": "foo/bar/baz",
          "order": "4",
        },
      ]
    `);
  });

  const routes = createRoutes([
    "/",
    "/foo",
    "/foo/*",
    "/foo/**",
    "/foo/bar",
    "/foo/baz",
    "/foo/baz/**",
    "/foo/*/sub",
    "/:foo/qux",
    "/:bar/quux",
    "/without-trailing",
    "/with-trailing/",
    "/c/**",
    "/cart",
  ]);

  const router = createRouter({ routes });
  const matcher = toRouteMatcher(router);

  const _match = (path) => matcher.matchAll(path).map((r) => r.pattern);

  it("can create route table", () => {
    expect(matcher.ctx.table).to.toMatchInlineSnapshot(`
      {
        "dynamic": Map {
          "/foo" => {
            "dynamic": Map {},
            "static": Map {
              "/sub" => {
                "pattern": "/foo/*/sub",
              },
              "/" => {
                "pattern": "/foo/*",
              },
            },
            "wildcard": Map {},
          },
          "" => {
            "dynamic": Map {},
            "static": Map {
              "/qux" => {
                "pattern": "/:foo/qux",
              },
              "/quux" => {
                "pattern": "/:bar/quux",
              },
            },
            "wildcard": Map {},
          },
        },
        "static": Map {
          "/" => {
            "pattern": "/",
          },
          "/foo" => {
            "pattern": "/foo",
          },
          "/foo/bar" => {
            "pattern": "/foo/bar",
          },
          "/foo/baz" => {
            "pattern": "/foo/baz",
          },
          "/without-trailing" => {
            "pattern": "/without-trailing",
          },
          "/with-trailing" => {
            "pattern": "/with-trailing/",
          },
          "/cart" => {
            "pattern": "/cart",
          },
        },
        "wildcard": Map {
          "/foo" => {
            "pattern": "/foo/**",
          },
          "/foo/baz" => {
            "pattern": "/foo/baz/**",
          },
          "/c" => {
            "pattern": "/c/**",
          },
        },
      }
    `);
  });

  it("can match routes", () => {
    expect(_match("/")).to.toMatchInlineSnapshot(`
      [
        "/",
      ]
    `);
    expect(_match("/foo")).to.toMatchInlineSnapshot(`
      [
        "/foo/**",
        "/foo",
      ]
    `);
    expect(_match("/foo/bar")).to.toMatchInlineSnapshot(`
      [
        "/foo/**",
        "/foo/*",
        "/foo/bar",
      ]
    `);
    expect(_match("/foo/baz")).to.toMatchInlineSnapshot(`
      [
        "/foo/**",
        "/foo/baz/**",
        "/foo/*",
        "/foo/baz",
      ]
    `);
    expect(_match("/foo/123/sub")).to.toMatchInlineSnapshot(`
      [
        "/foo/**",
        "/foo/*/sub",
      ]
    `);
    expect(_match("/foo/123")).to.toMatchInlineSnapshot(`
      [
        "/foo/**",
        "/foo/*",
      ]
    `);
    expect(_match("/123/qux")).to.toMatchInlineSnapshot(`
      [
        "/:foo/qux",
      ]
    `);
    expect(_match("/123/quux")).to.toMatchInlineSnapshot(`
      [
        "/:bar/quux",
      ]
    `);
  });

  it("trailing slash", () => {
    // Defined with trailing slash
    expect(_match("/with-trailing")).to.toMatchInlineSnapshot(`
      [
        "/with-trailing/",
      ]
    `);
    expect(_match("/with-trailing")).toMatchObject(_match("/with-trailing/"));

    // Defined without trailing slash
    expect(_match("/without-trailing")).to.toMatchInlineSnapshot(`
      [
        "/without-trailing",
      ]
    `);
    expect(_match("/without-trailing")).toMatchObject(
      _match("/without-trailing/"),
    );
  });

  it("prefix overlap", () => {
    expect(_match("/c/123")).to.toMatchInlineSnapshot(`
      [
        "/c/**",
      ]
    `);
    expect(_match("/c/123")).toMatchObject(_match("/c/123/"));
    expect(_match("/c/123")).toMatchObject(_match("/c"));

    expect(_match("/cart")).to.toMatchInlineSnapshot(`
      [
        "/cart",
      ]
    `);
  });

  it("can be exported", () => {
    const jsonData = exportMatcher(matcher);
    expect(jsonData).toMatchInlineSnapshot(`
      {
        "dynamic": {
          "": {
            "dynamic": {},
            "static": {
              "/quux": {
                "pattern": "/:bar/quux",
              },
              "/qux": {
                "pattern": "/:foo/qux",
              },
            },
            "wildcard": {},
          },
          "/foo": {
            "dynamic": {},
            "static": {
              "/": {
                "pattern": "/foo/*",
              },
              "/sub": {
                "pattern": "/foo/*/sub",
              },
            },
            "wildcard": {},
          },
        },
        "static": {
          "/": {
            "pattern": "/",
          },
          "/cart": {
            "pattern": "/cart",
          },
          "/foo": {
            "pattern": "/foo",
          },
          "/foo/bar": {
            "pattern": "/foo/bar",
          },
          "/foo/baz": {
            "pattern": "/foo/baz",
          },
          "/with-trailing": {
            "pattern": "/with-trailing/",
          },
          "/without-trailing": {
            "pattern": "/without-trailing",
          },
        },
        "wildcard": {
          "/c": {
            "pattern": "/c/**",
          },
          "/foo": {
            "pattern": "/foo/**",
          },
          "/foo/baz": {
            "pattern": "/foo/baz/**",
          },
        },
      }
    `);
  });
});
