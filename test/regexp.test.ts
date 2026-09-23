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

      for (const path of expected.noMatch || []) {
        expect(findRoute(router, "", path), path).toBeUndefined();
        expect(path.match(regex), path).toBeNull();
      }

      expect(regex.source).toBe(expected.regex.source);
    });
  }

  // The regex must be a drop-in for the router: consumers use it as a guard or
  // scope check, so any path where it disagrees with `findRoute` is a bypass
  // (regex misses a routed path) or a false positive (#200). Sweep every
  // pattern built from the segment forms below against every short path,
  // including empty segments and runs of trailing slashes.
  it("matches exactly the paths findRoute matches", () => {
    // `""` is an empty middle segment and `{b}?` an optional one; both can turn
    // into a trailing empty segment the tree drops (`/docs/{v2}?/:page?`).
    const units = [
      "a",
      "",
      "{b}?",
      ":x",
      "*",
      "**",
      "**:r",
      ":x?",
      ":x+",
      ":x*",
      ":x(\\d+)",
      ":x(\\d+)?",
    ];
    const tails = ["", "a", ":y", "*", ":y?", "**", "*.png", "x-:y", "b{.json}?"];
    const patterns = new Set([
      "/",
      "/a{/b}?",
      "/a/b{s}?",
      "/a/:x+/b{/c}?",
      "/{en}?/:page?",
      ...Object.keys(routes),
    ]);
    for (const u of units) {
      for (const t of tails) {
        patterns.add(t ? `/${u}/${t}` : `/${u}`);
        patterns.add(t ? `/a/${u}/${t}` : `/a/${u}`);
      }
    }
    const paths = ["/", "//", "///"];
    const walk = (prefix: string, depth: number) => {
      for (const seg of ["a", "b", "1", "x.png", ""]) {
        const path = `${prefix}/${seg}`;
        paths.push(path, `${path}/`, `${path}//`, `${path}///`);
        if (depth > 1) walk(path, depth - 1);
      }
    };
    walk("", 3);

    const mismatches: string[] = [];
    for (const pattern of patterns) {
      // Known router limitation, not a regex bug: the tree drops the constraint
      // of a repeated param (`:id(\d+)+` is stored as `**:id`).
      if (/\)[+*]$/.test(pattern)) continue;
      const router = createRouter();
      addRoute(router, "", pattern, true);
      const regex = routeToRegExp(pattern);
      for (const path of paths) {
        const routed = findRoute(router, "", path) !== undefined;
        if (routed !== regex.test(path)) {
          mismatches.push(`${pattern} ${path} (${routed ? "router" : "regex"} only)`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

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
