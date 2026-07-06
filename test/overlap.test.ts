import { describe, it, expect } from "vitest";
import {
  addRoute,
  compareRoutes,
  createRouter,
  findAllRoutes,
  findOverlappingRoutes,
  routesOverlap,
} from "../src/index.ts";
import type { RouteComparison } from "../src/index.ts";

describe("routesOverlap", () => {
  // [patternA, patternB, expectedOverlap, label]
  const cases: [string, string, boolean, string][] = [
    // literal / literal
    ["/a/b", "/a/b", true, "identical literals"],
    ["/a/b", "/a/c", false, "disjoint literals"],
    ["/a", "/a/b", false, "different literal depth"],

    // `**` zero-or-more segments
    ["/a/**", "/a", true, "** matches zero segments"],
    ["/**", "/", true, "root ** matches root"],
    ["/a/**", "/a/b/c", true, "** matches many segments"],
    ["/a/**", "/a/b/c/d/e", true, "** matches arbitrary depth"],

    // named `**:name` is one-or-more
    ["/a/**:rest", "/a", false, "named ** needs >=1 segment"],
    ["/a/**:rest", "/a/b", true, "named ** matches one segment"],

    // `*` vs `:param` vs literal
    ["/a/*", "/a/:x", true, "* overlaps :param"],
    ["/a/*", "/a/b", true, "* overlaps literal"],
    ["/a/:x", "/a/b", true, ":param overlaps literal"],
    ["/a/*", "/a/*", true, "* overlaps *"],

    // trailing bare `*` is zero-or-one
    ["/a/*", "/a", true, "trailing * matches zero segments"],
    ["/a/*", "/a/b/c", false, "trailing * is single-segment"],

    // mid-pattern `*` is exactly one
    ["/a/*/c", "/a/b/c", true, "mid * matches one segment"],
    ["/a/*/c", "/a/c", false, "mid * is not optional"],
    ["/a/*/c", "/a/b/d", false, "mid * with differing suffix"],

    // nested `**` at different depths
    ["/protected/**", "/protected/feed/**", true, "shallow ** vs deep **"],
    ["/**", "/protected/**", true, "root ** vs deep **"],
    ["/protected/feed/**", "/protected/**", true, "deep ** vs shallow ** (symmetric)"],
    ["/a/**", "/a/b/c/d", true, "** vs deeper literal"],

    // disjoint siblings must NOT overlap
    ["/a/**", "/b/**", false, "disjoint sibling wildcards"],
    ["/ab/**", "/a/**", false, "prefix-similar but distinct literals"],
    ["/a/**", "/ab", false, "distinct literal vs wildcard"],

    // regex-constrained: precise vs static, conservative vs dynamic
    ["/user/:id(\\d+)", "/user/42", true, "regex matches static (precise)"],
    ["/user/:id(\\d+)", "/user/abc", false, "regex rejects static (precise)"],
    ["/user/:id(\\d+)", "/user/:name([a-z]+)", true, "regex vs regex (over-approx)"],
    ["/user/:id(\\d+)", "/user/:name", true, "regex vs any (over-approx)"],
    ["/(\\d+)", "/42", true, "unnamed group matches static"],
    ["/(\\d+)", "/ab", false, "unnamed group rejects static"],

    // mid-pattern segment wildcards (`*.png`)
    ["/*.png", "/logo.png", true, "segment wildcard matches static"],
    ["/*.png", "/logo.jpg", false, "segment wildcard rejects static"],
    ["/*.png", "/a/logo.png", false, "segment wildcard is single-segment"],
    ["/file-*-*.png", "/file-a-b.png", true, "multi segment wildcard matches"],
    ["/file-*-*.png", "/file-a.png", false, "multi segment wildcard rejects"],

    // optional / repeat modifiers
    ["/a/:x?", "/a", true, "optional param matches without"],
    ["/a/:x?", "/a/b", true, "optional param matches with"],
    ["/a/:x+", "/a/b/c", true, "repeat+ matches many"],
    ["/a/:x+", "/a", false, "repeat+ needs >=1"],
    ["/a/:x*", "/a", true, "repeat* matches zero"],
    ["/a/:x*", "/a/b/c", true, "repeat* matches many"],

    // non-capturing group delimiters `{...}?`
    ["/a{/b}?", "/a", true, "optional group matches without"],
    ["/a{/b}?", "/a/b", true, "optional group matches with"],
    ["/a{/b}?", "/a/c", false, "optional group rejects other suffix"],

    // escaping
    ["/a/\\:b", "/a/:b", true, "escaped colon is literal, matched by :param"],
    ["/a/\\:b", "/a/x", false, "escaped colon literal vs other literal"],
    ["/a/\\*", "/a/*", true, "escaped star is literal, matched by wildcard"],
    ["/a/\\*", "/a/x", false, "escaped star literal vs other literal"],
  ];

  for (const [a, b, expected, label] of cases) {
    it(`${label}: ${a} <> ${b} => ${expected}`, () => {
      expect(routesOverlap(a, b)).toBe(expected);
      // Overlap is symmetric.
      expect(routesOverlap(b, a)).toBe(expected);
    });
  }
});

