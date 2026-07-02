import { describe, it, expect } from "vitest";
import { createRouter, formatTree } from "./_utils.ts";
import { findAllRoutes, type RouterContext } from "../src/index.ts";
import { compileRouter } from "../src/compiler.ts";
import { format } from "oxfmt";

// Helper to make snapsots more readable
const _findAllRoutes = (
  ctx: RouterContext<{ path?: string }>,
  method: string = "",
  path: string,
) => {
  const res = findAllRoutes(ctx, method, path).map((m) => m.data.path);

  const compiled = compileRouter(ctx, { matchAll: true });
  const compiledRes = compiled(method, path).map((m) => m.data.path);

  expect(compiledRes).toEqual(res);

  return res;
};

describe("find-matchAll: basic", () => {
  const router = createRouter(["/foo", "/foo/**", "/foo/bar", "/foo/bar/baz", "/foo/*/baz", "/**"]);

  it("snapshot", () => {
    expect(formatTree(router.root)).toMatchInlineSnapshot(`
      "<root>
          ├── /foo ┈> [GET] /foo
          │       ├── /bar ┈> [GET] /foo/bar
          │       │       ├── /baz ┈> [GET] /foo/bar/baz
          │       ├── /*
          │       │       ├── /baz ┈> [GET] /foo/*/baz
          │       ├── /** ┈> [GET] /foo/**
          ├── /** ┈> [GET] /**"
    `);
  });

  it("snapshot (compiled)", async () => {
    await expect(
      (await format("snapshot.mjs", compileRouter(router, { matchAll: true }).toString())).code,
    ).toMatchFileSnapshot(".snapshot/compiled-all.mjs");
  });

  it("snapshot (compiled - empty)", async () => {
    await expect(
      (await format("snapshot.mjs", compileRouter(createRouter([]), { matchAll: true }).toString()))
        .code,
    ).toMatchFileSnapshot(".snapshot/compiled-all-empty.mjs");
  });

  it("matches /foo/bar/baz pattern", () => {
    const matches = _findAllRoutes(router, "GET", "/foo/bar/baz");
    expect(matches).to.toMatchInlineSnapshot(`
      [
        "/**",
        "/foo/**",
        "/foo/*/baz",
        "/foo/bar/baz",
      ]
    `);
  });
});

describe("matcher: complex", () => {
  const router = createRouter([
    "/",
    "/foo",
    "/foo/*",
    "/foo/**",
    "/foo/bar",
    "/foo/baz",
    "/foo/baz/**",
    "/foo/*/sub",
    "/without-trailing",
    "/with-trailing/",
    "/c/**",
    "/cart",
  ]);

  it("snapshot", () => {
    expect(formatTree(router.root)).toMatchInlineSnapshot(`
      "<root> ┈> [GET] /
          ├── /foo ┈> [GET] /foo
          │       ├── /bar ┈> [GET] /foo/bar
          │       ├── /baz ┈> [GET] /foo/baz
          │       │       ├── /** ┈> [GET] /foo/baz/**
          │       ├── /* ┈> [GET] /foo/*
          │       │       ├── /sub ┈> [GET] /foo/*/sub
          │       ├── /** ┈> [GET] /foo/**
          ├── /without-trailing ┈> [GET] /without-trailing
          ├── /with-trailing ┈> [GET] /with-trailing/
          ├── /c
          │       ├── /** ┈> [GET] /c/**
          ├── /cart ┈> [GET] /cart"
    `);
  });

  it("can match routes", () => {
    expect(_findAllRoutes(router, "GET", "/")).to.toMatchInlineSnapshot(`
      [
        "/",
      ]
    `);
    expect(_findAllRoutes(router, "GET", "/foo")).to.toMatchInlineSnapshot(`
      [
        "/foo/**",
        "/foo/*",
        "/foo",
      ]
    `);
    expect(_findAllRoutes(router, "GET", "/foo/bar")).to.toMatchInlineSnapshot(`
        [
          "/foo/**",
          "/foo/*",
          "/foo/bar",
        ]
      `);
    expect(_findAllRoutes(router, "GET", "/foo/baz")).to.toMatchInlineSnapshot(`
        [
          "/foo/**",
          "/foo/*",
          "/foo/baz/**",
          "/foo/baz",
        ]
      `);
    expect(_findAllRoutes(router, "GET", "/foo/123/sub")).to.toMatchInlineSnapshot(`
        [
          "/foo/**",
          "/foo/*/sub",
        ]
      `);
    expect(_findAllRoutes(router, "GET", "/foo/123")).to.toMatchInlineSnapshot(`
        [
          "/foo/**",
          "/foo/*",
        ]
      `);
  });

  it("trailing slash", () => {
    // Defined with trailing slash
    expect(_findAllRoutes(router, "GET", "/with-trailing")).to.toMatchInlineSnapshot(`
        [
          "/with-trailing/",
        ]
      `);
    expect(_findAllRoutes(router, "GET", "/with-trailing")).toMatchObject(
      _findAllRoutes(router, "GET", "/with-trailing/"),
    );

    // Defined without trailing slash
    expect(_findAllRoutes(router, "GET", "/without-trailing")).to.toMatchInlineSnapshot(`
        [
          "/without-trailing",
        ]
      `);
    expect(_findAllRoutes(router, "GET", "/without-trailing")).toMatchObject(
      _findAllRoutes(router, "GET", "/without-trailing/"),
    );
  });

  it("prefix overlap", () => {
    expect(_findAllRoutes(router, "GET", "/c/123")).to.toMatchInlineSnapshot(
      `
      [
        "/c/**",
      ]
    `,
    );
    expect(_findAllRoutes(router, "GET", "/c/123")).toMatchObject(
      _findAllRoutes(router, "GET", "/c/123/"),
    );
    expect(_findAllRoutes(router, "GET", "/c/123")).toMatchObject(
      _findAllRoutes(router, "GET", "/c"),
    );

    expect(_findAllRoutes(router, "GET", "/cart")).to.toMatchInlineSnapshot(
      `
      [
        "/cart",
      ]
    `,
    );
  });
});

