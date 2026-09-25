import { describe, it, expect } from "vitest";
import { routeToRegExp, createRouter, addRoute, findRoute } from "../src/index.ts";
import { fromGroupName } from "../src/_group-names.ts";
import {
  type Captures,
  regexpCases as routes,
  LOOKBEHIND_ROUTES,
  PCRE2_DUPLICATE_NAME_ROUTES,
  sweepPaths,
  sweepPatterns,
} from "./_regexp-cases.ts";

/**
 * Regex groups keyed like router params (escaped names decoded, `_N` -> `N`).
 * Every group is kept, `undefined` when unset.
 */
function normalizeGroups(groups?: Record<string, string | undefined>): Captures {
  const normalized: Record<string, string | undefined> = {};
  for (const key in groups) {
    normalized[fromGroupName(key).replace(/^_(\d+)$/, "$1")] = groups[key];
  }
  return normalized;
}

/** Drop unset captures (`undefined`, which the router also uses, #198). */
function definedCaptures(captures: Captures = {}): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const key in captures) {
    if (captures[key] !== undefined) defined[key] = captures[key];
  }
  return defined;
}

describe("routeToRegExp", () => {
  for (const [route, expected] of Object.entries(routes)) {
    it(`should convert route "${route}" to regex "${expected.regex.source}"`, () => {
      const router = createRouter();
      addRoute(router, "", route, { route });

      const regex = routeToRegExp(route);

      for (const entry of expected.match) {
        const [path, groups = {}, params = groups] = entry;
        // A router override must say something the groups don't.
        if (entry.length > 2) {
          expect(definedCaptures(params), path).not.toEqual(definedCaptures(groups));
        }

        const found = findRoute(router, "", path);
        expect(found, path).toMatchObject({ data: { route } });
        expect(definedCaptures(found?.params), path).toEqual(definedCaptures(params));

        const match = path.match(regex);
        expect(match, path).not.toBeNull();
        // Exact: an extra group, a missing one, or `""` vs unset all fail.
        expect(normalizeGroups(match?.groups), path).toStrictEqual(groups);
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
  // pattern from `sweepPatterns()` against every short path from `sweepPaths()`,
  // including empty segments and runs of trailing slashes.
  it("matches exactly the paths findRoute matches", () => {
    const paths = sweepPaths();
    const mismatches: string[] = [];
    for (const pattern of sweepPatterns()) {
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

  // Constraints that can match `/` (`.+`, `[^.]+`, `\S+`) are not modeled
  // mid-path: the regex lets them span segments (`/a/:x(.+)` matches `/a/b/c`),
  // so the sweep above leaves them out. The trailing slash lookup strips must
  // still never land inside them: on every path with at most one segment after
  // the prefix, plus at most one trailing slash, regex and router agree on the
  // match and on the captures (an unset group stands for the router's `""`).
  it("keeps the stripped trailing slash out of slash-capable constraints", () => {
    const units = [
      ":x(.+)",
      ":x([^.]+)",
      ":x(\\S+)",
      "(.+)",
      "pre-:x(.+)",
      ":x(.+)?",
      ":x([^.]+)?",
      ":x(.+\\.png)",
      ":x(.*)",
      ":x(.*)?",
    ];
    const mismatches: string[] = [];
    for (const prefix of ["", "/a"]) {
      const paths = new Set([prefix || "/", `${prefix}/`]);
      for (const seg of ["a", "b", "x.png", "pre-a", ""]) {
        paths.add(`${prefix}/${seg}`).add(`${prefix}/${seg}/`);
      }
      for (const unit of units) {
        const pattern = `${prefix}/${unit}`;
        const router = createRouter();
        addRoute(router, "", pattern, true);
        const regex = routeToRegExp(pattern);
        for (const path of paths) {
          const routed = findRoute(router, "", path);
          const match = path.match(regex);
          if (!routed !== !match) {
            mismatches.push(`${pattern} ${path} (${routed ? "router" : "regex"} only)`);
            continue;
          }
          const groups = normalizeGroups(match?.groups) || {};
          const params: Record<string, string | undefined> = routed?.params || {};
          for (const key of new Set([...Object.keys(groups), ...Object.keys(params)])) {
            if ((groups[key] ?? "") !== (params[key] ?? "")) {
              mismatches.push(`${pattern} ${path} ${key}: ${groups[key]} != ${params[key]}`);
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  // The ending analysis tokenizes the emitted (JS) body: `[]` and `[^]` close
  // immediately there, unlike PCRE where a leading `]` is a literal.
  it("tokenizes JS character classes in constraints", () => {
    const paths = ["/a/b", "/a/b/", "/a/b/c", "/a/b/c/", "/a/b//"];
    for (const pattern of ["/a/:x([]?b)/:y", "/a/:x([]|b)/:y", "/a/:x([^]*)/:y"]) {
      const router = createRouter();
      addRoute(router, "", pattern, true);
      const regex = routeToRegExp(pattern);
      for (const path of paths) {
        expect(regex.test(path), `${pattern} ${path}`).toBe(
          findRoute(router, "", path) !== undefined,
        );
      }
    }
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

  // RE2-family engines (Go, Rust `regex`, RE2) have no look-around. Only the
  // shapes tracked in LOOKBEHIND_ROUTES may still need the look-behind suffix.
  it("emits no look-behind outside LOOKBEHIND_ROUTES", () => {
    for (const route of Object.keys(routes)) {
      const source = routeToRegExp(route).source;
      expect(/\(\?<[=!]/.test(source), `look-behind in "${route}": ${source}`).toBe(
        LOOKBEHIND_ROUTES.has(route),
      );
    }
  });
});

// A route expansion that declares a param name twice would emit a duplicate
// named group. Engines disagree on whether that compiles: V8 (Node 24) accepts
// it when one copy sits inside an alternative (the `**:name` / `:name+` ending),
// Bun, Deno, PCRE2 and RE2 reject it. `routeToRegExp` rejects it up front so
// every runtime gets the same `rou3:` error.
describe("routeToRegExp: duplicate param names", () => {
  it.each([
    ["/files/:path/**:path", "path"],
    ["/a/:x/:x+", "x"],
    ["/u/:id/:id", "id"],
    ["/a/:id(\\d+)/:id", "id"],
    ["/a/:x/:x?", "x"],
    ["/a/:x/:x*", "x"],
    ["/a/:x/:x(\\d+)?", "x"],
    // Mixed segments (`-` is a name character, so `.` separates here).
    ["/a/:x.:x", "x"],
    ["/a/:x(\\d+).:x", "x"],
    ["/a/:x/p.:x", "x"],
    // A name inside an optional group plus the same name outside it: inline
    // (whole-segment and mid-segment) and expanded-alternation paths.
    ["/a/:x{/b/:x}?", "x"],
    ["/a/:x(\\d+){-:x}?", "x"],
    ["/a{/:x}?/:x", "x"],
    // `**` is the `_` param (the router reports it as `params._`).
    ["/a/:_/**", "_"],
  ])("rejects %s", (route, name) => {
    expect(() => routeToRegExp(route)).toThrowError(`rou3: duplicate param name "${name}"`);
  });

  // Duplicates are per expansion: the alternation fallback repeats a name once
  // per branch, and generated unnamed captures (`_N`) never collide.
  it.each([
    ...PCRE2_DUPLICATE_NAME_ROUTES,
    "/media/:name{.webp}?",
    // Expands to `/a/**:x` | `/a/:x`: one `x` per branch.
    "/a/:x*/:x",
    "/a/*/*",
    "/a/(\\d+)/(\\d+)",
    "/a/*/b/*.png/(\\d+)",
    // `:0` escapes to `__rou3_esc_0`, distinct from the unnamed `*` (`_0`).
    "/w/:0/*",
  ])("accepts %s", (route) => {
    expect(() => routeToRegExp(route)).not.toThrow();
  });
});
