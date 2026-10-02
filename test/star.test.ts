import { describe, it, expect } from "vitest";
import {
  addRoute,
  compareRoutes,
  createRouter,
  findAllRoutes,
  findRoute,
  removeRoute,
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
  // A `(.*)` group is a `*` (the same token in URLPattern), and a
  // `:name(.*)` a `*` keyed by `name`, which may be `""` (unlike a `:name`)
  ["/foo/(.*)", "/foo", {}, true],
  ["/foo/(.*)", "/foo/", { 0: "" }],
  ["/foo/(.*)", "/foo/bar", { 0: "bar" }],
  ["/foo/(.*)", "/foo/bar/baz", { 0: "bar/baz" }],
  ["/foo/(.*)", "/foo//a", { 0: "/a" }],
  ["/(.*)", "/", { 0: "" }],
  ["/(.*)", "/a/b", { 0: "a/b" }],
  ["/(.*)/x", "/a/b/x", { 0: "a/b" }],
  ["/(.*)/x", "/x", null],
  ["/(.*)/:x", "/a/b/c", { 0: "a/b", x: "c" }],
  ["/a-(.*)", "/a-b/c", { 0: "b/c" }],
  ["/(.*).png", "/a/b.png", { 0: "a/b" }],
  ["/(.*)-:x", "/a-b/c-d", { 0: "a-b/c", x: "d" }],
  ["/(\\d+)(.*)", "/1a/b", { 0: "1", 1: "a/b" }],
  ["/:x(\\d+)(.*)", "/1a/b", { x: "1", 0: "a/b" }],
  ["/(\\d+)/(.*)", "/1/a/b", { 0: "1", 1: "a/b" }],
  ["/a{/(.*)}?", "/a/b/c", { 0: "b/c" }],
  ["/{:foo}(.*)", "/foobarbaz", { foo: "f", 0: "oobarbaz" }],
  ["/{:foo}(.*)", "/foo/bar", { foo: "f", 0: "oo/bar" }],
  ["/{:foo}?(.*)", "/foo/bar", { foo: "f", 0: "oo/bar" }],
  ["/{:foo}{(.*)}", "/foo/bar", { foo: "f", 0: "oo/bar" }],
  ["/:foo{}(.*)", "/foo/bar", { foo: "f", 0: "oo/bar" }],
  ["/foo/:bar(.*)", "/foo", {}, true],
  ["/foo/:bar(.*)", "/foo/", { bar: "" }],
  ["/foo/:bar(.*)", "/foo/a", { bar: "a" }],
  ["/foo/:bar(.*)", "/foo/a/b", { bar: "a/b" }],
  ["/foo/:bar(.*)", "/foo//", { bar: "" }, true],
  ["/:p(.*)", "/", { p: "" }],
  ["/:p(.*)/x", "/a/b/x", { p: "a/b" }],
  ["/a/:p(.*)/b", "/a//b", { p: "" }],
  ["/a/:p(.*)/b", "/a/b", null],
  ["/:p(.*)/:x", "/a/b/c", { p: "a/b", x: "c" }],
  ["/:p(.*)/(\\d+)", "/a/b/1", { p: "a/b", 0: "1" }],
  ["/(\\d+)/:p(.*)", "/1/a/b", { 0: "1", p: "a/b" }],
  ["/a-:p(.*)", "/a-b/c", { p: "b/c" }],
  ["/a-:p(.*)", "/a-", { p: "" }],
  ["/:p(.*).png", "/a/b.png", { p: "a/b" }],
  ["/:p(.*).png", "/.png", { p: "" }],
  ["/a{/:p(.*)}?", "/a/b/c", { p: "b/c" }],
  ["/{:foo}:bar(.*)", "/foo/baz", { foo: "f", bar: "oo/baz" }],
  ["/:a:p(.*)", "/xy/z", { a: "x", p: "y/z" }],
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
    // `(.*)` and `:name(.*)` are a `*`
    "/(.*)",
    "/a/(.*)",
    "/(.*)/a",
    "/a-(.*).png",
    "/{:x}(.*)",
    "/:p(.*)",
    "/a/:p(.*)",
    "/:p(.*)/a",
    "/a-:p(.*)",
    "/:p(.*).png",
    "/:x-:p(.*)",
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
        const star = /[^\\]\/(?:\*|(?::\w+)?\(\.\*\))$/.exec(base);
        const without = star
          ? new URLPatternCtor({ pathname: base.slice(0, star.index + 1) })
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
        // Keys in any order (`/:x-:p(.*)` sets `p` last, URLPattern first)
        const sorted = (params: object) => JSON.stringify(Object.entries(params).sort());
        const actual = sorted(found.params || {});
        const expected = sorted(definedGroups(groups));
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
    // `(.*)` and `:name(.*)` are catch-alls too
    "/(.*)/(.*)",
    "/*/(.*)",
    "/(.*)/*",
    "/a/*(.*)",
    "/a/(.*)(.*)",
    "/a-(.*)-(.*)",
    "/(.*)/**",
    "/a/(.*)/:p+",
    "/:p(.*)/*",
    "/**/:p(.*)",
    "/:a(.*)/:b(.*)",
    "/a/:x*/:p(.*)",
    "/x-:p(.*)-*",
    "/a{/(.*)}?/*",
  ]) {
    it(`throws for ${route}`, () => {
      expect(() => addRoute(createRouter(), "GET", route)).toThrowError(
        /^rou3: a route can have only one/,
      );
      expect(() => routeToRegExp(route)).toThrowError(/^rou3: a route can have only one/);
    });
  }
});