describe("matcher: order", () => {
  const router = createRouter(["/hello", "/hello/world", "/hello/*", "/hello/**"]);

  it("snapshot", () => {
    expect(formatTree(router.root)).toMatchInlineSnapshot(`
      "<root>
          ├── /hello ┈> [GET] /hello
          │       ├── /world ┈> [GET] /hello/world
          │       ├── /* ┈> [GET] /hello/*
          │       ├── /** ┈> [GET] /hello/**"
    `);
  });

  it("/hello", () => {
    const matches = _findAllRoutes(router, "GET", "/hello");
    expect(matches).to.toMatchInlineSnapshot(`
      [
        "/hello/**",
        "/hello/*",
        "/hello",
      ]
    `);
  });

  it("/hello/world", () => {
    const matches = _findAllRoutes(router, "GET", "/hello/world");
    expect(matches).to.toMatchInlineSnapshot(`
      [
        "/hello/**",
        "/hello/*",
        "/hello/world",
      ]
    `);
  });

  it("/hello/world/foobar", () => {
    const matches = _findAllRoutes(router, "GET", "/hello/world/foobar");
    expect(matches).to.toMatchInlineSnapshot(`
      [
        "/hello/**",
      ]
    `);
  });
});

describe("matcher: named wildcard", () => {
  const router = createRouter(["/a/**:rest", "/z/**"]);

  it("**:name requires at least one segment (consistent with findRoute)", () => {
    expect(_findAllRoutes(router, "GET", "/a")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/a/b")).toEqual(["/a/**:rest"]);
  });

  it("bare ** matches zero segments", () => {
    expect(_findAllRoutes(router, "GET", "/z")).toEqual(["/z/**"]);
    expect(_findAllRoutes(router, "GET", "/z/x")).toEqual(["/z/**"]);
  });
});

describe("matcher: root path parity", () => {
  // `_findAllRoutes` asserts interpreter and compiled matchAll agree.
  it("required root wildcard does not match root (0 segments)", () => {
    const router = createRouter(["/**:all"]);
    expect(_findAllRoutes(router, "GET", "/")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/a")).toEqual(["/**:all"]);
  });

  it("optional root wildcard matches root", () => {
    const router = createRouter(["/**"]);
    expect(_findAllRoutes(router, "GET", "/")).toEqual(["/**"]);
  });

  it("required root param does not match root (0 segments)", () => {
    const router = createRouter(["/:x"]);
    expect(_findAllRoutes(router, "GET", "/")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/a")).toEqual(["/:x"]);
  });

  it("optional trailing param still matches root", () => {
    const router = createRouter(["/*"]);
    expect(_findAllRoutes(router, "GET", "/")).toEqual(["/*"]);
    expect(_findAllRoutes(router, "GET", "/a")).toEqual(["/*"]);
  });

  it("collapses a trailing empty segment like splitPath (`//`, `/a//`)", () => {
    // Required wildcards/params must not see the phantom segment `//` splits into.
    expect(_findAllRoutes(createRouter(["/**:all"]), "GET", "//")).toEqual([]);
    expect(_findAllRoutes(createRouter(["/:x"]), "GET", "//")).toEqual([]);
    expect(_findAllRoutes(createRouter(["/a/**:x"]), "GET", "/a//")).toEqual([]);
    // But a root static route matches `//` via the un-split fast path.
    expect(_findAllRoutes(createRouter(["/"]), "GET", "//")).toEqual(["/"]);
  });
});

describe("matcher: regression #184", () => {
  // `_findAllRoutes` asserts interpreter and compiled matchAll agree.

  it("Bug A: regex-constrained param rejects non-matching segments", () => {
    const router = createRouter(["/user/:id(\\d+)"]);
    expect(_findAllRoutes(router, "GET", "/user/abc")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/user/42")).toEqual(["/user/:id(\\d+)"]);
  });

  it("Bug A: unnamed regex group param is validated", () => {
    const router = createRouter(["/(\\d+)"]);
    expect(_findAllRoutes(router, "GET", "/abc")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/42")).toEqual(["/(\\d+)"]);
  });

  it("Bug A: segment-wildcard param is validated", () => {
    const router = createRouter(["/*.png"]);
    expect(_findAllRoutes(router, "GET", "/logo.jpg")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/logo.png")).toEqual(["/*.png"]);
  });

  it("Bug B: required param before a wildcard does not match zero segments", () => {
    const router = createRouter(["/:id/**"]);
    expect(_findAllRoutes(router, "GET", "/")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/a")).toEqual(["/:id/**"]);
    expect(_findAllRoutes(router, "GET", "/a/b")).toEqual(["/:id/**"]);
  });

  it("Bug C: regex param before a wildcard does not crash on a short path", () => {
    const router = createRouter(["/(\\d+)/**"]);
    expect(_findAllRoutes(router, "GET", "/")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/abc")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/42")).toEqual(["/(\\d+)/**"]);
    expect(_findAllRoutes(router, "GET", "/42/x")).toEqual(["/(\\d+)/**"]);
  });

  it("optional & required routes on one param node filter per entry", () => {
    // A single param node can hold both an optional `*` and a required
    // `:id`/`:id(\d+)` route; the end-of-path branch must filter each entry.
    expect(_findAllRoutes(createRouter(["/foo/*", "/foo/:id"]), "GET", "/foo")).toEqual(["/foo/*"]);
    // Reverse insertion order (required registered first) must still match `*`.
    expect(_findAllRoutes(createRouter(["/foo/:id", "/foo/*"]), "GET", "/foo")).toEqual(["/foo/*"]);
    // A required regex sibling must not be pushed (previously crashed in getMatchParams).
    expect(_findAllRoutes(createRouter(["/foo/*", "/foo/:id(\\d+)"]), "GET", "/foo")).toEqual([
      "/foo/*",
    ]);
  });

  it("optional `**` and required `**:name` on one node keep least→most order", () => {
    const router = createRouter(["/:id/**", "/:id/**:rest"]);
    expect(_findAllRoutes(router, "GET", "/a/b")).toEqual(["/:id/**", "/:id/**:rest"]);
    expect(_findAllRoutes(router, "GET", "/a/b/c")).toEqual(["/:id/**", "/:id/**:rest"]);
  });
});

describe("matcher: named", () => {
  const router = createRouter(["/foo", "/foo/:bar", "/foo/:bar/:qaz"]);

  it("snapshot", () => {
    expect(formatTree(router.root)).toMatchInlineSnapshot(`
      "<root>
          ├── /foo ┈> [GET] /foo
          │       ├── /* ┈> [GET] /foo/:bar
          │       │       ├── /* ┈> [GET] /foo/:bar/:qaz"
    `);
  });

  it("matches /foo", () => {
    const matches = _findAllRoutes(router, "GET", "/foo");
    expect(matches).to.toMatchInlineSnapshot(`
      [
        "/foo",
      ]
    `);
  });

  it("matches /foo/123", () => {
    const matches = _findAllRoutes(router, "GET", "/foo/123");
    expect(matches).to.toMatchInlineSnapshot(`
      [
        "/foo/:bar",
      ]
    `);
  });

  it("matches /foo/123/456", () => {
    const matches = _findAllRoutes(router, "GET", "/foo/123/456");
    expect(matches).to.toMatchInlineSnapshot(`
      [
        "/foo/:bar/:qaz",
      ]
    `);
  });
});
