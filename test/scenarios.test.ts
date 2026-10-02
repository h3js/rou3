import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addRoute, createRouter, findAllRoutes, findRoute, routeToRegExp } from "../src/index.ts";
import type { MatchedRoute, RouterContext } from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";
import { fromGroupName } from "../src/_group-names.ts";
import { DUPLICATE_NAMED_GROUPS, needsDuplicateNames } from "./_regexp-cases.ts";
import { withoutAlias } from "./_utils.ts";

// Data-driven scenarios (`test/scenarios/*.json`, schema in `_schema.json`):
// route tables developers write, with expected results on hand-picked paths.
// Beyond those, every case path and its mutations (probes) must agree across
// `findRoute`, `findAllRoutes`, compiled JIT / AOT (single and matchAll),
// `routeToRegExp` of each route, and the scenario's `guards`.

type Params = Record<string, string | undefined>;
interface Route {
  method?: string;
  path: string;
  name: string;
  /** `exact` (default): same paths and captures; `paths`: same paths; `overmatch`: regex ⊇ router. */
  regexp?: "exact" | "paths" | "overmatch";
}
interface Case {
  method?: string;
  path: string;
  normalize?: boolean;
  match: string | null;
  params?: Params;
  all?: string[];
  /** A known bug: the actual result must differ from the expectation (stale guard). */
  bug?: string;
}
interface Scenario {
  name: string;
  routes: Route[];
  cases: Case[];
  /** Patterns `addRoute` (and `routeToRegExp`) must reject with a `rou3:` error. */
  invalid?: string[];
  /** Guard route → routes it must cover: whenever one of them matches, the guard does. */
  guards?: Record<string, string[]>;
  /** Extra paths for the consistency checks only. */
  probes?: string[];
}
type Result = { name: string; params?: Params } | null;

const DIR = new URL("scenarios/", import.meta.url);
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
// eslint-disable-next-line no-new-func
const evalAOT = (code: string) => new Function(`return ${code}`)();

for (const file of FILES) {
  const { scenarios } = JSON.parse(readFileSync(new URL(file, DIR), "utf8")) as {
    scenarios: Scenario[];
  };
  describe(file.replace(/\.json$/, ""), () => {
    for (const scenario of scenarios) {
      describe(scenario.name, () => runScenario(scenario));
    }
  });
}

function runScenario(scenario: Scenario) {
  const router = createRouter<{ name: string }>();
  for (const route of scenario.routes) {
    addRoute(router, route.method ?? "GET", route.path, { name: route.name });
  }
  const matchers = [false, true].map((normalize) => buildMatchers(router, normalize));
  const singles = new Map(scenario.routes.map((route) => [route.name, singleRoute(route)]));

  it("expected results", () => {
    for (const c of scenario.cases) {
      const { find, findAll } = matchers[c.normalize ? 1 : 0]!;
      const one = find(c.method ?? "GET", c.path);
      const actual = {
        match: one?.name ?? null,
        // The deprecated `_` alias of a bare `**`, read on the matched route alone
        params: c.params && (one ? withoutAlias(singles.get(one.name)!.router, one.params) : {}),
        all: c.all && findAll(c.method ?? "GET", c.path).map((r) => r!.name),
      };
      const expected = { match: c.match, params: c.params, all: c.all };
      const label = `${c.method ?? "GET"} ${c.path}${c.normalize ? " (normalize)" : ""}`;
      if (c.bug) {
        expect(actual, `stale bug entry: ${label} (${c.bug})`).not.toEqual(expected);
      } else {
        expect(actual, label).toEqual(expected);
      }
    }
  });

  it("find, findAll, JIT and AOT agree on every probe", () => {
    const methods = scenarioMethods(scenario);
    for (const path of probePaths(scenario)) {
      for (const m of matchers) {
        for (const method of methods) {
          const label = `${method} ${path}${m.normalize ? " (normalize)" : ""}`;
          const one = m.find(method, path);
          const all = m.findAll(method, path);
          for (const [kind, actual] of [
            ["JIT", m.jit(method, path)],
            ["AOT", m.aot(method, path)],
          ] as const) {
            if (key(actual) !== key(one)) expect(actual, `${kind} ${label}`).toStrictEqual(one);
          }
          for (const [kind, actual] of [
            ["JIT matchAll", m.jitAll(method, path)],
            ["AOT matchAll", m.aotAll(method, path)],
          ] as const) {
            if (key(actual) !== key(all)) expect(actual, `${kind} ${label}`).toStrictEqual(all);
          }
          if (one) expect(all, `findRoute result in findAll: ${label}`).toContainEqual(one);
          else expect(all, `findAll empty without findRoute: ${label}`).toEqual([]);
          const data = findRoute(router, method, path, { normalize: m.normalize, params: false });
          expect(data ? { name: data.data.name, params: data.params } : null, label).toEqual(
            one && { name: one.name, params: undefined },
          );
          const names = new Set(all.map((r) => r!.name));
          for (const [guard, routes] of Object.entries(scenario.guards || {})) {
            const hit = routes.find((name) => names.has(name));
            if (hit) expect(names.has(guard), `${guard} must cover ${hit}: ${label}`).toBe(true);
          }
        }
      }
    }
  });

  it("findAll lists exactly the routes routeToRegExp matches", () => {
    const methods = scenarioMethods(scenario);
    for (const path of probePaths(scenario)) {
      // Whether each route matches on its own (method-independent), checked against its regex
      const alone = new Map<string, boolean>();
      for (const route of scenario.routes) {
        const single = singles.get(route.name)!;
        const match = findRoute(single.router, "GET", path);
        alone.set(route.name, !!match);
        const re = single.regexp;
        if (!re || path === "") continue;
        const groups = path.match(re)?.groups;
        const matched = re.test(path);
        const label = `${route.path} on ${path}`;
        if (route.regexp === "overmatch") {
          if (match && !matched) expect(matched, `regexp ⊇ router: ${label}`).toBe(true);
          continue;
        }
        if (matched !== !!match) expect(matched, `regexp ≡ router: ${label} (${re})`).toBe(!!match);
        if (match && route.regexp !== "paths") {
          const params = withoutAlias(single.router, { ...match.params });
          const captures = regexpParams(groups);
          if (key(captures) !== key(params)) {
            expect(captures, `regexp captures: ${label}`).toEqual(params);
          }
        }
      }
      for (const method of methods) {
        const names = new Set(matchers[0]!.findAll(method, path).map((r) => r!.name));
        for (const route of scenario.routes) {
          const routeMethod = route.method ?? "GET";
          const listed = (routeMethod === "" || routeMethod === method) && alone.get(route.name)!;
          if (names.has(route.name) !== listed) {
            expect(names.has(route.name), `findAll lists ${route.path} on ${method} ${path}`).toBe(
              listed,
            );
          }
        }
      }
    }
  });

  if (scenario.invalid?.length) {
    it("rejects invalid patterns", () => {
      for (const pattern of scenario.invalid!) {
        expect(() => addRoute(createRouter(), "GET", pattern, {}), pattern).toThrow(/^rou3: /);
        expect(() => routeToRegExp(pattern), pattern).toThrow(/^rou3: /);
      }
    });
  }
}

