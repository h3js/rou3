import { describe, it, expect } from "vitest";
import {
  addRoute,
  compareRoutes,
  createRouter,
  findAllRoutes,
  findRoute,
  routeNodeKeys,
  routesOverlap,
  routeToRegExp,
} from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";
import { needsDuplicateNames } from "./_regexp-cases.ts";

// URLPattern's `*` is a greedy `(.*)` with a required `/` before it: it takes
// the rest of the path (`/foo/*` on `/foo/a/b` is `a/b`), nothing after the
// slash (`/foo/` gives `""`), but not `/foo`. rou3 follows it, except where it
// ignores one trailing slash of the path (`/foo/a/` is `/foo/a`) and where a
// whole-segment `*` ends the route: it is optional there, as in 0.11, so
// `/foo/*` matches `/foo` too (no key, like a `**`). Those cases `differs`.
// `null`: no match.
const CASES: [
  route: string,
  path: string,
  params: Record<string, string> | null,
  differs?: true,
][] = [
  // Trailing `*`
  ["/foo/*", "/foo", {}, true],
  ["/foo/*", "/foo/", { 0: "" }],
  ["/foo/*", "/foo/bar", { 0: "bar" }],
  ["/foo/*", "/foo/bar/baz", { 0: "bar/baz" }],
  ["/foo/*", "/foo//a", { 0: "/a" }],
  ["/foo/*", "/foo//", { 0: "" }, true],
  ["/foo/*", "/foo/a/", { 0: "a" }, true],
  ["/foo/*", "/foo/a//", { 0: "a/" }, true],
  ["/foo/*", "/foobar", null],
  ["/*", "/", { 0: "" }],
  ["/*", "/a", { 0: "a" }],
  ["/*", "/a/b", { 0: "a/b" }],
  ["/*", "//", { 0: "" }, true],
  ["/*", "//a", { 0: "/a" }],
  ["/:x/*", "/a", { x: "a" }, true],
  ["/:x/*", "/a/", { x: "a", 0: "" }],
  ["/:x/*", "/a/b/c", { x: "a", 0: "b/c" }],
  ["/a/:x?/*", "/a/b", { x: "b" }, true],
  ["/a/:x?/*", "/a/b/c", { x: "b", 0: "c" }],
  ["/a/:x?/*", "/a/", { 0: "" }],
  // Whole-segment `*` before more of the route
  ["/*/x", "/x", null],
  ["/*/x", "//x", { 0: "" }],
  ["/*/x", "/a/x", { 0: "a" }],
  ["/*/x", "/a/b/x", { 0: "a/b" }],
  ["/*/x", "/a/x/x", { 0: "a/x" }],
  ["/*/x", "/a/x/", { 0: "a" }, true],
  ["/*/x", "/a/x/y", null],
  ["/a/*/b", "/a/b", null],
  ["/a/*/b", "/a//b", { 0: "" }],
  ["/a/*/b", "/a/x/b", { 0: "x" }],
  ["/a/*/b", "/a/x/y/b", { 0: "x/y" }],
  ["/*/:x", "/a/b/c", { 0: "a/b", x: "c" }],
  ["/*/:x", "/a", null],
  // In an optional group
  ["/a{/*}?", "/a", {}],
  ["/a{/*}?", "/a/", {}, true],
  ["/a{/*}?", "/a/b/c", { 0: "b/c" }],
  // Inside a segment: the capture spans segments too
  ["/*.png", "/a.png", { 0: "a" }],
  ["/*.png", "/a/b.png", { 0: "a/b" }],
  ["/*.png", "/.png", { 0: "" }],
  ["/*.png", "//b.png", { 0: "/b" }],
  ["/*.png", "/a/b", null],
  ["/*.png", "/a.png/x", null],
  ["/x/*.png", "/x/a/b.png", { 0: "a/b" }],
  ["/x/*.png", "/a/b.png", null],
  ["/foo-*", "/foo-", { 0: "" }],
  ["/foo-*", "/foo-a", { 0: "a" }],
  ["/foo-*", "/foo-a/b", { 0: "a/b" }],
  ["/foo-*", "/foo", null],
  ["/foo-*/x", "/foo-a/b/x", { 0: "a/b" }],
  ["/foo-*/x", "/foo-/x", { 0: "" }],
  ["/foo-*.png", "/foo-a.png", { 0: "a" }],
  ["/foo-*.png", "/foo-a/b.png", { 0: "a/b" }],
  ["/foo-*.png", "/foo-a/b/c.png", { 0: "a/b/c" }],
  ["/foo-*.png", "/foo-.png", { 0: "" }],
  ["/foo-*.png", "/foo-a/b", null],
  ["/foo-*.png", "/foo/b.png", null],
  ["/*-:x", "/a-b", { 0: "a", x: "b" }],
  ["/*-:x", "/a-b-c", { 0: "a-b", x: "c" }],
  ["/*-:x", "/a-b/c-d", { 0: "a-b/c", x: "d" }],
  ["/*-:x", "/a/b-c", { 0: "a/b", x: "c" }],
  ["/*-:x", "/a-b/cd", null],
  ["/:x-*", "/a-b", { x: "a", 0: "b" }],
  ["/:x-*", "/a-b/c", { x: "a", 0: "b/c" }],
  ["/:x-*", "/a-b-c/d", { x: "a", 0: "b-c/d" }],
  ["/:x-*", "/a/b-c", null],
  ["/(\\d+)-*", "/1-a/b", { 0: "1", 1: "a/b" }],
  ["/*-(\\d+)", "/a/b-1", { 0: "a/b", 1: "1" }],
  // `**` followed by more of its segment reads like a `*` there
  ["/**.md", "/a.md", { 0: "a" }],
  ["/**.md", "/x/a.md", { 0: "x/a" }],
  ["/**.md", "/.md", { 0: "" }],
  // README differences: no segment is left after the stripped trailing slash
  // for a `*` inside one (only a whole-segment `*` takes nothing there)
  ["/a/*:x?", "/a/", null, true],
  ["/a/*:x?", "/a//", { 0: "" }, true],
  ["/a/*(\\d*)", "/a/", null, true],
  ["/a/*(\\d*)", "/a//", { 0: "", 1: "" }, true],
  // README differences: segments after a catch-all match from the end, and
  // the route with an optional one wins
  ["/*/:x?", "/x/y", { 0: "x", x: "y" }, true],
  ["/a/*{/b}?", "/a/x/b", { 0: "x" }, true],
  // The regex inlines static segments after a `*` with a lazy `*`, only with
  // nothing optional before it
  ["/x-*{/b}?", "/x-a/b", { 0: "a" }, true],
  ["/x-*{/b}?", "/x-a/b/b", { 0: "a/b" }, true],
  ["/x-*{/b}?", "/x-a/c", { 0: "a/c" }],
  ["/x-*{/b}?", "/x-/b", { 0: "" }, true],
  ["/:x?/*/{b}?", "/a/b", { 0: "a" }],
];

