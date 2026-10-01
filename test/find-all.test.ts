import { describe, it, expect } from "vitest";
import { createRouter, formatTree } from "./_utils.ts";
import {
  addRoute,
  compareRoutes,
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
          │       ├── /** ┈> [GET] /foo/**
          │       │       ├── <suffix>
          │       │       │       ├── /baz ┈> [GET] /foo/*/baz
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
          │       ├── /** ┈> [GET] /foo/* + /foo/**
          │       │       ├── <suffix>
          │       │       │       ├── /sub ┈> [GET] /foo/*/sub
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
        "/foo/*",
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
          │       ├── /** ┈> [GET] /hello/* + /hello/**"
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
        "/hello/*",
      ]
    `);
  });
});

describe("matcher: ordering contract", () => {
  // Documented guarantee (README "Result ordering"): findAllRoutes and
  // compiled matchAll return matches least -> most specific, and for
  // patterns strictly ordered by subsumption the result order agrees with
  // the subsumption order (broader scopes first). Merge/fold consumers
  // (take-last resolution) depend on this — an intentional change to the
  // traversal order is a breaking change, not an internal detail.
  // The guarantee is scoped to patterns without optional syntax — see
  // "matcher: ordering contract: optional-syntax carve-out" below.
  const chain = ["/**", "/api/**", "/api/:v/**", "/api/:v/users/**", "/api/:v/users/:id"];

  it("chain is strictly ordered by subsumption (compareRoutes)", () => {
    for (let i = 0; i < chain.length - 1; i++) {
      expect(compareRoutes(chain[i], chain[i + 1]), `${chain[i]} vs ${chain[i + 1]}`).toBe(
        "superset",
      );
    }
  });

  it("result order agrees with subsumption order, regardless of insertion order", () => {
    for (const routes of [chain, [...chain].reverse()]) {
      const router = createRouter(routes);
      // `_findAllRoutes` also asserts compiled matchAll returns the same order.
      expect(_findAllRoutes(router, "GET", "/api/v1/users/42")).toEqual(chain);
    }
  });
});

describe("matcher: optional param after a capture in its segment", () => {
  // `*-:x?` is one entry (its regex is compiled in place), so the route is
  // listed once, with URLPattern's split: the greedy `*` takes what it can.
  // Same-node siblings keep the weight order (regex + required last param).
  const router = createRouter(["/g/*-", "/g/*-:x?", "/g/:id"]);

  it("lists the route once, ordered by weight", () => {
    for (const routes of [
      ["/g/*-", "/g/*-:x?", "/g/:id"],
      ["/g/:id", "/g/*-:x?", "/g/*-"],
    ]) {
      expect(_findAllRoutes(createRouter(routes), "GET", "/g/--")).toEqual(
        ["/g/:id"].concat(routes.filter((r) => r !== "/g/:id")),
      );
    }
    expect(_findAllRoutes(router, "GET", "/g/a-b")).toEqual(["/g/:id", "/g/*-:x?"]);
  });

  it("weighs as a regex param, also after a lone `:name`", () => {
    // `:a:b?` is one regex (it was `:a:b` + a plain `:a`): it ties a
    // constrained sibling on `/e/1` too, and registration order decides.
    for (const routes of [
      ["/e/:id(\\d+)", "/e/:a:b?"],
      ["/e/:a:b?", "/e/:id(\\d+)"],
    ]) {
      expect(_findAllRoutes(createRouter(routes), "GET", "/e/1")).toEqual(routes);
      expect(_findAllRoutes(createRouter(routes), "GET", "/e/12")).toEqual(routes);
    }
  });

  it("params", () => {
    const params = (m: { params?: object }) => ({ ...m.params });
    expect(findAllRoutes(router, "GET", "/g/--").map(params)).toStrictEqual([
      { id: "--" },
      { "0": "-" },
      { "0": "-" },
    ]);
    expect(compileRouter(router, { matchAll: true })("GET", "/g/--").map(params)).toStrictEqual([
      { id: "--" },
      { "0": "-" },
      { "0": "-" },
    ]);
  });
});

describe("matcher: ordering contract: optional-syntax carve-out", () => {
  // Pins the *known-divergent* half of the ordering contract, documented in
  // README "Result ordering" (the "Carve-out — optional syntax" bullet).
  // `findAllRoutes` orders tree entries (post-`expandModifiers`); `compareRoutes`
  // compares whole patterns. A pattern with `:name?`/`:name*`/`{...}?` registers
  // several entries, so a pattern-level superset can be ordered last. These
  // assertions exist so the carve-out cannot silently drift — they are not a
  // statement that the order is desirable.
  // `_findAllRoutes` also asserts compiled matchAll returns the same order.

  it("A1: byte-identical expansion — registration order decides", () => {
    expect(compareRoutes("/admin/:page?", "/admin")).toBe("superset");
    // `/admin/:page?` expands to `/admin` + `/admin/:page`; the matched entry is
    // an equal-specificity sibling of the static `/admin`, so the tie is broken
    // by insertion order and the two registration orders disagree.
    const first = _findAllRoutes(createRouter(["/admin", "/admin/:page?"]), "GET", "/admin");
    const second = _findAllRoutes(createRouter(["/admin/:page?", "/admin"]), "GET", "/admin");
    expect(first).toEqual(["/admin", "/admin/:page?"]);
    expect(second).toEqual(["/admin/:page?", "/admin"]);
    expect(first).not.toEqual(second);
  });

  it("A1: `:id*` vs `:id+` and `{/b}?` vs the expanded route", () => {
    expect(compareRoutes("/p/:id*", "/p/:id+")).toBe("superset");
    expect(_findAllRoutes(createRouter(["/p/:id+", "/p/:id*"]), "GET", "/p/a")).toEqual([
      "/p/:id+",
      "/p/:id*",
    ]);
    expect(_findAllRoutes(createRouter(["/p/:id*", "/p/:id+"]), "GET", "/p/a")).toEqual([
      "/p/:id*",
      "/p/:id+",
    ]);

    expect(compareRoutes("/p/a{/b}?", "/p/a/b")).toBe("superset");
    expect(_findAllRoutes(createRouter(["/p/a/b", "/p/a{/b}?"]), "GET", "/p/a/b")).toEqual([
      "/p/a/b",
      "/p/a{/b}?",
    ]);
    expect(_findAllRoutes(createRouter(["/p/a{/b}?", "/p/a/b"]), "GET", "/p/a/b")).toEqual([
      "/p/a{/b}?",
      "/p/a/b",
    ]);
  });

  it("A2: same node — no provable instance, `:x*` doesn't contain `**`", () => {
    // `:path*` is `**:path` (needs a value) plus the route without it, so it
    // misses `/api/v1//`, which `**` takes: a subset, and the tree order
    // (weight: `**:path` is narrower) agrees with it.
    expect(compareRoutes("/api/:v/:path*", "/api/:v/**")).toBe("subset");
    for (const routes of [
      ["/api/:v/:path*", "/api/:v/**"],
      ["/api/:v/**", "/api/:v/:path*"],
    ]) {
      expect(_findAllRoutes(createRouter(routes), "GET", "/api/v1/x")).toEqual([
        "/api/:v/**",
        "/api/:v/:path*",
      ]);
    }
  });

  it("A3: matched entries in different nodes, traversal order decides (both orders)", () => {
    // `/p/:id{/**}?` matches `/p/a/` twice: through `/p/:id/**` (a child,
    // first) and `/p/:id` (the node itself, after the `*` child of
    // `/p/:id/*`, which takes nothing after the trailing slash). The two
    // match the same paths (a trailing `*` is optional).
    expect(compareRoutes("/p/:id{/**}?", "/p/:id/*")).toBe("equal");
    for (const routes of [
      ["/p/:id{/**}?", "/p/:id/*"],
      ["/p/:id/*", "/p/:id{/**}?"],
    ]) {
      expect(_findAllRoutes(createRouter(routes), "GET", "/p/a/")).toEqual([
        "/p/:id{/**}?",
        "/p/:id/*",
        "/p/:id{/**}?",
      ]);
    }
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

describe("matcher: required params need a value", () => {
  // `_findAllRoutes` asserts interpreter and compiled matchAll agree.
  const router = createRouter([
    "/a/**",
    "/a/**:rest",
    "/a/:x",
    "/a/*",
    "/a/:y*",
    "/a/:z+/b",
    "/a/:id(\\d*)",
    "/a/:x/c",
    "/**/:file",
    "/**/c",
  ]);

  it("leaves out `:name` / `:name+` / `:name*` / `**:name` on an empty value", () => {
    // On their node: `**` (none or more), then `*` (one or more, may be
    // empty), then `**:rest` / `:y*` (need a value)
    expect(_findAllRoutes(router, "GET", "/a//")).toEqual(["/a/**", "/a/*", "/a/:id(\\d*)"]);
    expect(_findAllRoutes(router, "GET", "/a/1")).toEqual([
      "/**/:file",
      "/a/**",
      "/a/*",
      "/a/**:rest",
      "/a/:y*",
      "/a/:x",
      "/a/:id(\\d*)",
    ]);
    expect(_findAllRoutes(router, "GET", "/a//b")).toEqual([
      "/**/:file",
      "/a/**",
      "/a/*",
      "/a/**:rest",
      "/a/:y*",
    ]);
    expect(_findAllRoutes(router, "GET", "/a///b")).toEqual([
      "/**/:file",
      "/a/**",
      "/a/*",
      "/a/**:rest",
      "/a/:y*",
      "/a/:z+/b",
    ]);
    expect(_findAllRoutes(router, "GET", "/a//c")).toEqual([
      "/**/:file",
      "/a/**",
      "/a/*",
      "/a/**:rest",
      "/a/:y*",
      "/**/c",
    ]);
    expect(_findAllRoutes(router, "GET", "//")).toEqual([]);
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

  it("ignores only one trailing slash (`/`, `//`, `/a/`, `/a//`) (#209)", () => {
    // Required wildcards/params don't match an empty path...
    expect(_findAllRoutes(createRouter(["/**:all"]), "GET", "/")).toEqual([]);
    expect(_findAllRoutes(createRouter(["/:x"]), "GET", "/")).toEqual([]);
    expect(_findAllRoutes(createRouter(["/a/**:x"]), "GET", "/a/")).toEqual([]);
    // ...nor the real empty segment the second slash of `//` ends (they need
    // a value), while `*` and `**` take it.
    expect(_findAllRoutes(createRouter(["/**:all"]), "GET", "//")).toEqual([]);
    expect(_findAllRoutes(createRouter(["/:x"]), "GET", "//")).toEqual([]);
    expect(_findAllRoutes(createRouter(["/a/**:x"]), "GET", "/a//")).toEqual([]);
    expect(_findAllRoutes(createRouter(["/*"]), "GET", "//")).toEqual(["/*"]);
    expect(_findAllRoutes(createRouter(["/a/**"]), "GET", "/a//")).toEqual(["/a/**"]);
    // Static routes, root included, don't match beyond one trailing slash.
    expect(_findAllRoutes(createRouter(["/"]), "GET", "/")).toEqual(["/"]);
    expect(_findAllRoutes(createRouter(["/"]), "GET", "//")).toEqual([]);
    expect(_findAllRoutes(createRouter(["/a"]), "GET", "/a//")).toEqual([]);
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

  it("a trailing `*` matches `/foo` and `/foo/`, required params don't", () => {
    // A `*` is a catch-all on the wildcard node, a `:id` a param node: at the
    // end of the path only the `*` can match (it is optional there).
    for (const routes of [
      ["/foo/*", "/foo/:id"],
      ["/foo/:id", "/foo/*"],
      ["/foo/*", "/foo/:id(\\d+)"],
    ]) {
      expect(_findAllRoutes(createRouter(routes), "GET", "/foo")).toEqual(["/foo/*"]);
      expect(_findAllRoutes(createRouter(routes), "GET", "/foo/")).toEqual(["/foo/*"]);
    }
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

describe("matcher: out-of-bounds segment vs literal 'undefined' key", () => {
  // At end of path `segments[index]` is `undefined`; a static-child lookup
  // with that key must not coerce to a literal "undefined" segment route
  // (the compiled matcher's bound checks were already immune).
  const router = createEmptyRouter<{ path: string }>();
  addRoute(router, "GET", "/undefined/*", { path: "/undefined/*" });
  addRoute(router, "GET", "/w1/undefined/**", { path: "/w1/undefined/**" });
  addRoute(router, "GET", "/w1", { path: "/w1" });

  it("does not match phantom 'undefined' segments", () => {
    expect(_findAllRoutes(router, "GET", "/")).toEqual([]);
    expect(_findAllRoutes(router, "GET", "/w1")).toEqual(["/w1"]);
    // a real "undefined" segment still matches normally
    expect(_findAllRoutes(router, "GET", "/undefined")).toEqual(["/undefined/*"]);
    expect(_findAllRoutes(router, "GET", "/undefined/")).toEqual(["/undefined/*"]);
    expect(_findAllRoutes(router, "GET", "/w1/undefined")).toEqual(["/w1/undefined/**"]);
  });
});

describe("matcher: method-agnostic entries", () => {
  // `_findAllRoutes` asserts interpreter and compiled matchAll agree.
  // A node's method-agnostic (`""`) entries and its method-scoped ones are
  // siblings: both are returned, the `""` ones first on equal weight (a
  // method-scoped registration used to hide them, see
  // test/method-agnostic.test.ts). Each entry is emitted once.

  it("the agnostic sibling on a wildcard node is kept", () => {
    const router = createEmptyRouter<{ path: string }>();
    addRoute(router, "", "/api/**", { path: "AGN" });
    addRoute(router, "GET", "/api/**", { path: "GET-DATA" });
    expect(_findAllRoutes(router, "GET", "/api/x")).toEqual(["AGN", "GET-DATA"]);
    expect(_findAllRoutes(router, "POST", "/api/x")).toEqual(["AGN"]);
  });

  it("the order is independent of registration order", () => {
    const router = createEmptyRouter<{ path: string }>();
    addRoute(router, "GET", "/api/**", { path: "GET-DATA" });
    addRoute(router, "", "/api/**", { path: "AGN" });
    expect(_findAllRoutes(router, "GET", "/api/x")).toEqual(["AGN", "GET-DATA"]);
    expect(_findAllRoutes(router, "POST", "/api/x")).toEqual(["AGN"]);
  });

  it("static and param nodes behave the same way", () => {
    const router = createEmptyRouter<{ path: string }>();
    addRoute(router, "", "/api", { path: "S-AGN" });
    addRoute(router, "GET", "/api", { path: "S-GET" });
    addRoute(router, "", "/api/:id", { path: "P-AGN" });
    addRoute(router, "GET", "/api/:id", { path: "P-GET" });
    expect(_findAllRoutes(router, "GET", "/api")).toEqual(["S-AGN", "S-GET"]);
    expect(_findAllRoutes(router, "POST", "/api")).toEqual(["S-AGN"]);
    expect(_findAllRoutes(router, "GET", "/api/1")).toEqual(["P-AGN", "P-GET"]);
    expect(_findAllRoutes(router, "POST", "/api/1")).toEqual(["P-AGN"]);
    expect(_findAllRoutes(router, "", "/api/1")).toEqual(["P-AGN"]);
  });

  it("orders both buckets by specificity (ordering contract)", () => {
    // `/api/*` is a superset of `/api/:id(\d+)`, so it comes first whichever
    // bucket each is in
    expect(compareRoutes("/api/*", "/api/:id(\\d+)")).toBe("superset");
    for (const [broad, narrow] of [
      ["", "GET"],
      ["GET", ""],
    ]) {
      const router = createEmptyRouter<{ path: string }>();
      addRoute(router, narrow, "/api/:id(\\d+)", { path: "narrow" });
      addRoute(router, broad, "/api/*", { path: "broad" });
      expect(_findAllRoutes(router, "GET", "/api/1")).toEqual(["broad", "narrow"]);
    }
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
