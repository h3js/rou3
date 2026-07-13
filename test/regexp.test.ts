import { describe, it, expect } from "vitest";
import { routeToRegExp, createRouter, addRoute, findRoute } from "../src/index.ts";
import { fromGroupName } from "../src/_group-names.ts";
import { regexpCases as routes, PCRE2_DUPLICATE_NAME_ROUTES } from "./_regexp-cases.ts";

function normalizeGroups(groups?: Record<string, string>) {
  if (!groups) {
    return groups;
  }

  const normalized: Record<string, string> = {};
  for (const key in groups) {
    const normalizedKey = fromGroupName(key).replace(/^_(\d+)$/, "$1");
    normalized[normalizedKey] = groups[key];
  }

  return normalized;
}

describe("routeToRegExp", () => {
  for (const [route, expected] of Object.entries(routes)) {
    it(`should convert route "${route}" to regex "${expected.regex.source}"`, () => {
      const router = createRouter();
      addRoute(router, "", route, { route });

      const regex = routeToRegExp(route);

      for (const [path, params] of expected.match) {
        expect(findRoute(router, "", path)).toMatchObject(
          params
            ? {
                data: { route },
                params,
              }
            : { data: { route } },
        );

        const match = path.match(regex);
        expect(match, path).not.toBeNull();
        if (params) {
          expect(normalizeGroups(match?.groups)).toMatchObject(params);
        }
      }

      expect(regex.source).toBe(expected.regex.source);
    });
  }

  // Trailing single optional groups are compiled inline (`(?:...)?`) rather than
  // expanded into an alternation of full routes, so a param before the group is
  // never emitted twice. Duplicate named groups are valid JS but rejected by
  // PCRE2-family engines (see test/regexp.pcre.test.ts). The only exceptions are
  // routes that cannot be inlined safely and fall back to alternation, tracked
  // explicitly in PCRE2_DUPLICATE_NAME_ROUTES.
  it("does not emit duplicate named capture groups", () => {
    for (const route of Object.keys(routes)) {
      if (PCRE2_DUPLICATE_NAME_ROUTES.has(route)) {
        continue;
      }
      const names = [...routeToRegExp(route).source.matchAll(/\(\?<([\w]+)>/g)].map((m) => m[1]);
      const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
      expect(duplicates, `duplicate named groups for "${route}"`).toEqual([]);
    }
  });

  // Complements the check above: routes tracked as non-inlinable really do emit
  // duplicate named groups (guards against the set going silently stale).
  it("known fallback routes emit duplicate named capture groups", () => {
    for (const route of PCRE2_DUPLICATE_NAME_ROUTES) {
      const names = [...routeToRegExp(route).source.matchAll(/\(\?<([\w]+)>/g)].map((m) => m[1]);
      const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
      expect(duplicates, `expected duplicate named groups for "${route}"`).not.toEqual([]);
    }
  });
});
