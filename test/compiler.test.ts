import { describe, it, expect } from "vitest";
import { addRoute, createRouter } from "../src/index.ts";
import type { RouterContext } from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";

// Public API of `rou3/compiler`: AOT data serialization, the
// `compileRouterToString` options object, and compiled `params` parity.

function routerWith(data: unknown, path = "/x"): RouterContext<any> {
  const router = createRouter<any>();
  addRoute(router, "GET", path, data);
  return router;
}

function circular() {
  const value: Record<string, unknown> = {};
  value.self = value;
  return value;
}

// eslint-disable-next-line no-new-func
const evalAOT = (code: string) => new Function(`return ${code}`)();

describe("compileRouterToString: data serialization", () => {
  it("serializes with standard JSON semantics (toJSON at every depth)", () => {
    const cases: [data: unknown, expected: unknown][] = [
      [new Date(0), "1970-01-01T00:00:00.000Z"],
      [{ at: new Date(0) }, { at: "1970-01-01T00:00:00.000Z" }],
      [{ toJSON: () => ({ a: 1 }) }, { a: 1 }],
      [{ toJSON: () => "code()" }, "code()"],
      [
        { a: 1, b: [1, "2", null], c: { d: true } },
        { a: 1, b: [1, "2", null], c: { d: true } },
      ],
      ["</script>", "</script>"],
      [42, 42],
      [Object.assign(Object.create(null), { a: 1 }), { a: 1 }],
      // Other objects follow JSON: own enumerable fields, `{}` for a `Map`
      [
        new (class Rule {
          cache = true;
          run() {}
        })(),
        { cache: true },
      ],
      [new Map([["a", 1]]), {}],
    ];
    for (const [i, [data, expected]] of cases.entries()) {
      for (const path of ["/x", "/x/:id"]) {
        const match = evalAOT(compileRouterToString(routerWith(data, path)));
        expect(match("GET", path === "/x" ? "/x" : "/x/1")?.data, `case ${i}`).toEqual(expected);
      }
    }
  });

  it("throws a clear error for data JSON can't represent", () => {
    class Handler {
      run = () => 1;
    }
    const cases: unknown[] = [
      () => 1,
      Symbol("x"),
      1n,
      { toJSON: () => undefined },
      { a: 1, h: () => 1 },
      { nested: { deep: [Symbol("x")] } },
      { big: 1n },
      new Handler(),
      circular(),
    ];
    for (const data of cases) {
      expect(() => compileRouterToString(routerWith(data, "/users/:id")), String(data)).toThrow(
        'rou3: route data for "/users/:id" is not JSON-serializable, pass opts.serialize',
      );
      // Static routes too (chain and map dispatch)
      expect(() => compileRouterToString(routerWith(data, "/static"))).toThrow(
        'rou3: route data for "/static" is not JSON-serializable',
      );
    }
    const many = createRouter<any>();
    for (let i = 0; i < 20; i++) addRoute(many, "GET", `/s${i}`, i);
    addRoute(many, "GET", "/fn", () => 1);
    expect(() => compileRouterToString(many)).toThrow('route data for "/fn"');
  });

  it("opts.serialize returns raw JS code", () => {
    const router = createRouter<{ handler: string }>();
    addRoute(router, "GET", "/a/:id", { handler: "h1" });
    addRoute(router, "GET", "/b", { handler: "h2" });
    const code = compileRouterToString(router, {
      serialize: (data) => `{handler:()=>${JSON.stringify(data.handler)}}`,
    });
    const match = evalAOT(code);
    expect(match("GET", "/a/1").data.handler()).toBe("h1");
    expect(match("GET", "/b").data.handler()).toBe("h2");
    // A data value the default would reject is fine with a serializer
    expect(() =>
      compileRouterToString(
        routerWith(() => 1),
        { serialize: () => "()=>1" },
      ),
    ).not.toThrow();
  });

  it("the JIT compiler keeps data by reference", () => {
    const handler = () => 1;
    const router = routerWith({ handler }, "/x/:id");
    expect(compileRouter(router)("GET", "/x/1")?.data.handler).toBe(handler);
  });
});

describe("compileRouterToString: options", () => {
  const router = createRouter<string>();
  addRoute(router, "GET", "/a/:id", "A");
  addRoute(router, "GET", "/a/**", "ALL");

  it("takes an options object", () => {
    const code = compileRouterToString(router, { functionName: "findRoute" });
    expect(code.startsWith("const findRoute=")).toBe(true);
    // eslint-disable-next-line no-new-func
    const findRoute = new Function(`${code};return findRoute`)();
    expect(findRoute("GET", "/a/1")).toEqual({ data: "A", params: { id: "1" } });

    const all = evalAOT(compileRouterToString(router, { matchAll: true }));
    expect(all("GET", "/a/1").map((m: any) => m.data)).toEqual(["ALL", "A"]);
  });

  it("still accepts a positional function name (deprecated)", () => {
    expect(compileRouterToString(router, "findRoute").startsWith("const findRoute=")).toBe(true);
    const all = compileRouterToString(router, "matchAll", { matchAll: true });
    // eslint-disable-next-line no-new-func
    const matchAll = new Function(`${all};return matchAll`)();
    expect(matchAll("GET", "/a/1")).toHaveLength(2);
    // `undefined` / `""` + options, as nitro, nuxt and h3 call it today
    expect(compileRouterToString(router, undefined, { matchAll: true })).toBe(
      compileRouterToString(router, { matchAll: true }),
    );
    expect(compileRouterToString(router, "", { matchAll: true })).toBe(
      compileRouterToString(router, { matchAll: true }),
    );
  });
});