describe("`(.*)` and `:name(.*)` are a `*`", () => {
  // `[pattern, the * route it equals, the key its * is renamed to]`
  const PAIRS: [string, string, string?][] = [
    ["/(.*)", "/*"],
    ["/a/(.*)", "/a/*"],
    ["/(.*)/a", "/*/a"],
    ["/a/(.*)/b", "/a/*/b"],
    ["/(.*)/:x", "/*/:x"],
    ["/a/(.*)/:x?", "/a/*/:x?"],
    ["/a-(.*)", "/a-*"],
    ["/(.*).png", "/*.png"],
    ["/a-(.*).png/b", "/a-*.png/b"],
    ["/(.*)-:x", "/*-:x"],
    ["/(\\d+)/(.*)", "/(\\d+)/*"],
    ["/a{/(.*)}?", "/a{/*}?"],
    ["/a/(.*){.png}?", "/a/*{.png}?"],
    ["/a/(.*){/b}?", "/a/*{/b}?"],
    ["/x-(.*){/b}?", "/x-*{/b}?"],
    ["/{(.*)}?", "/{*}?"],
    ["/a{/b/(.*)}?", "/a{/b/*}?"],
    ["/:x?/(.*)", "/:x?/*"],
    ["/a/(.*)/:y/:z?", "/a/*/:y/:z?"],
    ["/a/:p(.*){.png}?", "/a/*{.png}?", "p"],
    ["/a/:p(.*){/b}?", "/a/*{/b}?", "p"],
    ["/:x?/:p(.*)", "/:x?/*", "p"],
    // A `(.*)` group right after a group (written after U+FFFF there)
    ["/{a}?{(.*)}?", "/{a}?{*}?"],
    ["/{b-}?{(.*)}?", "/{b-}?{*}?"],
    ["/:p(.*)", "/*", "p"],
    ["/a/:p(.*)", "/a/*", "p"],
    ["/:p(.*)/a", "/*/a", "p"],
    ["/a/:p(.*)/:x", "/a/*/:x", "p"],
    ["/a-:p(.*)", "/a-*", "p"],
    ["/:p(.*).png", "/*.png", "p"],
    ["/a-:p(.*).png/b", "/a-*.png/b", "p"],
    ["/:p(.*)-:x", "/*-:x", "p"],
    ["/a{/:p(.*)}?", "/a{/*}?", "p"],
    ["/(\\d+)/:p(.*)/(\\w+)", "/(\\d+)/*/(\\w+)", "p"],
  ];
  const alphabet = ["a", "b", "", "a.png", "a-b", "1", "a-.png"];
  const paths = ["/"];
  for (let depth = 1, prev = [""]; depth <= 3; depth++) {
    prev = prev.flatMap((path) => alphabet.map((s) => `${path}/${s}`));
    paths.push(...prev);
  }
  // `*`'s params with its key renamed (`"0"` -> `p`; later unnamed keys shift)
  const rename = (route: string, params: Record<string, string> | undefined, name?: string) => {
    if (!params || !name) return params;
    const star = String((route.slice(0, route.indexOf("*")).match(/\(/g) || []).length);
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (key === "_") continue;
      result[key === star ? name : /^\d+$/.test(key) && key > star ? String(+key - 1) : key] =
        value;
    }
    return result;
  };
  const matchers = (route: string) => {
    const router = createRouter<string>();
    addRoute(router, "GET", route, "x");
    const jit = compileRouter(router);
    const jitAll = compileRouter(router, { matchAll: true });
    const aot = new Function(`return ${compileRouterToString(router)}`)();
    const regexp = needsDuplicateNames(route) ? undefined : routeToRegExp(route);
    return (path: string) => {
      const all = findAllRoutes(router, "GET", path);
      return [
        findRoute(router, "GET", path)?.params,
        all.at(-1)?.params,
        jit("GET", path)?.params,
        jitAll("GET", path).at(-1)?.params,
        aot("GET", path)?.params,
        all.length,
        regexp && (path.match(regexp) ? definedGroups(path.match(regexp)!.groups) : null),
      ];
    };
  };

  it("match and capture like the `*` route, in every matcher", () => {
    const failures: string[] = [];
    for (const [route, star, name] of PAIRS) {
      const actual = matchers(route);
      const expected = matchers(star);
      for (const path of paths) {
        // Keys in any order (a renamed key moves)
        const sorted = (r: unknown) => (typeof r === "object" && r ? Object.entries(r).sort() : r);
        const want = expected(path).map((r) =>
          sorted(typeof r === "object" && r ? rename(star, { ...r }, name) : r),
        );
        const got = actual(path).map((r) => sorted(r));
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          failures.push(`${route} on ${path}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("an unnamed one compiles to the `*` route's regex", () => {
    for (const [route, star, name] of PAIRS) {
      if (!name && !needsDuplicateNames(route)) {
        expect(routeToRegExp(route).source, route).toBe(routeToRegExp(star).source);
      }
    }
  });

  it("are the `*` route in pattern relations", () => {
    for (const [route, star] of PAIRS) {
      expect(compareRoutes(route, star), route).toBe("equal");
      expect(routeNodeKeys(route), route).toEqual(routeNodeKeys(star));
    }
    expect(compareRoutes("/a/:p(.*)", "/a/:x")).toBe("superset");
    expect(compareRoutes("/a/:p(.*)", "/a/**:x")).toBe("superset");
    expect(routesOverlap("/a/(.*)", "/a/b/c")).toBe(true);
  });

  it("removes like the route it is", () => {
    const router = createRouter<string>();
    // `(.*)` is `*`: either spelling removes the other
    addRoute(router, "GET", "/a/(.*)", "group");
    removeRoute(router, "GET", "/a/*");
    expect(findRoute(router, "GET", "/a/b")).toBeUndefined();
    addRoute(router, "GET", "/a/*", "star");
    removeRoute(router, "GET", "/a/(.*)");
    expect(findRoute(router, "GET", "/a/b")).toBeUndefined();
    // `:p(.*)` keys its capture: only that pattern removes it
    addRoute(router, "GET", "/a/:p(.*)", "named");
    addRoute(router, "GET", "/a/*", "star");
    removeRoute(router, "GET", "/a/*");
    expect(findRoute(router, "GET", "/a/b/c")).toEqual({ data: "named", params: { p: "b/c" } });
    removeRoute(router, "GET", "/a/:p(.*)");
    expect(findRoute(router, "GET", "/a/b")).toBeUndefined();
    for (const route of ["/{:x}(.*)", "/a/:x(\\d+)(.*)", "/a-:p(.*)/b", "/:a:p(.*)"]) {
      addRoute(router, "GET", route, route);
      removeRoute(router, "GET", route);
    }
    expect({ ...router.root, hasSuffix: undefined }).toEqual(createRouter().root);
  });

  // A `:name(.*)` is a `*`: any of its segments may be empty, while every
  // segment of a `:name+` / `:name*` / `**:name` needs a value (URLPattern)
  it("takes empty segments where a `:name+` doesn't", () => {
    const cases: [route: string, path: string, params: Record<string, string> | null][] = [
      ["/a/:p(.*)", "/a//b", { p: "/b" }],
      ["/a/:p(.*)", "/a/b//", { p: "b/" }],
      ["/a/:p(.*)", "/a/b//c", { p: "b//c" }],
      ["/a/:p(.*)", "/a/", { p: "" }],
      ["/a/:p(.*)", "/a//", { p: "" }],
      ["/a/:p(.*)/c", "/a//c", { p: "" }],
      ["/a/:p(.*)/c", "/a/b//c", { p: "b/" }],
      ["/a/x-:p(.*)", "/a/x-//b", { p: "//b" }],
      ["/a/:p+", "/a//b", null],
      ["/a/:p+", "/a/b//", null],
      ["/a/:p+", "/a/b//c", null],
      ["/a/:p+", "/a/", null],
      ["/a/:p+/c", "/a/b//c", null],
      ["/a/**:p", "/a//b", null],
      ["/a/:p*", "/a/b//c", null],
      ["/a/:p+", "/a/b/c", { p: "b/c" }],
    ];
    for (const [route, path, params] of cases) {
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
        expect(match ? { ...match.params } : null, `${route} on ${path}`).toEqual(params);
      }
      const groups = routeToRegExp(route).exec(path)?.groups;
      expect(groups ? definedGroups(groups) : null, `regex ${route} on ${path}`).toEqual(params);
    }

    // Side by side, the narrower `:name+` wins where both match, in every
    // matcher and both registration orders
    for (const routes of [
      ["/a/:p(.*)", "/a/:q+"],
      ["/a/:q+", "/a/:p(.*)"],
    ]) {
      const router = createRouter<string>();
      for (const route of routes) addRoute(router, "GET", route, route);
      const aot = new Function(`return ${compileRouterToString(router)}`)();
      for (const [path, best, all] of [
        ["/a/b/c", "/a/:q+", ["/a/:p(.*)", "/a/:q+"]],
        ["/a//b", "/a/:p(.*)", ["/a/:p(.*)"]],
        ["/a/b//", "/a/:p(.*)", ["/a/:p(.*)"]],
        ["/a/", "/a/:p(.*)", ["/a/:p(.*)"]],
      ] as const) {
        expect(findRoute(router, "GET", path)?.data, `${routes} ${path}`).toBe(best);
        expect(compileRouter(router)("GET", path)?.data, `${routes} ${path}`).toBe(best);
        expect(aot("GET", path)?.data, `${routes} ${path}`).toBe(best);
        expect(findAllRoutes(router, "GET", path).map((m) => m.data)).toEqual(all);
        expect(
          compileRouter(router, { matchAll: true })("GET", path).map(
            (m: { data: string }) => m.data,
          ),
        ).toEqual(all);
      }
    }
  });

  it("ranks a `:name(.*)` like a `*`", () => {
    const routes = ["/foo/**", "/foo/:p(.*)", "/foo/**:rest", "/foo/:x", "/foo/bar"];
    const router = createRouter<string>();
    for (const route of routes) addRoute(router, "GET", route, route);
    const jit = compileRouter(router);
    const aot = new Function(`return ${compileRouterToString(router)}`)();
    for (const [path, best] of [
      ["/foo", "/foo/:p(.*)"],
      ["/foo/", "/foo/:p(.*)"],
      ["/foo/x/y", "/foo/**:rest"],
      ["/foo/x", "/foo/:x"],
      ["/foo/bar", "/foo/bar"],
      // `**:rest` needs a value, `:p(.*)` takes `""`
      ["/foo//", "/foo/:p(.*)"],
    ]) {
      expect(findRoute(router, "GET", path)?.data, path).toBe(best);
      expect(jit("GET", path)?.data, path).toBe(best);
      expect(aot("GET", path)?.data, path).toBe(best);
    }
  });

  it("throws for a modifier on one (`*?` and `**` are reserved)", () => {
    for (const route of [
      "/a/(.*)?",
      "/a/(.*)+",
      "/a/(.*)*",
      "/a/:p(.*)?",
      "/a/:p(.*)+",
      "/a/:p(.*)*",
      "/a/x-:p(.*)?",
      "/a/:x(\\d+)(.*)?",
    ]) {
      expect(() => addRoute(createRouter(), "GET", route), route).toThrowError(/^rou3: /);
      expect(() => routeToRegExp(route), route).toThrowError(/^rou3: /);
    }
  });

  it("throws for a capture inside a class in a constraint", () => {
    // `[(.*)]` would be a class with a `(.*)` rewritten in it (`[*]`), and
    // `[()]` compiled to `[(?<_0>)]`; URLPattern rejects these too
    for (const route of ["/:x([(.*)])", "/:x([(a)])", "/:x([()])", "/a/([(.*)])", "/:x(a[(b)]c)"]) {
      expect(() => addRoute(createRouter(), "GET", route), route).toThrowError(/^rou3: /);
      expect(() => routeToRegExp(route), route).toThrowError(/^rou3: /);
    }
    // Escaped, they are class chars
    const router = createRouter<string>();
    addRoute(router, "GET", "/:x([\\(.*\\)]+)", "x");
    expect(findRoute(router, "GET", "/(.)")?.params).toEqual({ x: "(.)" });
    expect(findRoute(router, "GET", "/a")).toBeUndefined();
  });

  it("throws for a repeated name", () => {
    for (const route of ["/:p/:p(.*)", "/:p(.*)/:p", "/a/:p(.*)-:p", "/**:p/x/:p(.*)"]) {
      expect(() => addRoute(createRouter(), "GET", route), route).toThrowError(/^rou3: /);
    }
  });

  it("reads only an unescaped `(.*)`", () => {
    for (const [route, path, params] of [
      // Escaped: literal text (the `*` is one unless escaped too)
      ["/a/\\(.*)", "/a/(.*)", { 0: "*" }],
      ["/a/\\(.*)", "/a/b/c", null],
      ["/a/\\(.\\*)", "/a/(.*)", {}],
      // Escaped colon: `(.*)` after plain text
      ["/a/\\:p(.*)", "/a/:pb/c", { 0: "b/c" }],
      // An escaped `\\` before it (a `\` is no percent-encoded char)
      ["/a/x\\\\(.*)", "/a/x\\b/c", { 0: "b/c" }],
      // Other constraints that can match `/` stay in their segment
      ["/a/(.+)", "/a/b/c", null],
      ["/a/:p(.*?)", "/a/b/c", null],
      ["/a/:p([^x]*)", "/a/b/c", null],
      ["/a/(\\.*)", "/a/b/c", null],
      ["/a/(\\.*)", "/a/..", { 0: ".." }],
    ] as [string, string, Record<string, string> | null][]) {
      const router = createRouter<string>();
      addRoute(router, "GET", route, route);
      const expected = params ?? undefined;
      const aot = new Function(`return ${compileRouterToString(router)}`)();
      for (const match of [
        findRoute(router, "GET", path),
        compileRouter(router)("GET", path),
        aot("GET", path),
      ]) {
        expect(match && { ...match.params }, `${route} on ${path}`).toEqual(expected);
      }
    }
    expect(() => addRoute(createRouter(), "GET", "/a/(.*\\)")).toThrowError(/^rou3: /);
    // After a `*` / `**`: a second catch-all
    for (const route of ["/a/**:x(.*)", "/a/x*:p(.*)", "/a/\\**:p(.*)"]) {
      expect(() => addRoute(createRouter(), "GET", route), route).toThrowError(/^rou3: /);
    }
  });
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

  it("ranks a `pre*` segment above a `:name` on one segment (as `*post`)", () => {
    for (const [routes, path, best, params] of [
      [["/:slug", "/blog-*"], "/blog-post", "/blog-*", { 0: "post" }],
      [["/:slug", "/blog-*"], "/blog-a/b", "/blog-*", { 0: "a/b" }],
      [["/:slug", "/blog-*"], "/other", "/:slug", { slug: "other" }],
      [["/x/:id", "/x/v*"], "/x/v1", "/x/v*", { 0: "1" }],
      [["/x/:file", "/x/*.png"], "/x/a.png", "/x/*.png", { 0: "a" }],
      // The route with the group wins (README)
      [["/:a{-*}?"], "/a-b", "/:a{-*}?", { a: "a", 0: "b" }],
    ] as const) {
      for (const order of [[...routes], [...routes].reverse()]) {
        const router = createRouter<string>();
        for (const route of order) addRoute(router, "GET", route, route);
        const aot = new Function(`return ${compileRouterToString(router)}`)();
        for (const match of [
          findRoute(router, "GET", path),
          findAllRoutes(router, "GET", path).at(-1),
          compileRouter(router)("GET", path),
          compileRouter(router, { matchAll: true })("GET", path).at(-1),
          aot("GET", path),
        ]) {
          expect({ data: match?.data, params: { ...match?.params } }, order.join(", ")).toEqual({
            data: best,
            params,
          });
        }
        for (const route of order) removeRoute(router, "GET", route);
        expect({ ...router.root, hasSuffix: undefined }).toEqual(createRouter().root);
      }
    }
  });

  it("lists a `pre*` route once per path", () => {
    for (const [route, path, count] of [
      ["/x-*/b", "/x-a/b"],
      ["/x-*/:y", "/x-a/b"],
      ["/a/pre*/c/d", "/a/pre1/c/d"],
      ["/x-*", "/x-a"],
      // With and without the optional segment, as `/a/**/:y?` on `main`
      ["/a/x-*/:y?", "/a/x-1/b", 2],
      ["/x-*{/b}?", "/x-a/b", 2],
    ] as [string, string, number?][]) {
      const router = createRouter<string>();
      addRoute(router, "GET", route, route);
      expect(findAllRoutes(router, "GET", path).length, route).toBe(count ?? 1);
      expect(compileRouter(router, { matchAll: true })("GET", path).length, route).toBe(count ?? 1);
    }
  });

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
