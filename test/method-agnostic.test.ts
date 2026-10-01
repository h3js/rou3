import { describe, it, expect } from "vitest";
import {
  addRoute,
  compareRoutes,
  createRouter,
  findAllRoutes,
  findOverlappingRoutes,
  findRoute,
  type MatchedRoute,
  type RouterContext,
} from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";

// A method-agnostic (`""`) route and a method-scoped one that end on the same
// tree node are siblings: lookup must never let the method-scoped bucket hide
// the agnostic one (it used to resolve a node with `methods[m] || methods[""]`,
// so results depended on whether two patterns happened to share a node).
//
// Model: at a node, the method's entries and the `""` entries are one sibling
// pool ranked by the usual specificity weight; on equal weight the
// method-scoped entry wins (findRoute) / comes last (findAllRoutes).

type Data = string;

/** Every matcher, asserted to agree: interpreter, JIT and AOT, single and all. */
function lookup(router: RouterContext<Data>, method: string, path: string) {
  const one = findRoute(router, method, path);
  const all = findAllRoutes(router, method, path);
  const aot = new Function(`return ${compileRouterToString(router)}`)();
  const aotAll = new Function(`return ${compileRouterToString(router, "", { matchAll: true })}`)();
  expect(json(compileRouter(router)(method, path)), "JIT single").toBe(json(one));
  expect(json(aot(method, path)), "AOT single").toBe(json(one));
  expect(compileRouter(router, { matchAll: true })(method, path), "JIT matchAll").toEqual(all);
  expect(aotAll(method, path), "AOT matchAll").toEqual(all);
  return { one: one?.data, all: all.map((m) => m.data), params: one?.params };
}

function router(routes: [method: string, pattern: string, data?: string][]) {
  const r = createRouter<Data>();
  for (const [method, pattern, data] of routes) {
    addRoute(r, method, pattern, data ?? `${method || "*"} ${pattern}`);
  }
  return r;
}

describe("method-agnostic entries on a shared node", () => {
  it("a failing method-scoped regex does not hide the agnostic sibling", () => {
    const r = router([
      ["", "/u/*", "A"],
      ["GET", "/u/:id(\\d+)", "B"],
    ]);
    expect(lookup(r, "GET", "/u/abc")).toMatchObject({ one: "A", all: ["A"] });
    expect(lookup(r, "GET", "/u/1")).toMatchObject({ one: "B", all: ["A", "B"] });
    expect(lookup(r, "POST", "/u/1")).toMatchObject({ one: "A", all: ["A"] });
  });

  it("a required method-scoped param does not hide an optional agnostic one", () => {
    const r = router([
      ["", "/u/*", "A"],
      ["GET", "/u/:id", "B"],
    ]);
    // A trailing `*` is optional (unlike URLPattern's)
    expect(lookup(r, "GET", "/u")).toMatchObject({ one: "A", all: ["A"] });
    expect(lookup(r, "GET", "/u/")).toMatchObject({ one: "A", all: ["A"] });
    expect(lookup(r, "GET", "/u/42")).toMatchObject({ one: "B", all: ["A", "B"] });
    expect(lookup(r, "GET", "/u/4/2")).toMatchObject({ one: "A", all: ["A"] });
  });

  it("wildcards: `**` vs `**:name`", () => {
    const r = router([
      ["", "/u/**", "A"],
      ["GET", "/u/**:rest", "B"],
    ]);
    expect(lookup(r, "GET", "/u")).toMatchObject({ one: "A", all: ["A"] });
    expect(lookup(r, "GET", "/u/a/b")).toMatchObject({
      one: "B",
      all: ["A", "B"],
      params: { rest: "a/b" },
    });
  });

  it("suffix tries: `/**/:f` vs `/**/:f(\\d+)`", () => {
    const r = router([
      ["", "/**/:f", "A"],
      ["GET", "/**/:f(\\d+)", "B"],
    ]);
    expect(lookup(r, "GET", "/a/x")).toMatchObject({ one: "A", all: ["A"] });
    expect(lookup(r, "GET", "/a/1")).toMatchObject({ one: "B", all: ["A", "B"] });
  });

  it("findAllRoutes no longer depends on node sharing (h3#1524 gate)", () => {
    // `/u/**` and `/u/*` land on different nodes than / the same node as
    // `/u/:id`: both gates must come back either way.
    for (const gate of ["/u/**", "/u/*"]) {
      const r = router([
        ["", gate, "gate"],
        ["GET", "/u/:id", "handler"],
      ]);
      expect(lookup(r, "GET", "/u/42").all, gate).toEqual(["gate", "handler"]);
      expect(
        findOverlappingRoutes(r, "GET", "/u/42").map((m) => m.data),
        gate,
      ).toEqual(["gate", "handler"]);
    }
  });

  it("the more specific entry wins across buckets, the method-scoped one on ties", () => {
    const r = router([
      ["", "/u/:id(\\d+)", "narrow"],
      ["GET", "/u/*", "broad"],
    ]);
    expect(compareRoutes("/u/*", "/u/:id(\\d+)")).toBe("superset");
    // Specificity first, as across nodes (a `""` static route beats a GET param)
    expect(lookup(r, "GET", "/u/1")).toMatchObject({ one: "narrow", all: ["broad", "narrow"] });
    expect(lookup(r, "GET", "/u/x")).toMatchObject({ one: "broad", all: ["broad"] });
  });

  it('the same pattern under `""` and a method: both match, the method wins', () => {
    for (const pattern of ["/api", "/api/:id", "/api/**", "/api/:id(\\d+)", "/**/api"]) {
      for (const order of [0, 1]) {
        const routes: [string, string, string][] = [
          ["", pattern, "AGN"],
          ["GET", pattern, "GET"],
        ];
        const r = router(order ? routes.reverse() : routes);
        const path = pattern.replace(/\*\*|:id(\(\\d\+\))?/g, "1");
        expect(lookup(r, "GET", path), pattern).toMatchObject({ one: "GET", all: ["AGN", "GET"] });
        expect(lookup(r, "POST", path), pattern).toMatchObject({ one: "AGN", all: ["AGN"] });
        // A `""` lookup sees the `""` bucket only
        expect(lookup(r, "", path), pattern).toMatchObject({ one: "AGN", all: ["AGN"] });
      }
    }
  });

  it("static routes above the compiled map threshold", () => {
    const r = router([]);
    for (let i = 0; i < 12; i++) {
      addRoute(r, "", `/s${i}`, `AGN${i}`);
      addRoute(r, "GET", `/s${i}`, `GET${i}`);
    }
    addRoute(r, "POST", "/only-post", "POST");
    expect(lookup(r, "GET", "/s3")).toMatchObject({ one: "GET3", all: ["AGN3", "GET3"] });
    expect(lookup(r, "PUT", "/s3")).toMatchObject({ one: "AGN3", all: ["AGN3"] });
    expect(lookup(r, "GET", "/only-post")).toMatchObject({ one: undefined, all: [] });
  });
});