describe("greedy `*` (URLPattern)", () => {
  for (const [route, path, params] of CASES) {
    it(`${route} on ${path}`, () => {
      const router = createRouter<string>();
      addRoute(router, "GET", route, route);
      const expected = params ? { data: route, params } : undefined;
      // A static match (an expansion without the `*`) has no `params`
      const result = (r?: { data: unknown; params?: Record<string, string> }) =>
        r && { data: r.data, params: r.params || {} };
      expect(result(findRoute(router, "GET", path))).toEqual(expected);
      const all = findAllRoutes(router, "GET", path);
      // Several expansions may match: the last one is the best
      expect(result(all[all.length - 1])).toEqual(expected);
      expect(result(compileRouter(router)("GET", path))).toEqual(expected);
      expect(compileRouter(router, { matchAll: true })("GET", path)).toEqual(all);
      const aot = new Function(`return ${compileRouterToString(router)}`)();
      expect(result(aot("GET", path))).toEqual(expected);
      // The regex matches what the router matches, with its captures (on an
      // engine without duplicate named groups, where it has them, it throws)
      if (needsDuplicateNames(route)) return;
      const match = path.match(routeToRegExp(route));
      expect(match ? definedGroups(match.groups) : null).toEqual(params);
    });
  }

  const URLPatternCtor = (globalThis as { URLPattern?: any }).URLPattern;
  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [route, path, params, differs] of CASES) {
      const groups = new URLPatternCtor({ pathname: route }).exec({ pathname: path })?.pathname
        .groups;
      const actual = groups ? definedGroups(groups) : null;
      if (differs) {
        expect(actual, `${route} on ${path}`).not.toEqual(params);
      } else {
        expect(actual, `${route} on ${path}`).toEqual(params);
      }
    }
  });
});

