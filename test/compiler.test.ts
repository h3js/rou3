import { describe, it, expect } from "vitest";
import { addRoute, createRouter } from "../src/index.ts";
import { compileRouterToString } from "../src/compiler.ts";

// Public API of `rou3/compiler`: AOT data serialization, the
// `compileRouterToString` options object, and compiled `params` parity.

// eslint-disable-next-line no-new-func
const evalAOT = (code: string) => new Function(`return ${code}`)();

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
