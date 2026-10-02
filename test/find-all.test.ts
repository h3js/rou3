import { describe, it, expect } from "vitest";
import { createRouter, formatTree } from "./_utils.ts";
import {
  addRoute,
  compareRoutes,
  createRouter as createEmptyRouter,
  findAllRoutes,
  findRoute,
  type RouterContext,
} from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";
import { _findRanked } from "../src/operations/find-all.ts";
import type { MethodData } from "../src/types.ts";
import { splitPath } from "../src/operations/_utils.ts";
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

  it("lists a containing route before a contained one (sweep)", () => {
    // Every pair of patterns `compareRoutes` orders strictly, in both
    // registration orders, on every path both match: the broader one comes
    // first in `findAllRoutes` and compiled matchAll (JIT and AOT), and
    // `findRoute` never picks it. With optional syntax, results are ordered by
    // the entry (variant) that matched: a pattern-level miss is the documented
    // carve-out only when no matched entry of the broader pattern is itself
    // strictly broader (match sets over `SWEEP_PATHS`) than one of the
    // narrower pattern listed before it, or as carve-out B (a `**:name` before
    // a `:name` and a catch-all over its segments, see `orderMisses`). A `*`
    // is a catch-all, ordered by its weight (between `**` and `**:name` on a
    // shared node).
    const failures: string[] = [];
    const carveOuts = new Set<string>();
    let checks = 0;
    for (let i = 0; i < SWEEP_PATTERNS.length; i++) {
      for (let j = i + 1; j < SWEEP_PATTERNS.length; j++) {
        const relation = compareRoutes(SWEEP_PATTERNS[i], SWEEP_PATTERNS[j]);
        if (relation !== "superset" && relation !== "subset") continue;
        const [a, b] =
          relation === "superset"
            ? [SWEEP_PATTERNS[i], SWEEP_PATTERNS[j]]
            : [SWEEP_PATTERNS[j], SWEEP_PATTERNS[i]];
        for (const routes of [
          [a, b],
          [b, a],
        ]) {
          checks++;
          const miss = orderMisses(routes, a, b);
          if (miss.failure) failures.push(miss.failure);
          for (const path of miss.carveOuts) carveOuts.add(`${routes.join(", ")} @ ${path}`);
        }
      }
    }
    // 5,087 pairs x 2 registration orders
    expect(checks).toBeGreaterThanOrEqual(10_000);
    expect(failures.slice(0, 20)).toEqual([]);
    // Stale guard: the documented carve-outs still show up as such
    for (const carveOut of KNOWN_CARVE_OUTS) expect(carveOuts).toContain(carveOut);
  }, 60_000);
});