describe("compareRoutes", () => {
  // [patternA, patternB, expected, label] — the inverse direction is derived.
  const cases: [string, string, RouteComparison, string][] = [
    // literal / literal
    ["/a/b", "/a/b", "equal", "identical literals"],
    ["/a/b", "/a/c", "disjoint", "disjoint literals"],
    ["/a", "/a/b", "disjoint", "different literal depth"],

    // `**` zero-or-more segments
    ["/a/**", "/a/b", "subsumes", "** vs literal below it"],
    ["/a/**", "/a", "subsumes", "** matches zero segments"],
    ["/a/**", "/a/b/c/d", "subsumes", "** vs deep literal"],
    ["/**", "/a/**", "subsumes", "root ** vs deep **"],
    ["/a/**", "/a/**", "equal", "identical wildcards"],
    ["/a/**", "/b/**", "disjoint", "disjoint sibling wildcards"],

    // named `**:name` is one-or-more
    ["/a/**:rest", "/a", "disjoint", "named ** needs >=1 segment"],
    ["/a/**", "/a/**:rest", "subsumes", "bare ** also matches zero segments"],
    ["/a/**:rest", "/a/b/**", "subsumes", "named ** vs deeper **"],
    ["/a/**:x", "/a/**:y", "equal", "match-sets compare, names don't"],

    // `*` / `:param` single segments
    ["/a/:x", "/a/b", "subsumes", ":param vs literal"],
    ["/a/:x", "/a/:y", "equal", "params equal regardless of name"],
    ["/a/*", "/a/:x", "subsumes", "trailing * also matches zero segments"],
    ["/a/*/c", "/a/:x/c", "equal", "mid * is exactly one, like :param"],
    ["/a/**", "/a/:x", "subsumes", "** vs :param"],

    // partial overlap (the pre-merge ambiguity case)
    ["/a/*/c", "/a/b/*", "partial", "crossing dynamic segments"],
    ["/a/**", "/*/b", "partial", "deep wildcard vs fixed-depth suffix"],

    // optional / repeat modifiers (multi-shape patterns)
    ["/a/:x?", "/a/*", "equal", "optional param == trailing *"],
    ["/a/:x?", "/a", "subsumes", "optional param matches without"],
    ["/a/:x*", "/a/**", "equal", "repeat* == bare **"],
    ["/a/:x+", "/a/**:rest", "equal", "repeat+ == named **"],
    ["/a/:x+", "/a/**", "subsumed", "repeat+ needs >=1, ** doesn't"],

    // non-capturing group delimiters `{...}?`
    ["/a{/b}?", "/a", "subsumes", "optional group matches without"],
    ["/a{/b}?", "/a/*", "subsumed", "optional group is a subset of trailing *"],
    ["/a{/b}?", "/a/c", "disjoint", "optional group rejects other suffix"],

    // regex-constrained segments
    ["/user/:id(\\d+)", "/user/42", "subsumes", "regex accepts literal (precise)"],
    ["/user/:id(\\d+)", "/user/abc", "disjoint", "regex rejects literal (precise)"],
    ["/user/:id(\\d+)", "/user/:id(\\d+)", "equal", "identical regex sources"],
    ["/user/:id(\\d+)", "/user/:x", "subsumed", "any-param covers regex"],
    ["/user/:id(\\d+)", "/user/:n([a-z]+)", "partial", "regex vs regex (undecidable)"],
    ["/user/:id(\\d+)", "/user/**", "subsumed", "wildcard covers regex"],

    // escaping
    ["/a/\\*", "/a/*", "subsumed", "escaped star is one literal of trailing *"],
    ["/a/\\:b", "/a/:b", "subsumed", "escaped colon is one literal of :param"],
    ["/a/\\*", "/a/\\*", "equal", "identical escaped literals"],
  ];

  const inverse: Record<RouteComparison, RouteComparison> = {
    disjoint: "disjoint",
    equal: "equal",
    subsumes: "subsumed",
    subsumed: "subsumes",
    partial: "partial",
  };

  for (const [a, b, expected, label] of cases) {
    it(`${label}: ${a} <> ${b} => ${expected}`, () => {
      expect(compareRoutes(a, b)).toBe(expected);
      expect(compareRoutes(b, a)).toBe(inverse[expected]);
    });
  }

  it("agrees with routesOverlap on the overlap question", () => {
    for (const [a, b] of cases) {
      expect(compareRoutes(a, b) !== "disjoint").toBe(routesOverlap(a, b));
    }
  });
});