function buildMatchers(router: RouterContext<{ name: string }>, normalize: boolean) {
  const opts = { normalize };
  const one = (r: MatchedRoute<{ name: string }> | undefined): Result =>
    r ? { name: r.data.name, params: r.params && { ...r.params } } : null;
  const many = (rs: MatchedRoute<{ name: string }>[]) => rs.map((r) => one(r));
  const jit = compileRouter(router, opts);
  const jitAll = compileRouter(router, { ...opts, matchAll: true });
  const aot = evalAOT(compileRouterToString(router, opts));
  const aotAll = evalAOT(compileRouterToString(router, { ...opts, matchAll: true }));
  return {
    normalize,
    find: (m: string, p: string) => one(findRoute(router, m, p, opts)),
    findAll: (m: string, p: string) => many(findAllRoutes(router, m, p, opts)),
    jit: (m: string, p: string) => one(jit(m, p)),
    jitAll: (m: string, p: string) => many(jitAll(m, p)),
    aot: (m: string, p: string) => one(aot(m, p)),
    aotAll: (m: string, p: string) => many(aotAll(m, p)),
  };
}

function singleRoute(route: Route) {
  const router = createRouter<{ name: string }>();
  addRoute(router, "GET", route.path, { name: route.name });
  const skip = !DUPLICATE_NAMED_GROUPS && needsDuplicateNames(route.path);
  return { router, regexp: skip ? undefined : routeToRegExp(route.path) };
}

/** A comparison key that keeps `undefined` values (a present `undefined` param differs). */
function key(value: unknown): string {
  return JSON.stringify(value, (_, v) => (v === undefined ? "\0undefined" : v));
}

function regexpParams(groups: Params = {}): Params {
  const params: Params = {};
  for (const key in groups) {
    if (groups[key] !== undefined) {
      params[/^_\d+$/.test(key) ? key.slice(1) : fromGroupName(key)] = groups[key];
    }
  }
  return params;
}

/** Methods the scenario uses, the method-agnostic `""` and one nobody registers. */
function scenarioMethods(scenario: Scenario): string[] {
  const methods = new Set(["GET", "", "PATCH"]);
  for (const r of scenario.routes) if (r.method) methods.add(r.method);
  for (const c of scenario.cases) if (c.method) methods.add(c.method);
  return [...methods];
}

/** Case paths, `probes`, and mutations an attacker or a sloppy client would try. */
function probePaths(scenario: Scenario): string[] {
  const paths = new Set<string>(["/", "", "//"]);
  for (const base of scenario.cases.map((c) => c.path).concat(scenario.probes || [])) {
    const segments = base.split("/");
    for (const p of [base, base + "/", base + "//", base + "/.", base + "/x", base.toUpperCase()]) {
      paths.add(p);
    }
    for (let i = 1; i < segments.length; i++) {
      const at = (s: string) => segments.toSpliced(i, 1, s).join("/");
      paths
        .add(at(""))
        .add(at(".."))
        .add(at("%2e%2e"))
        .add(at(segments[i] + "%2F"));
      paths.add(segments.toSpliced(i, 0, "").join("/")); // a doubled slash before it
      paths.add(segments.toSpliced(i, 1).join("/")); // segment dropped
      // A slash encoded (not the leading one: lookup paths start with `/`)
      if (i > 1) paths.add(segments.slice(0, i).join("/") + "%2F" + segments.slice(i).join("/"));
    }
  }
  return [...paths];
}