describe("matcher: optional param after a capture in its segment", () => {
  // `*-:x?` is one entry (its regex is compiled in place), so the route is
  // listed once, with URLPattern's split: the greedy `*` takes what it can.
  // Same-node siblings keep the weight order (regex + required last param).
  const router = createRouter(["/g/*-", "/g/*-:x?", "/g/:id"]);

  it("lists the route once, ordered by weight", () => {
    // `*-:x?` ⊋ `*-`: same weight, but its optional `:x?` ranks it lower
    for (const routes of [
      ["/g/*-", "/g/*-:x?", "/g/:id"],
      ["/g/:id", "/g/*-:x?", "/g/*-"],
    ]) {
      expect(_findAllRoutes(createRouter(routes), "GET", "/g/--")).toEqual([
        "/g/:id",
        "/g/*-:x?",
        "/g/*-",
      ]);
    }
    expect(_findAllRoutes(router, "GET", "/g/a-b")).toEqual(["/g/:id", "/g/*-:x?"]);
  });

  it("weighs as a regex param, also after a lone `:name`", () => {
    // `:a:b?` is one regex (it was `:a:b` + a plain `:a`): it weighs what a
    // constrained sibling does, which ranks above it (a constraint, `rank`)
    // in either registration order: `:id(\\d+)` ⊊ `:a:b?` (≡ `:id`).
    for (const routes of [
      ["/e/:id(\\d+)", "/e/:a:b?"],
      ["/e/:a:b?", "/e/:id(\\d+)"],
    ]) {
      const expected = ["/e/:a:b?", "/e/:id(\\d+)"];
      expect(_findAllRoutes(createRouter(routes), "GET", "/e/1")).toEqual(expected);
      expect(_findAllRoutes(createRouter(routes), "GET", "/e/12")).toEqual(expected);
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

// `/p` or `/:x0`, then up to two of these (a group joins without a `/`):
// pairs that differ only below the first segment, or in its kind
const SWEEP_PATTERNS = (() => {
  const tokens = ["p", ":x", ":x(\\d+)", "*", "**", "**:r", ":x+", ":x*", "{/:x}?", "{/p}?"];
  const patterns: string[] = [];
  const build = (route: string, depth: number, n: number) => {
    patterns.push(route);
    if (depth === 0) return;
    for (const token of tokens) {
      const named = token.replace(":x", `:x${n}`);
      const next = n + (named === token ? 0 : 1);
      build(route + (token.startsWith("{") ? named : `/${named}`), depth - 1, next);
    }
  };
  build("/p", 2, 0);
  build("/:x0", 2, 1);
  // Two catch-alls throw
  return patterns.filter((route) => {
    try {
      addRoute(createEmptyRouter(), "", route, route);
      return true;
    } catch {
      return false;
    }
  });
})();

// Up to four segments of `p`, `1` (a `\d+`) and `""` (an empty segment, which
// a `:name` / `**:name` can't take), with and without a trailing slash
const SWEEP_PATHS = (() => {
  const paths = new Set(["/", "//"]);
  const walk = (prefix: string, depth: number) => {
    for (const segment of ["p", "1", ""]) {
      const path = `${prefix}/${segment}`;
      paths.add(path).add(`${path}/`);
      if (depth > 1) walk(path, depth - 1);
    }
  };
  walk("", 4);
  return [...paths];
})();

/**
 * Documented carve-outs (README, `.agents/matching.md`), as
 * `<registration order> @ <path>`: the broader pattern comes last.
 */
const KNOWN_CARVE_OUTS = [
  // A1: identical matched entries, registration order decides
  "/p/:x0, /p/:x0{/p}? @ /p/p",
  "/p/:x0/**:r, /p/:x0/:x1* @ /p/p/p",
  // A4: listed once, by the variant `findRoute` picks (`/p/*/p`, ranked from
  // the end); its broader `/p/*` variant, listed before, is left out
  "/p/*{/p}?, /p/p/:x0 @ /p/p/p",
  "/p/p/:x0, /p/*{/p}? @ /p/p/p",
  // B: a `**:name` before a `:name` and a catch-all over its segments
  "/p/:x0/*, /p/:x0+ @ /p/p/p",
  "/p/:x0+, /p/:x0/** @ /p/p",
];

/**
 * Checks `routes` (`a` strictly contains `b`) on every path both match.
 * `failure`: a contract violation; `carveOuts`: the paths of pattern-level
 * misses the matched entries explain (optional syntax only).
 */
function orderMisses(
  routes: string[],
  a: string,
  b: string,
): { failure?: string; carveOuts: string[] } {
  const both = pathsOf(b).filter((p) => pathsOf(a).includes(p));
  if (both.length === 0) return { carveOuts: [] };
  const router = createEmptyRouter<string>();
  for (const route of routes) addRoute(router, "", route, route);
  const jit = compileRouter(router, { matchAll: true });
  const aot = new Function(`return ${compileRouterToString(router, { matchAll: true })}`)();
  // The paths each matched entry matches (on a miss only)
  let matched: Map<object, Set<number>> | undefined;
  const pathsOfEntry = (entry: object) => {
    if (!matched) {
      matched = new Map();
      for (let p = 0; p < SWEEP_PATHS.length; p++) {
        for (const entry of _findRanked(router, "", segmentsOf(SWEEP_PATHS[p]))) {
          if (!matched.has(entry)) matched.set(entry, new Set());
          matched.get(entry)!.add(p);
        }
      }
    }
    return matched.get(entry)!;
  };
  // `x`'s match set strictly contains `y`'s (`same`: equals it)
  const broader = (x: object, y: object, same?: boolean) => {
    const [setX, setY] = [pathsOfEntry(x), pathsOfEntry(y)];
    return (
      (same ? setX.size === setY.size : setX.size > setY.size) &&
      [...setY].every((p) => setX.has(p))
    );
  };
  // B: `x` has a `**:name` (`:x+`, `:x*`, each segment a value) and `y` a
  // `:name` from where it starts, and a `*` / `**` (`/p/:x0/*` ⊋ `/p/:x0+`):
  // the tree lists wildcards before params
  const catchAllFirst = (y: MethodData<unknown>, x: MethodData<unknown>) => {
    const start = x.paramsMap?.find(([i, , optional, empty]) => i < 0 && !optional && !empty);
    return (
      !!start &&
      !!y.paramsMap?.some(([i, name]) => i >= ~start[0] && typeof name === "string") &&
      y.paramsMap.some(([i, , optional, empty]) => i < 0 && (optional || empty))
    );
  };
  // Optional syntax: `{…}?`, `:x?`, `:x*` (a `*` is a catch-all, no modifier)
  const optional = /[{?]|:x\d+\*/.test(`${a} ${b}`);
  const carveOuts: string[] = [];
  for (const p of both) {
    const path = SWEEP_PATHS[p];
    const all = findAllRoutes(router, "", path);
    const data = all.map((m) => m.data);
    const at = `[${routes.join(", ")}] @ ${path}: ${JSON.stringify(data)}`;
    const json = JSON.stringify(all);
    if (JSON.stringify(jit("", path)) !== json || JSON.stringify(aot("", path)) !== json) {
      return { failure: `compiled matchAll differs: ${at}`, carveOuts };
    }
    const list = _findRanked(router, "", segmentsOf(path));
    if (data.indexOf(a) > data.indexOf(b)) {
      // `b`'s entry before a strictly broader one of `a`: not an optional-
      // syntax carve-out, only B
      const misses = list.flatMap((x, k) =>
        x.data === b
          ? list
              .slice(k + 1)
              .filter((y) => y.data === a && broader(y, x))
              .map((y) => [y, x] as const)
          : [],
      );
      if (misses.length > 0) {
        if (!misses.every(([y, x]) => catchAllFirst(y, x))) {
          return { failure: `${a} ⊋ ${b} listed after it: ${at}`, carveOuts };
        }
      } else {
        if (!optional) return { failure: `${a} ⊋ ${b} listed after it: ${at}`, carveOuts };
        // Every optional-syntax carve-out is A1: an entry of `b` before one
        // of `a` with the same match set (A2 / A3 have no strict instance,
        // see matching.md), or A4: a route is listed once, by the entry
        // `findRoute` picks, and an entry of `a` before `b`'s is left out
        const a1 = list.some(
          (x, k) =>
            x.data === b && list.slice(k + 1).some((y) => y.data === a && broader(y, x, true)),
        );
        const a4 =
          list.findIndex((x) => x.data === a) < list.findIndex((x) => x.data === b) &&
          list.filter((x) => x.data === a).length > 1;
        if (!a1 && !a4) return { failure: `carve-out other than A1 / A4: ${at}`, carveOuts };
      }
      carveOuts.push(path);
    }
    // `findRoute` picks the last of `_findRanked(…, reverse)`: never an entry
    // of `a` strictly broader than one of `b` (but B)
    const found = findRoute(router, "", path)?.data;
    if (found === a) {
      const pick = _findRanked(router, "", segmentsOf(path), true).at(-1)!;
      const narrower = list.filter((x) => x.data === b && broader(pick, x));
      if (
        pick.data !== a ||
        (narrower.length === 0 ? !optional : !narrower.every((x) => catchAllFirst(pick, x)))
      ) {
        return { failure: `findRoute picks ${a} over ${b}: ${at}`, carveOuts };
      }
    }
  }
  return { carveOuts };
}

const PATTERN_PATHS = new Map<string, number[]>();

/** The indexes in `SWEEP_PATHS` of the paths `pattern` alone matches. */
function pathsOf(pattern: string): number[] {
  let paths = PATTERN_PATHS.get(pattern);
  if (!paths) {
    const router = createEmptyRouter();
    addRoute(router, "", pattern, pattern);
    paths = SWEEP_PATHS.flatMap((path, p) => (findRoute(router, "", path) ? [p] : []));
    PATTERN_PATHS.set(pattern, paths);
  }
  return paths;
}

/** The segments `findAllRoutes` matches `path` as. */
function segmentsOf(path: string): string[] {
  return splitPath(path.endsWith("/") ? path.slice(0, -1) : path);
}

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
    // `/p/:id/*`). It is listed once, by the entry `findRoute` picks
    // (`/p/:id`). The two match the same paths (a trailing `*` is optional),
    // so this pins the order only.
    expect(compareRoutes("/p/:id{/**}?", "/p/:id/*")).toBe("equal");
    for (const routes of [
      ["/p/:id{/**}?", "/p/:id/*"],
      ["/p/:id/*", "/p/:id{/**}?"],
    ]) {
      expect(_findAllRoutes(createRouter(routes), "GET", "/p/a/")).toEqual([
        "/p/:id/*",
        "/p/:id{/**}?",
      ]);
    }
  });

  it("A4: listed by the entry findRoute picks, a broader one left out (both orders)", () => {
    // `/p/*{/p}?` ⊋ `/p/p/:x` matches `/p/p/p` through `/p/*` (before
    // `/p/p/:x`) and `/p/*/p` (ranked after it from the end: a literal last
    // segment). Listed once, by `/p/*/p`, so the broader pattern comes last.
    expect(compareRoutes("/p/*{/p}?", "/p/p/:x")).toBe("superset");
    for (const routes of [
      ["/p/*{/p}?", "/p/p/:x"],
      ["/p/p/:x", "/p/*{/p}?"],
    ]) {
      const router = createRouter(routes);
      expect(_findAllRoutes(router, "GET", "/p/p/p")).toEqual(["/p/p/:x", "/p/*{/p}?"]);
      expect(findRoute(router, "GET", "/p/p/p")).toEqual({
        data: { path: "/p/*{/p}?" },
        params: { "0": "p" },
      });
    }
  });
});

describe("matcher: ordering contract: catch-all carve-out (B)", () => {
  // Every segment of a `:x+` / `:x*` / `**:name` needs a value (URLPattern),
  // so a route with a `:name` and a `*` / `**` over its segments contains it:
  // it also takes the paths with an empty segment there. The tree lists a
  // node's wildcard before its param child (and a suffix trie's shallower
  // entry first), so the narrower route comes first and `findRoute` picks the
  // broader one. Pinned so that it can't drift; not a statement that the
  // order is desirable (a fix is a global re-sort, as for A3).
  it.each([
    ["/p/:x/**", "/p/:x+", "/p/a/b"],
    ["/p/:x/*", "/p/:x+", "/p/a/b"],
    ["/:a/**/p", "/**:n/p", "/b/c/p"],
    ["/**/:y/p", "/**:n/p", "/b/c/p"],
  ])("%s ⊋ %s, listed after it on %s (both orders)", (broader, narrower, path) => {
    expect(compareRoutes(broader, narrower)).toBe("superset");
    for (const routes of [
      [broader, narrower],
      [narrower, broader],
    ]) {
      const router = createRouter(routes);
      expect(_findAllRoutes(router, "GET", path)).toEqual([narrower, broader]);
      expect(findRoute(router, "GET", path)?.data).toEqual({ path: broader });
    }
  });
});

describe("matcher: each route listed once (optional syntax)", () => {
  // A pattern with optional syntax registers one entry per variant, and
  // several can match one path (`/a/:x?/:y?` on `/a/b`: `/a/:x` and `/a/:y`).
  // The route is listed once, with the params and at the position of the
  // variant `findRoute` picks; separate registrations stay separate.
  type Data = { path: string; id?: string };
  const listAll = (routes: (string | [string, string])[], path: string) => {
    const router = createEmptyRouter<Data>();
    for (const r of routes) {
      const [route, id] = typeof r === "string" ? [r, undefined] : r;
      addRoute(router, "GET", route, id ? { path: route, id } : { path: route });
    }
    const all = findAllRoutes(router, "GET", path);
    const jit = compileRouter(router, { matchAll: true });
    const aot = new Function(`return ${compileRouterToString(router, { matchAll: true })}`)();
    expect(jit("GET", path), `JIT ${path}`).toEqual(all);
    expect(aot("GET", path), `AOT ${path}`).toEqual(all);
    return { all, one: findRoute(router, "GET", path) };
  };

  it.each([
    ["/a/:x?/:y?", "/a/b", { x: "b" }],
    ["/a{/:x}?{/:y}?", "/a/b", { x: "b" }],
    ["/a/:x?/:y(\\d+)?", "/a/1", { y: "1" }],
    ["/a/:x?/:y(\\d+)?", "/a/b", { x: "b" }],
    ["/a/:x(\\d+)?/:y(\\w+)?", "/a/1", { x: "1" }],
    ["/a/:x(\\d+)?/:y(\\w+)?", "/a/b", { y: "b" }],
    ["/v1/:version?/:platform?", "/v1/123", { version: "123" }],
    ["/docs/:version(v\\d+|latest)?/**:slug", "/docs/v2/a/b", { version: "v2", slug: "a/b" }],
    ["/users/:id{.json}?", "/users/1.json", { id: "1" }],
    ["/a{/b}?/:x?", "/a/b", undefined],
    ["/p/:id{/**}?", "/p/a/", { id: "a" }],
    ["/:a?/b/:c?", "/b/b", { c: "b" }],
  ])("%s on %s: one entry, findRoute's params", (route, path, params) => {
    const { all, one } = listAll([route], path);
    expect(all).toEqual([params ? { data: { path: route }, params } : { data: { path: route } }]);
    expect(all).toEqual([one]);
  });

  it("at the position of the variant findRoute picks", () => {
    // `/docs/**:slug` (before `/docs/:v/**`) and `/docs/:version/**:slug`
    // (after it) both match: listed once, after it
    const route = "/docs/:version(v\\d+)?/**:slug";
    for (const routes of [
      [route, "/docs/:v/**"],
      ["/docs/:v/**", route],
    ]) {
      const { all, one } = listAll(routes, "/docs/v2/a");
      expect(all.map((m) => m.data.path)).toEqual(["/docs/:v/**", route]);
      expect(all.at(-1)).toEqual(one);
    }
    // From-end ranking (a suffix route matches): `/:a/b` pins the last segment
    // and beats `/b/:c` there, as in `findRoute`
    for (const routes of [
      ["/:a?/b/:c?", "/**/b"],
      ["/**/b", "/:a?/b/:c?"],
    ]) {
      const { all, one } = listAll(routes, "/b/b");
      expect(all).toEqual([
        { data: { path: "/**/b" }, params: { "0": "b", _: "b" } },
        { data: { path: "/:a?/b/:c?" }, params: { a: "b" } },
      ]);
      expect(all.at(-1)).toEqual(one);
    }
  });

  it("separate registrations of one pattern stay separate", () => {
    const { all, one } = listAll(
      [
        ["/a/:x?/:y?", "first"],
        ["/a/:x?/:y?", "second"],
      ],
      "/a/b",
    );
    expect(all).toEqual([
      { data: { path: "/a/:x?/:y?", id: "first" }, params: { x: "b" } },
      { data: { path: "/a/:x?/:y?", id: "second" }, params: { x: "b" } },
    ]);
    expect(one).toEqual(all[0]);
  });

  it("a route alone is listed as findRoute finds it (sweep)", () => {
    const failures: string[] = [];
    for (const route of SWEEP_PATTERNS) {
      const router = createEmptyRouter<string>();
      addRoute(router, "", route, route);
      const jit = compileRouter(router, { matchAll: true });
      const aot = new Function(`return ${compileRouterToString(router, { matchAll: true })}`)();
      for (const path of SWEEP_PATHS) {
        const one = findRoute(router, "", path);
        const json = JSON.stringify(one ? [one] : []);
        for (const [kind, all] of [
          ["findAllRoutes", findAllRoutes(router, "", path)],
          ["JIT", jit("", path)],
          ["AOT", aot("", path)],
        ] as const) {
          if (JSON.stringify(all) !== json) {
            failures.push(`${kind} ${route} @ ${path}: ${JSON.stringify(all)} vs ${json}`);
          }
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it("lists each registration once, as findRoute finds it, in every matcher (random routers)", () => {
    // Variants on one node (ties, regexes), on several, ranked from the end
    // (`/**/b`), static ones (`/a{/b}?{/b}?`; above 8 static paths the
    // compiler uses a map), duplicate registrations and method-agnostic ones
    const pool = [
      "/a/:x?/:y?",
      "/a{/:x}?{/:y}?",
      "/a/:x(\\d+)?/:y(\\w+)?",
      "/a/:x?/:y(\\d+)?",
      "/:a?/b/:c?",
      "/a{/b}?/:x?",
      "/a{/b}?{/b}?",
      "/a/:id{/**}?",
      "/a/*{/b}?",
      "/a/:x/*",
      "/a/:x?/**:r",
      "/**/b",
      "/:x/**",
      "/a/:x",
      "/a/b",
      "/a",
    ];
    const statics = Array.from({ length: 9 }, (_, i) => `/s${i}`);
    const paths = ["/", "//"];
    for (let depth = 1, prev = [""]; depth <= 3; depth++) {
      prev = prev.flatMap((path) => ["a", "b", "1", ""].map((s) => `${path}/${s}`));
      paths.push(...prev, ...prev.map((p) => `${p}/`));
    }
    let seed = 11;
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    const failures: string[] = [];
    for (let n = 0; n < 200 && failures.length === 0; n++) {
      const router = createEmptyRouter<string>();
      const routes = pool.filter(() => random() < 0.3);
      if (random() < 0.5) routes.push(...statics);
      // A duplicate registration
      if (routes.length > 0 && random() < 0.5) routes.push(routes[0]);
      routes.forEach((route, i) =>
        addRoute(router, random() < 0.2 ? "" : "GET", route, `${route}#${i}`),
      );
      const jit = compileRouter(router, { matchAll: true });
      const aot = new Function(`return ${compileRouterToString(router, { matchAll: true })}`)();
      for (const path of paths) {
        const all = findAllRoutes(router, "GET", path);
        const json = JSON.stringify(all);
        const at = `[${routes.join(", ")}] @ ${path}: ${json}`;
        if (JSON.stringify(jit("GET", path)) !== json) failures.push(`JIT ${at}`);
        if (JSON.stringify(aot("GET", path)) !== json) failures.push(`AOT ${at}`);
        if (new Set(all.map((m) => m.data)).size !== all.length) failures.push(`twice ${at}`);
        const one = findRoute(router, "GET", path);
        const listed = all.find((m) => m.data === one?.data);
        if (JSON.stringify(listed) !== JSON.stringify(one)) failures.push(`findRoute ${at}`);
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
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
    // Nor on an empty segment inside a longer value (URLPattern)
    expect(_findAllRoutes(router, "GET", "/a//b")).toEqual(["/**/:file", "/a/**", "/a/*"]);
    expect(_findAllRoutes(router, "GET", "/a///b")).toEqual(["/**/:file", "/a/**", "/a/*"]);
    expect(_findAllRoutes(router, "GET", "/a/x//b")).toEqual(["/**/:file", "/a/**", "/a/*"]);
    expect(_findAllRoutes(router, "GET", "/a/x/b")).toEqual([
      "/**/:file",
      "/a/**",
      "/a/*",
      "/a/**:rest",
      "/a/:y*",
      "/a/:z+/b",
    ]);
    expect(_findAllRoutes(router, "GET", "/a//c")).toEqual(["/**/:file", "/a/**", "/a/*", "/**/c"]);
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

describe("matcher: mixed-segment siblings rank by literal text, then constraints", () => {
  // Same-node siblings whose regex segments tie on weight are ranked by their
  // literal text, then their constrained captures (`MethodData.rank`), so a
  // narrower mixed segment beats a broader one in either registration order:
  // `findRoute`, `findAllRoutes` and compiled (JIT / AOT, single / matchAll).
  const check = (expected: string[], path: string, method = "GET") => {
    for (const routes of [expected, [...expected].reverse()]) {
      const router = createEmptyRouter<string>();
      for (const route of routes) {
        const [m, p] = route.startsWith("* ") ? ["", route.slice(2)] : ["GET", route];
        addRoute(router, m, p, route);
      }
      const at = `${routes.join(", ")} @ ${path}`;
      const all = findAllRoutes(router, method, path).map((m) => m.data);
      expect(all, at).toEqual(expected);
      const toAot = (matchAll: boolean) =>
        new Function(`return ${compileRouterToString(router, { matchAll })}`)();
      for (const matchAll of [compileRouter(router, { matchAll: true }), toAot(true)]) {
        expect(
          matchAll(method, path).map((m: { data: string }) => m.data),
          at,
        ).toEqual(expected);
      }
      expect(findRoute(router, method, path)?.data, at).toBe(expected.at(-1));
      for (const match of [compileRouter(router), toAot(false)]) {
        expect(match(method, path)?.data, at).toBe(expected.at(-1));
      }
    }
  };

  it("a constrained capture beats a plain one in the same segment", () => {
    check(["/f/:name.:ext", "/f/:name.:ext(png|jpg)"], "/f/a.png");
    check(["/f/:name.:ext"], "/f/a.gif");
    check(["/f/:a-:b", "/f/:a-:b(\\d+)"], "/f/x-1");
  });

  it("more literal text beats less", () => {
    check(["/f/:name.:ext", "/f/:name.png"], "/f/a.png");
    check(["/f/:name.:ext", "/f/:name.png"], "/f/a.b.png");
    check(["/f/:a-:b", "/f/x-:b"], "/f/x-x");
    check(["/f/:a.:b", "/f/:a.:b.:c"], "/f/a.b.c");
  });

  it("literal text beats a constraint", () => {
    // `:name.png` ⊊ `:name.:ext(png|jpg)`
    check(["/f/:name.:ext", "/f/:name.:ext(png|jpg)", "/f/:name.png"], "/f/a.png");
  });

  it("a constraint beats a capture-only regex (`:a:b?` is a `:name`)", () => {
    check(["/f/:a:b?", "/f/:id(\\d+)"], "/f/1");
  });

  it("deeper routes, wildcard nodes and suffix tries", () => {
    check(["/f/:name.:ext/x", "/f/:name.png/x"], "/f/a.png/x");
    check(["/f/:name.:ext/**", "/f/:name.png/**"], "/f/a.png/b");
    check(["/f/:name.:ext/*", "/f/:name.png/*"], "/f/a.png");
    check(["/**/:name.:ext", "/**/:name.png"], "/f/a.png");
    check(["/**/:name.:ext", "/**/:name.:ext(png)"], "/a.png");
  });

  it("method-agnostic siblings", () => {
    check(["* /f/:name.:ext", "/f/:name.png"], "/f/a.png");
    check(["/f/:name.:ext", "* /f/:name.png"], "/f/a.png");
  });

  it("never ranks a strictly broader segment higher (sweep)", () => {
    // Every pair of segments whose match sets (over all strings of up to five
    // of `a`, `p`, `.`, `1`, and `""`) strictly contain one another, on a
    // param node, after a `**` (suffix trie) and before one (wildcard node):
    // in no registration order is the broader listed after the narrower
    // (`findAllRoutes`, compiled matchAll JIT / AOT) or picked (`findRoute`,
    // compiled), unless the two tie (registration order decides: listed
    // last in one order only), pinned in `ties`. Known exception (none here):
    // a constraint standing in for literal text the broader segment writes
    // out (`:x(p\\.p)` ⊊ `p.:b`), or one restricting nothing (`:a(.+).:b`).
    const words = [""];
    for (let n = 0; n < 5; n++) {
      for (const w of words.filter((w) => w.length === n)) {
        for (const c of "ap.1") words.push(w + c);
      }
    }
    // A trailing slash is ignored: `""` is an empty last segment
    const shapes: [string, (segment: string) => string][] = [
      ["/f/", (s) => `/f/${s}/`],
      ["/**/", (s) => `/x/${s}/`],
      ["/f/<>/**", (s) => `/f/${s}/x`],
    ];
    const allSegments = [
      [":id", ":id(\\d+)", ":id(\\d*)", ":a:b?", ":a(\\d+):b?", "p:a", ":a.", ".:b"],
      [":a.:b", ":a.p", "p.:b", ":a.:b(p)", ":a.:b(p|1)", ":a.:b(\\d+)", ":a.:b?"],
      [":a.:b(p)?", ":a.:b(\\d*)", ":a(\\d+).:b", ":a.:b.:c", ":a.p.:c", "*.p", "p*", "p.*"],
    ].flat();
    const failures: string[] = [];
    const ties = new Set<string>();
    let pairs = 0;
    let proven = 0;
    for (const [shape, toPath] of shapes) {
      const route = (s: string) => (shape.includes("<>") ? shape.replace("<>", s) : shape + s);
      // A `*` is a catch-all: one per route
      const segments = allSegments.filter((s) => shape === "/f/" || !s.includes("*"));
      const sets = segments.map((s) => {
        const router = createEmptyRouter<string>();
        addRoute(router, "", route(s), s);
        return new Set(words.filter((w) => findRoute(router, "", toPath(w))));
      });
      for (let i = 0; i < segments.length; i++) {
        for (let j = 0; j < segments.length; j++) {
          const [a, b] = [sets[i], sets[j]];
          // `compareRoutes` claims only what holds (on these paths too)
          const relation = compareRoutes(route(segments[i]), route(segments[j]));
          if (/superset|equal/.test(relation) && ![...b].every((w) => a.has(w))) {
            failures.push(`compareRoutes(${route(segments[i])}, ${route(segments[j])})`);
          }
          if (i === j || a.size <= b.size || ![...b].every((w) => a.has(w))) continue;
          pairs++;
          if (relation === "superset") proven++;
          // `segments[i]` strictly contains `segments[j]`
          const [broad, narrow] = [route(segments[i]), route(segments[j])];
          // Per path: in how many registration orders the broader is last
          const late = new Map<string, number>();
          for (const order of [
            [broad, narrow],
            [narrow, broad],
          ]) {
            const router = createEmptyRouter<string>();
            for (const r of order) addRoute(router, "", r, r);
            const jit = compileRouter(router, { matchAll: true });
            const aot = new Function(
              `return ${compileRouterToString(router, { matchAll: true })}`,
            )();
            const one = compileRouter(router);
            for (const w of b) {
              const path = toPath(w);
              const all = findAllRoutes(router, "", path);
              const data = all.map((m) => m.data);
              const at = `${order.join(", ")} @ ${path}: ${JSON.stringify(data)}`;
              if ([jit, aot].some((f) => JSON.stringify(f("", path)) !== JSON.stringify(all))) {
                failures.push(`compiled matchAll differs: ${at}`);
              }
              const found = findRoute(router, "", path)?.data;
              if (one("", path)?.data !== found) failures.push(`compiled differs: ${at}`);
              if (data.indexOf(broad) > data.indexOf(narrow)) {
                late.set(path, (late.get(path) || 0) + 1);
              }
              const key = `${path} (findRoute)`;
              if (found === broad) late.set(key, (late.get(key) || 0) + 1);
            }
          }
          for (const [path, count] of late) {
            if (count > 1) failures.push(`${broad} ⊋ ${narrow} ranks higher @ ${path}`);
            else ties.add(`${broad} ⊋ ${narrow}`);
          }
        }
      }
    }
    expect(failures.slice(0, 20)).toEqual([]);
    // Strict pairs, and those `compareRoutes` proves (`segmentCovers`): not
    // two different constraints (`(p|1)` ⊋ `(p)`, `(p)?` ⊋ `(p)`), nor a `*`
    // pattern, which also takes more segments (`/f/*.p`: not ⊆ `/f/:id`)
    expect([pairs, proven]).toEqual([200, 183]);
    // Ties: two constraints (compared by count only), or captures that may
    // be `""` on both sides
    expect([...ties].sort()).toEqual([
      "/**/:a.:b(p)? ⊋ /**/:a.",
      "/**/:a.:b(p|1) ⊋ /**/:a.:b(p)",
      "/f/:a.:b(p)? ⊋ /f/:a.",
      "/f/:a.:b(p)?/** ⊋ /f/:a./**",
      "/f/:a.:b(p|1) ⊋ /f/:a.:b(p)",
      "/f/:a.:b(p|1)/** ⊋ /f/:a.:b(p)/**",
      "/f/:a.:b? ⊋ /f/:a.:b(\\d*)",
    ]);
  }, 60_000);

  it("a route's variants that differ in rank are listed once, as findRoute picks", () => {
    // `/f/:n.{png}?` registers `/f/:n.png` and `/f/:n.` on one node: the
    // rank orders them, and `findAllRoutes` keeps the one `findRoute` picks
    check(["/f/:n.:e", "/f/:n.{png}?"], "/f/a.png");
    check(["/f/:n.{png}?"], "/f/a.");
    const router = createEmptyRouter<string>();
    addRoute(router, "", "/f/:n.{png}?", "r");
    for (const path of ["/f/a.png", "/f/a.", "/f/a.b.png"]) {
      const all = findAllRoutes(router, "", path);
      expect(all, path).toEqual([findRoute(router, "", path)]);
      expect(compileRouter(router, { matchAll: true })("", path), path).toEqual(all);
    }
    expect(findRoute(router, "", "/f/a.png")?.params).toEqual({ n: "a" });
  });

  it("known exception: a constraint standing in for literal text", () => {
    // `:x(p\\.p)` ⊊ `p.:b`, but only the broader one has literal text: it
    // ranks higher (a rank compares counts, not match sets)
    check(["/f/:x(p\\.p)", "/f/p.:b"], "/f/p.p");
    expect(compareRoutes("/f/p.:b", "/f/:x(p\\.p)")).toBe("partial");
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
