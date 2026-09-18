import { describe, it, expect } from "vitest";
import { createRouter, addRoute, findRoute, routeToRegExp, routeNodeKeys } from "../src/index.ts";
import { compileRouter } from "../src/compiler.ts";

// A route-pattern syntax error used to surface as the engine's own RegExp
// SyntaxError for a *rewritten* segment (`/^(?<__rou3_unnamed_0>2024$/:
// Unterminated group` on V8, `missing )` on JavaScriptCore) — no route, no
// hint (#199). Every entry point now throws one engine-independent
// `SyntaxError` that names the caller's original route, keeps the native error
// as `cause`, and diagnoses the three shapes a route author actually hits.
describe("route pattern errors", () => {
  const entryPoints = {
    addRoute: (route: string) => addRoute(createRouter(), "GET", route, 1),
    routeToRegExp: (route: string) => routeToRegExp(route),
    routeNodeKeys: (route: string) => routeNodeKeys(route),
  };

  for (const [name, register] of Object.entries(entryPoints)) {
    describe(name, () => {
      it("diagnoses an unbalanced '(' and names the full route", () => {
        expect(() => register("/api/v1/users/:id/files/(2024")).toThrow(
          `Invalid route pattern "/api/v1/users/:id/files/(2024": unbalanced '(' group.`,
        );
        expect(() => register("/files/(2024")).toThrow(/Escape a literal parenthesis/);
        expect(() => register("/files/:id(\\d+")).toThrow(/unbalanced '\('/);
        expect(() => register("/files/(?:abc")).toThrow(/unbalanced '\('/);
      });

      it("diagnoses an unmatched ')'", () => {
        expect(() => register("/a/:id)")).toThrow(
          `Invalid route pattern "/a/:id)": unmatched ')'.`,
        );
        expect(() => register("/a/(x))")).toThrow(/unmatched '\)'/);
      });

      it("diagnoses a '/' inside a constraint instead of blaming the split fragment", () => {
        expect(() => register("/files/:path(.+/.+)")).toThrow(
          `Invalid route pattern "/files/:path(.+/.+)": a '(...)' constraint cannot contain '/'.`,
        );
        expect(() => register("/api/:v(v1|v2/beta)/x")).toThrow(/cannot contain '\/'/);
        expect(() => register("/f/(a/b)")).toThrow(/cannot contain '\/'/);
      });

      it("diagnoses an unterminated '[' character class", () => {
        expect(() => register("/a/:id([a-z")).toThrow(
          `Invalid route pattern "/a/:id([a-z": unterminated '[' character class.`,
        );
      });

      it("wraps any other RegExp failure with the route and keeps the cause", () => {
        let err: unknown;
        try {
          register("/a/:id(a{2,1})");
        } catch (error) {
          err = error;
        }
        expect(err).toBeInstanceOf(SyntaxError);
        expect((err as Error).message).toMatch(/^Invalid route pattern "\/a\/:id\(a\{2,1\}\)": /);
        expect((err as Error).cause).toBeInstanceOf(SyntaxError);
      });

      it("throws a SyntaxError with the native error as cause", () => {
        let err: unknown;
        try {
          register("/files/(2024");
        } catch (error) {
          err = error;
        }
        expect(err).toBeInstanceOf(SyntaxError);
        expect((err as Error).cause).toBeInstanceOf(SyntaxError);
      });

      it("does not reject a '(' inside a character class", () => {
        expect(() => register("/a/:id([(]+)")).not.toThrow();
      });
    });
  }

  it("names the original route, not a placeholder-rewritten or expanded fragment", () => {
    expect(() => addRoute(createRouter(), "GET", "/files/\\:x(2024", 1)).toThrow(
      'Invalid route pattern "/files/\\:x(2024"',
    );
    expect(() => addRoute(createRouter(), "GET", "/a/(2024/:x?", 1)).toThrow(
      'Invalid route pattern "/a/(2024/:x?"',
    );
    expect(() => addRoute(createRouter(), "GET", "/a/x{y}?(z", 1)).toThrow(
      'Invalid route pattern "/a/x{y}?(z"',
    );
  });

  it("spells the escape in JS-string form", () => {
    expect(() => addRoute(createRouter(), "GET", "/files/(2024", 1)).toThrow(
      'Escape a literal parenthesis as \\( ("\\\\(" in a JS string)',
    );
  });
});

describe("escaped route syntax inside dynamic segments", () => {
  // `encodeEscapes()` turns `\(` / `\)` / `\:` / `\{` / `\}` into `�`
  // placeholders before splitting; `segmentKey()` decoded them back for static
  // keys, but `getParamRegexp()` never did — an escaped paren in a dynamic
  // segment was compiled as a literal U+FFFD and the route could never match
  // (while `routeToRegExp` for the same pattern did). The error hint above
  // steers users into exactly this form.
  const routes = [
    "/files/:name\\(2024",
    "/img/*\\(v1",
    "/id/:id(\\(\\d+\\))",
    "/kv/:key\\::value",
    "/tpl/:name\\{x\\}",
  ];
  const router = createRouter<number>();
  for (const [i, route] of routes.entries()) addRoute(router, "GET", route, i + 1);
  const compiled = compileRouter(router);

  const cases: [string, number, Record<string, string>][] = [
    ["/files/x(2024", 1, { name: "x" }],
    ["/img/logo(v1", 2, { "0": "logo" }],
    ["/id/(123)", 3, { id: "(123)" }],
    ["/kv/a:b", 4, { key: "a", value: "b" }],
    ["/tpl/foo{x}", 5, { name: "foo" }],
  ];

  for (const [name, match] of [
    ["findRoute", (p: string) => findRoute(router, "GET", p)],
    ["compiled", (p: string) => compiled("GET", p)],
  ] as const) {
    it(`matches the literal form (${name})`, () => {
      for (const [path, data, params] of cases) {
        expect(match(path), path).toMatchObject({ data, params });
      }
      expect(match("/files/x2024")).toBeUndefined();
      expect(match("/id/123")).toBeUndefined();
    });
  }

  it("agrees with routeToRegExp", () => {
    for (const [i, route] of routes.entries()) {
      const re = routeToRegExp(route);
      expect(re.test(cases[i][0]), route).toBe(true);
    }
    expect(routeToRegExp(routes[0]).test("/files/x2024")).toBe(false);
  });
});