describe("findOverlappingRoutes", () => {
  it("resolves an inherited/merged config scope (least -> most specific)", () => {
    const router = createRouter<Record<string, unknown>>();
    addRoute(router, "GET", "/**", { isr: true });
    addRoute(router, "GET", "/protected/**", { basicAuth: true });
    addRoute(router, "GET", "/protected/feed/**", { isr: 60 });
    addRoute(router, "GET", "/public/**", { isr: true });

    const matches = findOverlappingRoutes(router, "GET", "/protected/feed/**");
    expect(matches.map((m) => m.data)).toEqual([
      { isr: true }, // /**
      { basicAuth: true }, // /protected/**
      { isr: 60 }, // /protected/feed/**
    ]);
    // A pattern scope has no single concrete path, so no params are resolved.
    expect(matches.every((m) => m.params === undefined)).toBe(true);
  });

  it("does not include disjoint sibling scopes", () => {
    const router = createRouter<string>();
    addRoute(router, "GET", "/**", "root");
    addRoute(router, "GET", "/a/**", "a");
    addRoute(router, "GET", "/b/**", "b");

    expect(findOverlappingRoutes(router, "GET", "/a/x").map((m) => m.data)).toEqual(["root", "a"]);
  });

  it("mirrors findAllRoutes method handling (method + method-agnostic bucket)", () => {
    const router = createRouter<string>();
    addRoute(router, "", "/**", "any");
    addRoute(router, "GET", "/api/**", "get");
    addRoute(router, "POST", "/api/**", "post");

    expect(findOverlappingRoutes(router, "GET", "/api/users").map((m) => m.data)).toEqual([
      "any",
      "get",
    ]);
    expect(findOverlappingRoutes(router, "POST", "/api/users").map((m) => m.data)).toEqual([
      "any",
      "post",
    ]);
    // Unknown method falls back to the method-agnostic bucket only.
    expect(findOverlappingRoutes(router, "DELETE", "/api/users").map((m) => m.data)).toEqual([
      "any",
    ]);
  });

  it("classifies escaped-literal routes as static", () => {
    const router = createRouter<string>();
    addRoute(router, "GET", "/a/\\*", "star");
    addRoute(router, "GET", "/b/\\*\\*", "dstar");
    addRoute(router, "GET", "/c/\\*\\*/d", "mid");

    expect(findOverlappingRoutes(router, "GET", "/a/x").map((m) => m.data)).toEqual([]);
    expect(findOverlappingRoutes(router, "GET", "/a/\\*").map((m) => m.data)).toEqual(["star"]);
    expect(findOverlappingRoutes(router, "GET", "/b/x/y/z").map((m) => m.data)).toEqual([]);
    expect(findOverlappingRoutes(router, "GET", "/b/\\*\\*").map((m) => m.data)).toEqual(["dstar"]);
    expect(findOverlappingRoutes(router, "GET", "/c/x/y/z").map((m) => m.data)).toEqual([]);
    expect(findOverlappingRoutes(router, "GET", "/c/\\*\\*/d").map((m) => m.data)).toEqual(["mid"]);
  });

  it("collapses a route that expands into several entries (shared data reference)", () => {
    const router = createRouter<Record<string, unknown>>();
    const opt = { name: "opt" };
    const grp = { name: "grp" };
    addRoute(router, "GET", "/a/:x?", opt);
    addRoute(router, "GET", "/b{/c}?", grp);

    // `:x?` / `{/c}?` expand to several tree entries sharing one data reference.
    expect(findOverlappingRoutes(router, "GET", "/a/**").map((m) => m.data)).toEqual([opt]);
    expect(findOverlappingRoutes(router, "GET", "/b/**").map((m) => m.data)).toEqual([grp]);
  });

  it("does not drop distinct overlapping routes that lack data (all default to null)", () => {
    const router = createRouter();
    addRoute(router, "GET", "/a/x");
    addRoute(router, "GET", "/a/*");
    addRoute(router, "GET", "/a/y");

    // Three genuinely distinct routes all overlap `/a/**`; none may be dropped
    // just because `addRoute` stored `null` for each (no data passed).
    expect(findOverlappingRoutes(router, "GET", "/a/**")).toHaveLength(3);
  });

  it("keeps distinct routes that share an equal primitive data value", () => {
    const router = createRouter<string>();
    addRoute(router, "GET", "/a/**", "same");
    addRoute(router, "GET", "/a/b/**", "same");

    expect(findOverlappingRoutes(router, "GET", "/a/b/c").map((m) => m.data)).toEqual([
      "same",
      "same",
    ]);
  });

  it("named wildcard scope requires at least one segment (matches findAllRoutes)", () => {
    const router = createRouter<string>();
    addRoute(router, "GET", "/a/**:rest", "wc");

    expect(findOverlappingRoutes(router, "GET", "/a").map((m) => m.data)).toEqual([]);
    expect(findAllRoutes(router, "GET", "/a").map((m) => m.data)).toEqual([]);
    expect(findOverlappingRoutes(router, "GET", "/a/b").map((m) => m.data)).toEqual(["wc"]);
  });

  it("treats regex-constrained routes conservatively but precisely against literals", () => {
    const router = createRouter<string>();
    addRoute(router, "GET", "/user/:id(\\d+)", "num");
    addRoute(router, "GET", "/user/:name([a-z]+)", "alpha");

    // Literal query resolves precisely.
    expect(findOverlappingRoutes(router, "GET", "/user/42").map((m) => m.data)).toEqual(["num"]);
    // Dynamic query over-approximates to overlapping both.
    expect(
      findOverlappingRoutes(router, "GET", "/user/*")
        .map((m) => m.data)
        .sort(),
    ).toEqual(["alpha", "num"]);
  });

  it("prunes static siblings precisely against a regex-constrained query", () => {
    const router = createRouter<string>();
    addRoute(router, "GET", "/42", "num");
    addRoute(router, "GET", "/abc", "alpha");

    // A regex query keeps only the static literal it accepts (`/abc` pruned).
    expect(findOverlappingRoutes(router, "GET", "/:id(\\d+)").map((m) => m.data)).toEqual(["num"]);
  });

  it("fans an any-segment query across all static siblings", () => {
    const router = createRouter<string>();
    addRoute(router, "GET", "/a/z", "A");
    addRoute(router, "GET", "/b/z", "B");

    expect(
      findOverlappingRoutes(router, "GET", "/*/z")
        .map((m) => m.data)
        .sort(),
    ).toEqual(["A", "B"]);
  });

  it("reaches statics deeper than the query's fixed prefix via its tail", () => {
    const deep = createRouter<string>();
    addRoute(deep, "GET", "/a/b/c/d", "deep");
    expect(findOverlappingRoutes(deep, "GET", "/a/**").map((m) => m.data)).toEqual(["deep"]);

    // A trailing `*` tail is [0,1], so it must not reach a 2-deep static.
    const shallow = createRouter<string>();
    addRoute(shallow, "GET", "/a/b", "hit");
    addRoute(shallow, "GET", "/a/b/c", "miss");
    expect(findOverlappingRoutes(shallow, "GET", "/a/*").map((m) => m.data)).toEqual(["hit"]);
  });

  it("orders wildcard -> param -> static -> self at a single node", () => {
    const router = createRouter<string>();
    addRoute(router, "GET", "/a", "self");
    addRoute(router, "GET", "/a/b", "static");
    addRoute(router, "GET", "/a/:p", "param");
    addRoute(router, "GET", "/a/**", "wild");

    expect(findOverlappingRoutes(router, "GET", "/a/**").map((m) => m.data)).toEqual([
      "wild",
      "param",
      "static",
      "self",
    ]);
  });

  it("dedups by reference identity for function data too", () => {
    // Expansion siblings share one function reference -> collapsed.
    const collapse = createRouter<() => void>();
    const fn = () => {};
    addRoute(collapse, "GET", "/a/:x?", fn);
    const collapsed = findOverlappingRoutes(collapse, "GET", "/a/**");
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].data).toBe(fn);

    // Distinct functions on distinct routes are both reported.
    const distinct = createRouter<() => void>();
    const f1 = () => {};
    const f2 = () => {};
    addRoute(distinct, "GET", "/a/**", f1);
    addRoute(distinct, "GET", "/a/b/**", f2);
    expect(findOverlappingRoutes(distinct, "GET", "/a/b/c").map((m) => m.data)).toEqual([f1, f2]);
  });
});
