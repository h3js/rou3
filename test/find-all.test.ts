import { describe, it, expect } from "vitest";
import { createRouter, formatTree } from "./_utils.ts";
import {
  addRoute,
  createRouter as createEmptyRouter,
  findAllRoutes,
  type RouterContext,
} from "../src/index.ts";
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

  it("regex-constrained param rejects non-matching segments", () => {
    const router = createRouter(["/user/:id(\\d+)"]);
    expect(_findAllRoutes(router, "GET", "/user/abc")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/user/42")).toEqual(["/user/:id(\\d+)"]);
  });

  it("unnamed regex group param is validated", () => {
    const router = createRouter(["/(\\d+)"]);
    expect(_findAllRoutes(router, "GET", "/abc")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/42")).toEqual(["/(\\d+)"]);
  });

  it("segment-wildcard param is validated", () => {
    const router = createRouter(["/*.png"]);
    expect(_findAllRoutes(router, "GET", "/logo.jpg")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/logo.png")).toEqual(["/*.png"]);
  });

  it("required param before a wildcard does not match zero segments", () => {
    const router = createRouter(["/:id/**"]);
    expect(_findAllRoutes(router, "GET", "/")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/a")).toEqual(["/:id/**"]);
    expect(_findAllRoutes(router, "GET", "/a/b")).toEqual(["/:id/**"]);
  });

  it("regex param before a wildcard does not crash on a short path", () => {
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

  // Regression #186: the optional-`**` presence guard (`l>currentIdx-1`) must
  // not inflate the compiled match weight, or the compiler reorders the optional
  // `**` sibling behind the required `**:name` and disagrees with the
  // interpreter (which emits same-node siblings in insertion order).
  it("optional `**` sibling is not reordered past required `**:name` (compiled)", () => {
    const router = createRouter(["/:id/**", "/:id/**:rest"]);
    expect(_findAllRoutes(router, "GET", "/a/b")).toEqual(["/:id/**", "/:id/**:rest"]);
    expect(_findAllRoutes(router, "GET", "/a/b/c")).toEqual(["/:id/**", "/:id/**:rest"]);
  });
});

describe("matcher: regression #187", () => {
  // `_findAllRoutes` asserts interpreter and compiled matchAll agree.
  // Same-node siblings must be returned least->most specific, with insertion
  // order preserved on equal specificity — regardless of insertion order.

  it("required `**:name` sibling ordered after optional `**` (reverse insertion)", () => {
    const router = createRouter(["/:id/**:rest", "/:id/**"]);
    expect(_findAllRoutes(router, "GET", "/a/b")).toEqual(["/:id/**", "/:id/**:rest"]);
  });

  it("required param sibling ordered after optional `*` (reverse insertion)", () => {
    const router = createRouter(["/foo/:id", "/foo/*"]);
    expect(_findAllRoutes(router, "GET", "/foo/x")).toEqual(["/foo/*", "/foo/:id"]);
  });

  it("regex-constrained param ordered after optional `*` (reverse insertion)", () => {
    const router = createRouter(["/:id(\\d+)", "/*"]);
    expect(_findAllRoutes(router, "GET", "/42")).toEqual(["/*", "/:id(\\d+)"]);
  });

  it("equal-specificity siblings keep insertion order", () => {
    expect(_findAllRoutes(createRouter(["/foo/:a", "/foo/:b"]), "GET", "/foo/x")).toEqual([
      "/foo/:a",
      "/foo/:b",
    ]);
    expect(_findAllRoutes(createRouter(["/foo/:b", "/foo/:a"]), "GET", "/foo/x")).toEqual([
      "/foo/:b",
      "/foo/:a",
    ]);
  });
});

describe("matcher: method-agnostic fallback", () => {
  // `_findAllRoutes` asserts interpreter and compiled matchAll agree.
  // Runtime resolves `methods[m] || methods[""]` per node: a method-scoped
  // registration fully shadows the method-agnostic one for that method. The
  // compiled output must not emit both layers (duplicate agnostic layer bug).

  it("method-scoped entry shadows the agnostic sibling on a wildcard node", () => {
    const router = createEmptyRouter<{ path: string }>();
    addRoute(router, "", "/api/**", { path: "AGN" });
    addRoute(router, "GET", "/api/**", { path: "GET-DATA" });
    expect(_findAllRoutes(router, "GET", "/api/x")).toEqual(["GET-DATA"]);
    expect(_findAllRoutes(router, "POST", "/api/x")).toEqual(["AGN"]);
  });

  it("shadowing is independent of registration order", () => {
    const router = createEmptyRouter<{ path: string }>();
    addRoute(router, "GET", "/api/**", { path: "GET-DATA" });
    addRoute(router, "", "/api/**", { path: "AGN" });
    expect(_findAllRoutes(router, "GET", "/api/x")).toEqual(["GET-DATA"]);
    expect(_findAllRoutes(router, "POST", "/api/x")).toEqual(["AGN"]);
  });

  it("static and param nodes shadow the same way", () => {
    const router = createEmptyRouter<{ path: string }>();
    addRoute(router, "", "/api", { path: "S-AGN" });
    addRoute(router, "GET", "/api", { path: "S-GET" });
    addRoute(router, "", "/api/:id", { path: "P-AGN" });
    addRoute(router, "GET", "/api/:id", { path: "P-GET" });
    expect(_findAllRoutes(router, "GET", "/api")).toEqual(["S-GET"]);
    expect(_findAllRoutes(router, "POST", "/api")).toEqual(["S-AGN"]);
    expect(_findAllRoutes(router, "GET", "/api/1")).toEqual(["P-GET"]);
    expect(_findAllRoutes(router, "POST", "/api/1")).toEqual(["P-AGN"]);
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