// Every path matches as URLPattern says, except that rou3 ignores one
// trailing slash: a path ending in `/` also matches where the path without it
// does in URLPattern.
describe("greedy `*` (URLPattern sweep)", () => {
  const URLPatternCtor = (globalThis as { URLPattern?: any }).URLPattern;
  const patterns = [
    "/*",
    "/a/*",
    "/*/a",
    "/a/*/b",
    "/:x/*",
    "/*/:x",
    "/*.png",
    "/a/*.png",
    "/*.png/a",
    "/a-*",
    "/a-*/b",
    "/a-*.png",
    "/*-:x",
    "/:x-*",
    "/*-a",
    "/a{/*}?",
    "/a/*{.png}?",
    "/**.png",
    "/a/:x?/*",
  ];
  const alphabet = ["a", "b", "", "a.png", "a-b", "a-", ".png", "a-.png"];
  const paths = ["/"];
  for (let depth = 1, prev = [""]; depth <= 3; depth++) {
    prev = prev.flatMap((path) => alphabet.map((s) => `${path}/${s}`));
    paths.push(...prev);
  }

  it.runIf(URLPatternCtor)("matches the paths URLPattern matches", () => {
    const failures: string[] = [];
    for (const route of patterns) {
      const pattern = new URLPatternCtor({ pathname: route });
      const router = createRouter<string>();
      addRoute(router, "GET", route, route);
      for (const path of paths) {
        const stripped = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
        // A trailing whole-segment `*` is optional (the route without it),
        // also before a trailing optional group (`/a/*{.png}?`)
        const base = route.replace(/\{[^}]*\}\?$/, "");
        const without = /[^\\]\/\*$/.test(base)
          ? new URLPatternCtor({ pathname: base.slice(0, -2) })
          : undefined;
        const expected =
          pattern.test({ pathname: path }) ||
          pattern.test({ pathname: stripped || "/" }) ||
          !!without?.test({ pathname: stripped });
        const actual = findRoute(router, "GET", path) !== undefined;
        if (actual !== expected) failures.push(`${route} on ${path}: ${actual}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.runIf(URLPatternCtor)("captures what URLPattern captures", () => {
    // An optional part after the `*` that the `*` could take: rou3 registers
    // the route with and without it and prefers the one with it
    const otherExpansion = new Set(["/a/*{.png}?", "/a/:x?/*"]);
    const failures: string[] = [];
    for (const route of patterns) {
      if (otherExpansion.has(route)) continue;
      const pattern = new URLPatternCtor({ pathname: route });
      const router = createRouter<string>();
      addRoute(router, "GET", route, route);
      for (const path of paths) {
        if (path.endsWith("/")) continue;
        const groups = pattern.exec({ pathname: path })?.pathname.groups;
        const found = findRoute(router, "GET", path);
        if (!groups || !found) continue;
        const actual = JSON.stringify(found.params || {});
        const expected = JSON.stringify(definedGroups(groups));
        if (actual !== expected) failures.push(`${route} on ${path}: ${actual} vs ${expected}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("one catch-all per route", () => {
  for (const route of [
    "/*/x/*",
    "/*/**",
    "/**/*",
    "/*/:p+",
    "/:p+/*",
    "/a/:x*/*",
    "/*/:x*",
    "/file-*-*.png",
    "/*.png/*",
    "/**/*.png",
    "/*/**:rest",
  ]) {
    it(`throws for ${route}`, () => {
      expect(() => addRoute(createRouter(), "GET", route)).toThrowError(
        /^rou3: a route can have only one/,
      );
      expect(() => routeToRegExp(route)).toThrowError(/^rou3: a route can have only one/);
    });
  }
});

describe("`*` vs `**` priority and ordering", () => {
  const routes = ["/foo/**", "/foo/*", "/foo/:x", "/foo/bar", "/foo/*/baz", "/**"];
  const router = createRouter<string>();
  for (const route of routes) addRoute(router, "GET", route, route);
  const jit = compileRouter(router);
  const jitAll = compileRouter(router, { matchAll: true });
  const aot = new Function(`return ${compileRouterToString(router)}`)();

  const cases: [path: string, best: string, all: string[]][] = [
    // Both match `/foo` (`*` without its key): `*` outweighs `**`
    ["/foo", "/foo/*", ["/**", "/foo/**", "/foo/*"]],
    ["/foo/", "/foo/*", ["/**", "/foo/**", "/foo/*"]],
    ["/foo/bar", "/foo/bar", ["/**", "/foo/**", "/foo/*", "/foo/:x", "/foo/bar"]],
    ["/foo/x", "/foo/:x", ["/**", "/foo/**", "/foo/*", "/foo/:x"]],
    ["/foo/x/y", "/foo/*", ["/**", "/foo/**", "/foo/*"]],
    ["/foo/x/baz", "/foo/*/baz", ["/**", "/foo/**", "/foo/*", "/foo/*/baz"]],
    ["/foo/x/y/baz", "/foo/*/baz", ["/**", "/foo/**", "/foo/*", "/foo/*/baz"]],
  ];
  for (const [path, best, all] of cases) {
    it(`${path} picks ${best}`, () => {
      expect(findRoute(router, "GET", path)?.data).toBe(best);
      expect(jit("GET", path)?.data).toBe(best);
      expect(aot("GET", path)?.data).toBe(best);
      expect(findAllRoutes(router, "GET", path).map((m) => m.data)).toEqual(all);
      expect(jitAll("GET", path).map((m: { data: string }) => m.data)).toEqual(all);
    });
  }

  it("leaves a `**` with regex params and a `**:name` tied, as before (no `*`)", () => {
    // A regex param weighs what a required `**:name` does: registration order
    // decides, in every matcher
    for (const [routes, path] of [
      [["/api/:v(\\d+)/**", "/api/:v/**:rest"], "/api/1/x"],
      [["/q/:a(\\d+)/:b(\\d+)/**", "/q/:c(\\d+)/:d/**:r"], "/q/1/2/x"],
    ] as const) {
      for (const order of [[...routes], [...routes].reverse()]) {
        const router = createRouter<string>();
        for (const route of order) addRoute(router, "GET", route, route);
        const aot = new Function(`return ${compileRouterToString(router)}`)();
        expect(findRoute(router, "GET", path)?.data, order.join(", ")).toBe(order[0]);
        expect(compileRouter(router)("GET", path)?.data).toBe(order[0]);
        expect(aot("GET", path)?.data).toBe(order[0]);
        expect(findAllRoutes(router, "GET", path).map((m) => m.data)).toEqual(order);
      }
    }
  });

  it("an optional segment before a static one (README differences)", () => {
    // The static `a` wins over `:x`, so the route without `:x` does; the
    // regex (and URLPattern) match left to right. Same paths, other captures.
    const router = createRouter<string>();
    addRoute(router, "GET", "/:x?/a/*", "r");
    expect(findRoute(router, "GET", "/a/a/b")?.params).toEqual({ 0: "a/b" });
    expect(compileRouter(router)("GET", "/a/a/b")?.params).toEqual({ 0: "a/b" });
    expect(definedGroups(routeToRegExp("/:x?/a/*").exec("/a/a/b")?.groups)).toEqual({
      x: "a",
      0: "b",
    });
  });
});

describe("trailing `*` is optional", () => {
  // `/foo/*` matches `/foo` without its key (like `**`), `/foo/` with `""`
  const cases: [route: string, path: string, params: Record<string, string> | null][] = [
    ["/foo/*", "/foo", {}],
    ["/foo/*", "/foo/", { 0: "" }],
    ["/foo/*", "/foo/a/b", { 0: "a/b" }],
    ["/*", "/", { 0: "" }],
    ["/*", "/a/b", { 0: "a/b" }],
    ["/:x/*", "/a", { x: "a" }],
    ["/a{/b/*}?", "/a/b", {}],
    // A group that is the `*`: the route without it wins its zero segments
    ["/a{/*}?", "/a/", {}],
    ["{/*}?", "/", {}],
    ["{/*}?", "//", { 0: "" }],
    ["{/*/:y?}?", "/", {}],
    // A missing segment before it never reaches a constraint (`"undefined"`)
    ["/:x([a-z]+)/*", "/", null],
    ["/a/:x(\\w+)/*", "/a", null],
    ["/:x/(\\w*)/*", "/a", null],
    ["/a/:x(\\w+)/*", "/a/b", { x: "b" }],
    // Only where it ends the route, and only a whole segment
    ["/foo/*/x", "/foo/x", null],
    ["/foo-*", "/foo", null],
    ["/foo/*.png", "/foo", null],
  ];
  for (const [route, path, params] of cases) {
    it(`${route} on ${path}`, () => {
      const router = createRouter<string>();
      addRoute(router, "GET", route, route);
      const aot = new Function(`return ${compileRouterToString(router)}`)();
      for (const match of [
        findRoute(router, "GET", path),
        findAllRoutes(router, "GET", path).at(-1),
        compileRouter(router)("GET", path),
        compileRouter(router, { matchAll: true })("GET", path).at(-1),
        aot("GET", path),
      ]) {
        // No `0: undefined` and no `_` alias
        expect(match && { ...match.params }).toStrictEqual(params ?? undefined);
      }
      const groups = routeToRegExp(route).exec(path)?.groups;
      expect(groups ? definedGroups(groups) : null).toEqual(params);
    });
  }
});

describe("`*` in pattern relations", () => {
  it("compareRoutes", () => {
    // A trailing `*` matches what a trailing `**` does
    expect(compareRoutes("/foo/**", "/foo/*")).toBe("equal");
    expect(compareRoutes("/foo/*", "/foo/:x")).toBe("superset");
    expect(compareRoutes("/foo/*", "/foo/**:x")).toBe("superset");
    expect(compareRoutes("/foo/*", "/foo/:x+")).toBe("superset");
    expect(compareRoutes("/foo/*", "/foo")).toBe("superset");
    expect(compareRoutes("/foo/*/x", "/foo/x")).toBe("disjoint");
    expect(compareRoutes("/foo/*", "/foo/*")).toBe("equal");
    expect(compareRoutes("/*/x", "/a/x")).toBe("superset");
    expect(compareRoutes("/*/x", "/a/b/x")).toBe("superset");
    expect(compareRoutes("/*.png", "/a/b.png")).toBe("superset");
    expect(compareRoutes("/**.md", "/*.md")).toBe("equal");
  });

  it("routesOverlap", () => {
    // `/foo/` matches both (rou3 reads it as `/foo` for `/foo`)
    expect(routesOverlap("/foo/*", "/foo")).toBe(true);
    expect(routesOverlap("/foo/*", "/foo/a/b")).toBe(true);
    expect(routesOverlap("/*/x", "/x")).toBe(false);
  });

  it("routeNodeKeys", () => {
    // `/foo/*` and `/foo/**` share the wildcard node
    expect(routeNodeKeys("/foo/*")).toEqual(routeNodeKeys("/foo/**"));
    expect(routeNodeKeys("/foo/:x")).not.toEqual(routeNodeKeys("/foo/*"));
  });
});

function definedGroups(groups: Record<string, string | undefined> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(groups)) {
    if (value !== undefined) result[/^_\d+$/.test(key) ? key.slice(1) : key] = value;
  }
  return result;
}