// Sweep: every ordered pair of patterns, A registered under `""` and B under
// `GET`. On every path, a `GET` lookup must see exactly what A and B see on
// their own (findAllRoutes as a multiset, findRoute defined iff either
// matches and equal to the last findAllRoutes result), with interpreter and
// compiled output identical.
describe("method-agnostic sweep", () => {
  const patterns = [
    "/u",
    "/u/x",
    "/u/*",
    "/u/:id",
    "/u/:id(\\d+)",
    "/u/:id?",
    "/u/:id(\\d+)?",
    "/u/**",
    "/u/**:r",
    "/u/:x+",
    "/u/:x*",
    "/u/*/x",
    "/u/:id/x",
    "/u/**/x",
    "/u/**:r/:f(\\d+)",
    "/u{/x}?",
    "/*",
    "/:a/:b",
    "/**",
    "/**:r",
    "/**/:f",
    "/**/:f(\\d+)",
    "/**/x",
  ];
  const paths = [
    "/",
    "/u",
    "/u/",
    "/u//",
    "/u/1",
    "/u/a",
    "/u/x",
    "/u/1/x",
    "/u/a/x",
    "/u/a/1",
    "/u/a/b/x",
    "/a/1",
    "/a/x",
    "/x",
    "/1",
  ];

  const solo = new Map(
    patterns.map((p) => {
      const r = createRouter<Data>();
      addRoute(r, "", p, "A");
      return [p, r];
    }),
  );
  const count = (r: RouterContext<Data>, path: string) => findAllRoutes(r, "", path).length;

  it("never hides a match and agrees across matchers", () => {
    const problems: string[] = [];
    let checks = 0;
    for (const a of patterns) {
      for (const b of patterns) {
        const r = createRouter<Data>();
        addRoute(r, "", a, "A");
        addRoute(r, "GET", b, "B");
        const jit = compileRouter(r);
        const jitAll = compileRouter(r, { matchAll: true });
        const aot = new Function(`return ${compileRouterToString(r)}`)();
        const aotAll = new Function(`return ${compileRouterToString(r, "", { matchAll: true })}`)();
        for (const path of paths) {
          checks++;
          const tag = `"" ${a} + GET ${b} @ ${path}`;
          const one = findRoute(r, "GET", path);
          const all = findAllRoutes(r, "GET", path);
          const data = all.map((m) => m.data);
          const expected = [
            ...Array.from({ length: count(solo.get(a)!, path) }, () => "A"),
            ...Array.from({ length: count(solo.get(b)!, path) }, () => "B"),
          ];
          if ([...data].sort().join() !== expected.join()) {
            problems.push(`findAllRoutes ${tag}: ${data} (expected ${expected})`);
          }
          if ((one === undefined) !== (expected.length === 0)) {
            problems.push(`findRoute ${tag}: ${one?.data}`);
          }
          const last: MatchedRoute<Data> | undefined = all[all.length - 1];
          if (one?.data !== last?.data || !sameParams(one?.params, last?.params)) {
            problems.push(`findRoute is not the last match ${tag}: ${one?.data} vs ${last?.data}`);
          }
          for (const [name, fn, ref] of [
            ["JIT", jit, one],
            ["AOT", aot, one],
            ["JIT matchAll", jitAll, all],
            ["AOT matchAll", aotAll, all],
          ] as const) {
            const got = fn("GET", path);
            if (json(got) !== json(ref)) {
              problems.push(`${name} ${tag}: ${json(got)} vs ${json(ref)}`);
            }
          }
        }
      }
    }
    expect(checks).toBe(patterns.length ** 2 * paths.length);
    expect(problems).toEqual([]);
  });
});

// `data` + `params` only (the interpreter's static fast path returns the raw
// entry, with internal fields)
function json(m: MatchedRoute<Data> | MatchedRoute<Data>[] | undefined): string {
  const pick = (r: MatchedRoute<Data>) => ({ data: r.data, params: r.params });
  return JSON.stringify(Array.isArray(m) ? m.map(pick) : m && pick(m));
}

function sameParams(a?: Record<string, string>, b?: Record<string, string>) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}
