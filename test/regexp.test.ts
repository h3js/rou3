import { describe, it, expect, vi, afterEach } from "vitest";
import { routeToRegExp, createRouter, addRoute, findRoute, routeNodeKeys } from "../src/index.ts";
import { fromGroupName } from "../src/_group-names.ts";
import { expandGroupDelimiters } from "../src/_group-delimiters.ts";
import { expandModifiers, splitRoute } from "../src/operations/_utils.ts";
import { canBeEmpty, canEndInSlash } from "../src/_regexp-scan.ts";
import {
  type Captures,
  DUPLICATE_NAMED_GROUPS,
  regexpCases as routes,
  LOOKAHEAD_ROUTES,
  LOOKBEHIND_ROUTES,
  PCRE2_DUPLICATE_NAME_ROUTES,
  SWEEP_DUPLICATE_NAME_PATTERNS,
  SWEEP_LOOKAHEAD_PATTERNS,
  SWEEP_LOOKBEHIND_PATTERNS,
  duplicateGroupNames,
  hasLookahead,
  hasLookbehind,
  RESERVED_SYNTAX_ROUTES,
  TWO_CATCH_ALL_ROUTES,
  UNCLOSED_GROUP_ROUTES,
  sweepPaths,
  sweepPatterns,
  unsupportedSweepPatterns,
} from "./_regexp-cases.ts";

// The `rou3:` error `routeToRegExp` throws where the engine lacks duplicate
// named groups (Node 22).
const NEEDS_DUPLICATE_NAMES =
  /^rou3: the regex for ".*" repeats a named group across alternatives, which needs duplicate named groups support/;

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

  // `sweepPatterns()` has no escapes and `sweepPaths()` no escaped chars: a
  // `\x` is a literal `x` in both, wherever it sits in the pattern (#227).
  it("reads escapes like findRoute", () => {
    const chars = [".", "b", "\\", "*", "?", "+", ":", "(", ")", "{", "}", "-", "$", "^", "|", "["];
    const patterns = chars.flatMap((c) => [
      `/a\\${c}b`,
      `/a\\${c}:x`,
      `/:x\\${c}b`,
      `/a/\\${c}`,
      `/a/\\${c}*`,
      `/a/\\${c}(\\d+)`,
    ]);
    const paths = chars.flatMap((c) => [
      `/a${c}b`,
      `/a\\${c}b`,
      `/a${c}1`,
      `/a\\${c}1`,
      `/1${c}b`,
      `/1\\${c}b`,
      `/a/${c}`,
      `/a/\\${c}`,
      `/a/${c}1`,
      `/a/\\${c}1`,
      `/a/${c}x`,
    ]);
    const mismatches: string[] = [];
    for (const pattern of patterns) {
      const router = createRouter();
      addRoute(router, "", pattern, true);
      const regex = routeToRegExp(pattern);
      for (const path of paths) {
        const found = findRoute(router, "", path);
        const match = path.match(regex);
        if (!!found !== !!match) {
          mismatches.push(`${pattern} ${path} (${found ? "router" : "regex"} only)`);
        } else if (match) {
          const captures = definedCaptures(normalizeGroups(match.groups));
          if (JSON.stringify(captures) !== JSON.stringify(definedCaptures(found?.params))) {
            mismatches.push(`${pattern} ${path} (captures)`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  // Hand-picked shapes the sweeps don't generate: escaped modifiers (`\:x\?`
  // is no optional param, `\:x?` throws) and regex chars outside a constraint
  // in a dynamic segment (`$`, `^`, `|`, `[`, `)` are literals there, as in a
  // static one).
  it("matches like findRoute for escaped modifiers and literal regex chars", () => {
    const patterns = [
      "/a//\\:x\\?",
      "///b\\:x\\?",
      "/a/*/\\:x\\?",
      "/a/:x\\?",
      "/a/:x(\\))?",
      "/a/:x(a\\)b)?/c",
      "/\\:x*",
      "/a//\\:x+",
      "/a/\\:x+/b",
      "/api/*$",
      "/x/^:id",
      "/x/:id$",
      "/a/x|:y",
      "/secret/:id|x/admin",
      "/a/:x[0-9]",
      "/a/:x)b",
      "/a/:x]b",
      "/a/:x{}b",
    ];
    const paths = [
      "/a//:x?",
      "/a",
      "/a/",
      "///b:x?",
      "/",
      "/a/:x?",
      "/a/1/:x?",
      "/a/)",
      "/a/)/",
      "/a/a)b/c",
      "/a/c",
      "/:x*",
      "/:x",
      "/a//:x+",
      "/a/:x+/b",
      "/a/:x/b",
      "/api/v1$",
      "/api/v1/",
      "/api/v1",
      "/x/^1",
      "/x/1",
      "/x/1$",
      "/x/1/",
      "/a/x|1",
      "/other",
      "/secret/1|x/admin",
      "/secret/1/anything",
      "/a/1[0-9]",
      "/a/15",
      "/a/1)b",
      "/a/1]b",
      "/a/1b",
    ];
    const mismatches: string[] = [];
    for (const pattern of patterns) {
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

  // The one documented exception to "regex ≡ router": a constraint that can
  // match `/` spans segments in the inline regex, while the tree splits
  // first. The regex may match more (a guard still runs), never less (#227).
  it("over-matches only for constraints that can match `/`", () => {
    const paths = sweepPaths();
    const underMatches: string[] = [];
    let overMatches = 0;
    for (const pattern of ["/foo/(.*)", "/:x(.*)", "/a/:x([^b]+)", "/a/:x(\\D+)/b", "/:x(.+)?"]) {
      const router = createRouter();
      addRoute(router, "", pattern, true);
      const regex = routeToRegExp(pattern);
      for (const path of paths) {
        const routed = findRoute(router, "", path) !== undefined;
        if (routed && !regex.test(path)) underMatches.push(`${pattern} ${path}`);
        if (!routed && regex.test(path)) overMatches++;
      }
    }
    expect(underMatches).toEqual([]);
    expect(overMatches).toBeGreaterThan(0);
  });

  // The router splits paths on `/` only, so a line terminator is an ordinary
  // char to it (`/admin/**:p` routes `/admin/x\ry` with `p: "x\ry"`). A JS `.`
  // excludes `\n`, `\r`, U+2028 and U+2029, and other engines disagree on `\r`
  // and U+2028, so a catch-all built on `.` lets a guard miss a routed path.
  it("matches line terminators in catch-alls like findRoute", () => {
    const routes = [
      "/a/**",
      "/a/**:p",
      "/a/:p+",
      "/a/:p*",
      "/**",
      "/**:p",
      "/:p+",
      "/:p*",
      "/a{/v1/**}?",
      "/a{/v1/:p*}?",
      // A required catch-all inside a group, and after a constraint that can
      // match `/`.
      "/a{/v1/**:p}?",
      "/a/:x(\\S+)/**:p",
    ];
    const paths: string[] = [];
    for (const lt of ["\n", "\r", "\u2028", "\u2029"]) {
      for (const path of [
        `/${lt}`,
        `/a/${lt}`,
        `/a/x${lt}y`,
        `/a/${lt}/b`,
        `/a/b/x${lt}`,
        `/a/b/${lt}${lt}`,
        `/a/v1/${lt}`,
        `/a/v1/x${lt}/y${lt}`,
      ]) {
        paths.push(path, `${path}/`, `${path}//`);
      }
    }
    const mismatches: string[] = [];
    let routed = 0;
    for (const route of routes) {
      const router = createRouter();
      addRoute(router, "", route, true);
      const regex = routeToRegExp(route);
      for (const path of paths) {
        const found = findRoute(router, "", path);
        const match = path.match(regex);
        const where = `${route} ${JSON.stringify(path)}`;
        if (!found !== !match) {
          mismatches.push(`${where} (${found ? "router" : "regex"} only)`);
          continue;
        }
        if (!found || !match) continue;
        routed++;
        const groups = definedCaptures(normalizeGroups(match.groups));
        const params = definedCaptures(found.params);
        for (const key of new Set([...Object.keys(groups), ...Object.keys(params)])) {
          // An unset group where the router reports `""` is the accepted gap.
          if (groups[key] !== params[key] && !(groups[key] === undefined && params[key] === "")) {
            mismatches.push(`${where} ${key}: ${JSON.stringify([groups[key], params[key]])}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(routed).toBeGreaterThan(200);
  });

  // Constraints that can match `/` (`.+`, `[^.]+`, `\S+`) are not modeled
  // mid-path: the regex lets them span segments (`/a/:x(.+)` matches `/a/b/c`),
  // so the sweep above leaves them out. The trailing slash lookup strips must
  // still never land inside them: on every path with at most one segment after
  // the prefix, plus at most one trailing slash, regex and router agree on the
  // match and on the captures (an unset group stands for the router's `""`).
  // A `.` the user wrote keeps its JS meaning (no line terminators), as in the
  // router, which runs the constraint in JS.
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
      for (const seg of ["a", "b", "x.png", "pre-a", "", "a\nb", "\u2028", "x\r.png"]) {
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

  // Captures must agree too: consumers read params off the regex. The one
  // accepted difference is the look-behind-free ending of a required
  // segment that can be empty (`:x`, `**:x`, `:x+`, see `withTrailingSlash`):
  // where that segment is empty, at the end of the path or before optional
  // ones, it leaves the group unset where the router reports `""`. Anything
  // else must be listed in KNOWN_CAPTURE_DIFFS.
  it("captures what findRoute captures", () => {
    const paths = sweepPaths();
    const unexpected: string[] = [];
    const seen = new Set<string>();
    let accepted = 0;
    for (const pattern of sweepPatterns()) {
      const router = createRouter();
      addRoute(router, "", pattern, true);
      const regex = routeToRegExp(pattern);
      const known = KNOWN_CAPTURE_DIFFS.get(pattern);
      for (const path of paths) {
        const found = findRoute(router, "", path);
        const match = path.match(regex);
        if (!found || !match) continue;
        const groups = definedCaptures(normalizeGroups(match.groups));
        const params = definedCaptures(found.params);
        const keys = [...new Set([...Object.keys(groups), ...Object.keys(params)])].filter(
          (key) => groups[key] !== params[key],
        );
        if (keys.length === 0) continue;
        const rest = keys.filter((key) => !isRequiredSegmentGap(router, path, key, groups, params));
        if (rest.length === 0) {
          accepted++;
        } else if (known?.test(pattern, rest, groups, params, path)) {
          seen.add(pattern);
        } else {
          unexpected.push(
            `${pattern} ${path}: regex ${fmt(groups)}, router ${fmt(params)}` +
              (known ? ` (listed only for: ${known.reason})` : ""),
          );
        }
      }
    }
    expect(unexpected).toEqual([]);
    // A listed pattern that no longer differs must be removed from the list.
    // (Patterns this engine can't compile, see DUPLICATE_NAMED_GROUPS, aren't swept.)
    const unsupported = new Set(unsupportedSweepPatterns());
    expect(
      [...KNOWN_CAPTURE_DIFFS.keys()].filter(
        (pattern) => !seen.has(pattern) && !unsupported.has(pattern),
      ),
    ).toEqual([]);
    expect(accepted).toBeGreaterThan(0);
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

  // `**` is emitted as the `_` group, and a param may be named `_` too. The
  // ending must follow the route's kind, not the group name: the router leaves
  // `:_?` / `:_*` unset on `/a/` (and `/`), where `**` reports `""`. A root
  // `:x*` is unset on `/` for any name.
  it("does not mistake a param named `_` for `**`", () => {
    const cases: [route: string, path: string, params: Record<string, string>][] = [
      ["/a/:_?", "/a/", {}],
      ["/a/:_?", "/a//", { _: "" }],
      ["/a/:_*", "/a/", {}],
      ["/a/:_*", "/a//", { _: "" }],
      ["/a/:_*", "/a/b/", { _: "b" }],
      ["/a/**", "/a/", { _: "" }],
      ["/:_?", "/", {}],
      ["/:_*", "/", {}],
      ["/:_*", "//", { _: "" }],
      ["/:x*", "/", {}],
      ["/:x*", "//", { x: "" }],
      ["/:x*", "/a/b/", { x: "a/b" }],
      ["/**", "/", { _: "" }],
    ];
    for (const [route, path, params] of cases) {
      const router = createRouter();
      addRoute(router, "", route, true);
      expect(findRoute(router, "", path)?.params || {}, `router: ${route} ${path}`).toEqual(params);
      const match = path.match(routeToRegExp(route));
      expect(match, `${route} ${path}`).not.toBeNull();
      expect(normalizeGroups(match?.groups), `${route} ${path}`).toEqual(params);
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
      const duplicates = duplicateGroupNames(routeToRegExp(route).source);
      expect(duplicates, `duplicate named groups for "${route}"`).toEqual([]);
    }
  });

  // Complements the check above: routes tracked as non-inlinable really do emit
  // duplicate named groups (guards against the set going silently stale).
  it("known fallback routes emit duplicate named capture groups", () => {
    for (const route of PCRE2_DUPLICATE_NAME_ROUTES) {
      if (!DUPLICATE_NAMED_GROUPS) {
        expect(() => routeToRegExp(route)).toThrowError(NEEDS_DUPLICATE_NAMES);
        continue;
      }
      const duplicates = duplicateGroupNames(routeToRegExp(route).source);
      expect(duplicates, `expected duplicate named groups for "${route}"`).not.toEqual([]);
    }
  });

  // RE2-family engines (Go, Rust `regex`, RE2) have no look-around. Only the
  // shapes tracked in LOOKBEHIND_ROUTES may still need the look-behind suffix,
  // and only those in LOOKAHEAD_ROUTES hold a param with a look-ahead.
  it("emits look-arounds only in LOOKBEHIND_ROUTES / LOOKAHEAD_ROUTES", () => {
    for (const route of Object.keys(routes)) {
      const source = routeToRegExp(route).source;
      expect(hasLookbehind(source), `look-behind in "${route}": ${source}`).toBe(
        LOOKBEHIND_ROUTES.has(route),
      );
      expect(hasLookahead(source), `look-ahead in "${route}": ${source}`).toBe(
        LOOKAHEAD_ROUTES.has(route),
      );
    }
  });

  // The same, over the whole sweep corpus. The RE2 sweep in
  // test/regexp.pcre.test.ts skips exactly these patterns; pinning them here
  // (no ripgrep needed) makes a change that moves routes onto the look-behind
  // suffix, or into a duplicate-name alternation, fail loudly.
  it("pins the sweep patterns RE2 engines reject", () => {
    const lookbehind: string[] = [];
    const lookahead: string[] = [];
    const duplicates: string[] = [];
    for (const pattern of sweepPatterns()) {
      const source = routeToRegExp(pattern).source;
      if (hasLookbehind(source)) lookbehind.push(pattern);
      if (hasLookahead(source)) lookahead.push(pattern);
      if (duplicateGroupNames(source).length > 0) duplicates.push(pattern);
    }
    expect(lookbehind.sort()).toEqual([...SWEEP_LOOKBEHIND_PATTERNS].sort());
    expect(lookahead.sort()).toEqual([...SWEEP_LOOKAHEAD_PATTERNS].sort());
    // Without duplicate named groups, `sweepPatterns()` leaves exactly these out.
    expect((DUPLICATE_NAMED_GROUPS ? duplicates : unsupportedSweepPatterns()).sort()).toEqual(
      [...SWEEP_DUPLICATE_NAME_PATTERNS].sort(),
    );
  });
});

// `canEndInSlash` decides whether an ending may drop the look-behind, so a
// `false` must be a proof: anything it can't reason about counts as able to
// end in `/` (and an unparseable fragment as able to be empty).
describe("regex-body scans", () => {
  it("treats anchors and word boundaries as zero-width", () => {
    expect(canEndInSlash("\\w+\\b")).toBe(false);
    expect(canEndInSlash("\\d+$")).toBe(false);
    expect(canEndInSlash("[^.]+\\b")).toBe(true);
  });

  it("assumes backreferences and unparseable atoms can end in a slash", () => {
    expect(canEndInSlash("(a)\\1")).toBe(true);
    expect(canEndInSlash("\\k<x>")).toBe(true);
    expect(canEndInSlash("[z-a]")).toBe(true);
  });

  it("assumes an unparseable fragment can be empty", () => {
    expect(canBeEmpty("(?<x>a)\\k<y>")).toBe(true);
  });
});

// `addRoute` allows one `**` per route (a `:x+` / `:x*` before the last
// segment is one); `routeToRegExp` rejects the others with the same error.
describe("routeToRegExp: more than one `**`", () => {
  it.each(TWO_CATCH_ALL_ROUTES)("%s throws like addRoute", (route) => {
    // Quoting the route as written, not its rewritten form (`:x+` is `**:x`)
    const message = `rou3: a route can have only one \`**\`, \`:name+\` or \`:name*\` (${route})`;
    expect(() => addRoute(createRouter(), "", route)).toThrow(message);
    expect(() => routeToRegExp(route)).toThrow(message);
  });
});

// A pattern is split on `/` before its constraints are read, so a `/` inside
// one cut it in two, and a `(` that never closes left an unterminated group:
// `new RegExp` threw a raw `SyntaxError` naming internal group names (#199).
describe("routeToRegExp: a `(` that does not close in its segment", () => {
  it.each(UNCLOSED_GROUP_ROUTES)("%s throws like addRoute", (route) => {
    const message = `rou3: a \`(\` must close in its own segment, escape a literal one as \`\\(\` (${route})`;
    expect(() => addRoute(createRouter(), "", route)).toThrow(message);
    expect(() => routeToRegExp(route)).toThrow(message);
    expect(() => routeNodeKeys(route)).toThrow(message);
  });

  it.each([
    "/a/:x(\\d+)/b",
    "/a/(\\d+)/(b|c)",
    "/a{/:x(\\d+)}?/b",
    "/a\\(/b",
    "/a/\\(x/y\\)",
    "/a\\(b",
    "/a)b",
  ])("%s is accepted", (route) => {
    expect(() => addRoute(createRouter(), "", route)).not.toThrow();
    expect(() => routeToRegExp(route)).not.toThrow();
  });
});

// Syntax with no meaning yet throws, so it can be given one later instead of
// locking in what it happened to do (see `RESERVED_SYNTAX_ROUTES`).
describe("reserved pattern syntax", () => {
  // Accepted routes below whose regex falls back to an alternation with a
  // repeated named group (see DUPLICATE_NAMED_GROUPS).
  const ALTERNATION_ROUTES = new Set(["/a/**{.md}?"]);

  it.each(RESERVED_SYNTAX_ROUTES)("%s throws", (route) => {
    const message = new RegExp(`^rou3: .*\\(${route.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&")}\\)$`);
    expect(() => addRoute(createRouter(), "", route)).toThrow(message);
    expect(() => routeToRegExp(route)).toThrow(message);
    expect(() => routeNodeKeys(route)).toThrow(message);
  });

  it.each([
    "/a/:x(\\d+)?",
    "/a/:x(\\d+)?/b",
    "/a/:x?",
    "/a/:x+",
    "/a/:x*/b",
    "/a/pre-:x?",
    "/a/:x((?:a|b))",
    "/a/:x(\\d{2})",
    "/a/:x(a{1,2}){-:y}?",
    "/a/**:x/b",
    "/a{/**:x}?",
    "/a/**{.md}?",
    "/a/*.png",
    "/a/file-*-*.png",
    "/a/:x-*",
    "/a/(\\d+)/(a|b)",
    "/a/*/:x",
    "/v1/:id:cancel",
    "/c++/*",
    "/a/what\\?",
    "/a/:v2",
    "/a/:_0",
    "/a/:caf\\é",
    "/a/:x\\-id",
    "/a/:test-id",
    "/a/:x((?:a))",
    "/a/((?:b)c)",
    "/a/:x((?:a)|(?:b))",
    "/a/:x((?:(?:a)))",
    "/a/:x((?:a|b)c)",
    "/a/*b",
    "/a\\*\\*b",
    "/a/\\**",
    "/**.md",
    "/a/{b}?/{c}",
    "/a/{}",
    "/a/\\{b",
    "/a/b\\}",
    "/a/\\{\\{b\\}\\}",
    "/a/\\:",
    "/a/x\\:/:y",
    "/a/:x\\?",
    "/a/*\\+",
    "/a)b",
    "/a\\\\/b",
    "/a/:x\\\\",
    "/a/:x([^a])",
    "/a/:x([$^])",
    "/a/:x(\\^a\\$)",
    "/a/:x(a\\\\)",
    "/a/:x(a|(?:b))",
    "/a/:x(\\(?=a)",
    "/a/:x(\\\\?=a)",
    "/a/:x(\\\\1)",
    "/a/:x([\\]$])",
  ])("%s is accepted", (route) => {
    expect(() => addRoute(createRouter(), "", route)).not.toThrow();
    // Accepted syntax whose regex is an alternation repeating a named group
    // (a group right after a bare `**`): it compiles only where the engine
    // has duplicate named groups, and throws the engine error, not a syntax
    // one, elsewhere (Node 22).
    if (ALTERNATION_ROUTES.has(route) && !DUPLICATE_NAMED_GROUPS) {
      expect(() => routeToRegExp(route)).toThrowError(NEEDS_DUPLICATE_NAMES);
      return;
    }
    const regex = routeToRegExp(route);
    expect(duplicateGroupNames(regex.source).length > 0).toBe(ALTERNATION_ROUTES.has(route));
  });

  it("points a misplaced modifier at `:name` and at escaping", () => {
    // One message (bundle size) for modifier misuse, a `?` after plain text
    // and a mid-segment `**`.
    for (const route of [
      "/a/:x.png?",
      "/a/*?",
      "/a/:x*.png",
      "/a/pre-:x+",
      "/foo?",
      "/a/b?/c",
      "/a**b",
      "/a/x**",
      "/a/*.**",
    ]) {
      expect(() => addRoute(createRouter(), "", route), route).toThrow(
        "must follow a whole-segment `:name` (escape a literal one with `\\`)",
      );
    }
  });

  it("keeps escaped braces literal", () => {
    const router = createRouter();
    addRoute(router, "GET", "/a/\\{b\\}/:x", {});
    expect(findRoute(router, "GET", "/a/{b}/1")?.params).toEqual({ x: "1" });
    expect(routeToRegExp("/a/\\{b\\}/:x").test("/a/{b}/1")).toBe(true);
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
    // The router rejects it with the same error (across segments the later
    // value used to win silently, within one a raw `SyntaxError` was thrown),
    // quoting the route as written.
    const message = `rou3: duplicate param name "${name}" (${route})`;
    expect(() => routeToRegExp(route)).toThrowError(message);
    expect(() => addRoute(createRouter(), "", route)).toThrowError(message);
  });

  // Duplicates are per expansion: the alternation fallback repeats a name once
  // per branch, and generated unnamed captures (`_N`) never collide.
  it.each([
    ...PCRE2_DUPLICATE_NAME_ROUTES,
    "/media/:name{.webp}?",
    "/a/*/*",
    "/a/(\\d+)/(\\d+)",
    "/a/*/b/*.png/(\\d+)",
    // `:_0` escapes to `__rou3_esc___0`, distinct from the unnamed `*` (`_0`).
    "/w/:_0/*",
  ])("accepts %s", (route) => {
    if (!DUPLICATE_NAMED_GROUPS && PCRE2_DUPLICATE_NAME_ROUTES.has(route)) {
      expect(() => routeToRegExp(route)).toThrowError(NEEDS_DUPLICATE_NAMES);
      return;
    }
    expect(() => routeToRegExp(route)).not.toThrow();
    expect(() => addRoute(createRouter(), "", route)).not.toThrow();
  });
});

// The alternation fallback repeats a named group across branches; an engine
// without duplicate named groups (Node 22 / V8 < 12.5) threw a raw
// `SyntaxError: ... Duplicate capture group name` from `routeToRegExp`.
describe("routeToRegExp: engines without duplicate named groups", () => {
  const fallbackRoutes = ["/media/*{.webp}?", "/a{/:x}?{/:y}?", "/a/:rest*/b/*"];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Runs on every engine: a `RegExp` that rejects duplicate names like V8 12.4.
  it.each(fallbackRoutes)("%s throws a rou3: error (simulated engine)", (route) => {
    const NativeRegExp = RegExp;
    const StrictRegExp = new Proxy(NativeRegExp, {
      construct(target, args) {
        const source = String(args[0]);
        if (duplicateGroupNames(source).length > 0) {
          throw new SyntaxError(
            `Invalid regular expression: /${source}/: Duplicate capture group name`,
          );
        }
        return Reflect.construct(target, args);
      },
    });
    vi.stubGlobal("RegExp", StrictRegExp);
    let error: unknown;
    try {
      routeToRegExp(route);
    } catch (error_) {
      error = error_;
    }
    vi.unstubAllGlobals();
    expect(error).toBeInstanceOf(SyntaxError);
    expect((error as Error).message).toMatch(NEEDS_DUPLICATE_NAMES);
    expect((error as Error).message).toContain(`"${route}"`);
    expect(((error as Error).cause as Error).message).toContain("Duplicate capture group name");
  });

  it.runIf(!DUPLICATE_NAMED_GROUPS).each(fallbackRoutes)("%s throws a rou3: error", (route) => {
    expect(() => routeToRegExp(route)).toThrowError(NEEDS_DUPLICATE_NAMES);
  });

  it.runIf(DUPLICATE_NAMED_GROUPS).each(fallbackRoutes)("%s compiles", (route) => {
    expect(duplicateGroupNames(routeToRegExp(route).source)).not.toEqual([]);
  });
});

// A single optional group followed by more of the route used to fall back to
// an alternation that declared every shared param once per branch, which
// throws on engines without duplicate named groups (Node 22 / V8 12.4,
// PCRE2, RE2).
describe("routeToRegExp: optional group before more of the route (#213)", () => {
  const cases = [
    "/files/:name{.:ext}?",
    "/users{/:id}?/posts/:post",
    "/a/:x(\\d+){-:y}?/b",
    "/api/:v{/beta}?/:id",
    "/a/:x/{b}?/:y",
    "/:lang{.:region}?/:page",
    // A capture that can take the group's text keeps the alternation's value.
    "/users/:id([\\w.]+){.json}?/edit",
    "/a/:x([a-z-]+){-:y}?/b",
    "/a/:x(\\w+){s}?/b",
    "/a/:x(\\d+){1}?/b",
    "/a/:x(png|jpg){g}?/b",
    // A lazy `:name` earlier in the segment leaves the group its text.
    "/f/:x.a{.a}?/m",
  ];
  // These keep the alternation: a greedy capture earlier in the segment could
  // take the group's text, or the head can span a varying number of segments.
  const fallbacks = ["/f/*.a{.a}?/m", "/:h?/:x{/:id}?/", "/:h?{/b}?/b", "/:h?/*{/b}?/b"];
  const paths = [
    ...sweepPaths(),
    "/files/a.b",
    "/files/archive.tar.gz",
    "/files/.b",
    "/files/a.",
    "/files/a.b/",
    "/users/posts/1",
    "/users/7/posts/1",
    "/users/posts/posts/1",
    "/users/7/posts/",
    "/a/12-3/b",
    "/a/12/b",
    "/a/12-/b",
    "/api/v1/beta/7",
    "/api/v1/7",
    "/api/v1/beta",
    "/a/1/b/2",
    "/a/1//2",
    "/en.us/home",
    "/en/home",
    "/users/a.json/edit",
    "/users/a.b.json/edit",
    "/a/ab-c/b",
    "/a/posts/b",
    "/a/121/b",
    "/a/pngg/b",
    "/a/jpgg/b",
    "/f/1.a.a/m",
    "/a/1.2/posts",
    "/b/b",
    "/a/b/b",
  ];

  // The fallbacks need duplicate named groups (see DUPLICATE_NAMED_GROUPS).
  const swept = DUPLICATE_NAMED_GROUPS ? [...cases, ...fallbacks] : cases;

  it.each(swept)("%s routes like findRoute", (route) => {
    const regex = routeToRegExp(route);
    expect(duplicateGroupNames(regex.source).length > 0).toBe(fallbacks.includes(route));
    const router = createRouter();
    addRoute(router, "", route, true);
    for (const path of paths) {
      const found = findRoute(router, "", path);
      const match = path.match(regex);
      expect(!!match, `${path}: ${regex}`).toBe(!!found);
      if (found && match) {
        const groups = definedCaptures(normalizeGroups(match.groups));
        const params = definedCaptures(found.params);
        const keys = [...new Set([...Object.keys(groups), ...Object.keys(params)])].filter(
          (key) =>
            groups[key] !== params[key] && !isRequiredSegmentGap(router, path, key, groups, params),
        );
        expect(keys, `${path}: regex ${fmt(groups)}, router ${fmt(params)}`).toEqual([]);
      }
    }
  });
});

function fmt(captures: Record<string, string>): string {
  return JSON.stringify(captures);
}

/**
 * The accepted trade-off of the look-behind-free endings for a required
 * segment that can be empty: where it is empty (`/a//` for `/a/:x`, `/a//b`
 * for `/a/:x/:y?`), its group is unset and the router reports `""`. `key` is
 * that group iff for some empty segment of `path`, the route can end right
 * after it, with `key` taking it: cut there and filled in (`/a/z`), the path
 * is routed with `key: "z"`. After a `**`, segments count from the end of the
 * path, so cutting it moves `key`: there it is filled in and the rest kept
 * (`/**\/:x/:y?` on `/a///`: `/a/z//` gives `x: "z"`). (`**` has its own,
 * listed, zero-segment difference.)
 */
function isRequiredSegmentGap(
  router: ReturnType<typeof createRouter>,
  path: string,
  key: string,
  groups: Record<string, string>,
  params: Record<string, string>,
): boolean {
  if (key === "_" || key in groups || params[key] !== "") {
    return false;
  }
  const segments = path.split("/");
  return segments.some(
    (segment, i) =>
      i > 0 &&
      segment === "" &&
      (findRoute(router, "", `${segments.slice(0, i).join("/")}/z`)?.params?.[key] === "z" ||
        findRoute(router, "", segments.with(i, "z").join("/"))?.params?.[key] === "z"),
  );
}

interface CaptureDiff {
  reason: string;
  /** Whether a difference (`keys` differ, unset groups dropped) is this one. */
  test(
    pattern: string,
    keys: string[],
    groups: Record<string, string>,
    params: Record<string, string>,
    path: string,
  ): boolean;
}

// Pre-existing (same on main before the look-behind-free endings): the regex
// skips its whole optional `(?:/(?<_>…))?` group.
const ZERO_SEGMENT_CATCH_ALL: CaptureDiff = {
  reason: '`**` matching zero segments: `_` is unset in the regex, `""` in the router',
  test: (_pattern, keys, groups, params) =>
    keys.length === 1 && keys[0] === "_" && !("_" in groups) && params._ === "",
};

// Pre-existing: the regex's first optional group is greedy and takes a lone
// segment, while the router matches the `/*` expansion, which ends there.
const OPTIONAL_BEFORE_WILDCARD: CaptureDiff = {
  reason:
    "an optional param takes the segment the router gives a later optional (`x` vs the router's `0`)",
  test: (_pattern, _keys, groups, params) =>
    Object.keys(groups).length === 1 &&
    Object.keys(params).length === 1 &&
    Object.values(groups)[0] === Object.values(params)[0],
};

// Several optional segments after a catch-all (or a `:x*` before a `*`):
// the router ranks the routes the pattern registers from the end of the
// path, per path, while the regex's catch-all is lazy or greedy as a whole
// (see `lazyCatchAll` in src/regexp.ts) and a `:x*` expansion tries its
// branches in order. Exact captures would need an alternation of every
// route, with duplicate group names (which PCRE2 and RE2 reject). The regex
// still takes one of those routes: its captures are the params that route
// gives the path (a group unset where it gives `""`).
const OTHER_EXPANSION: CaptureDiff = {
  reason: "the regex takes another of the routes the pattern registers than the router picks",
  test: (pattern, _keys, groups, _params, path) =>
    expansions(pattern).some((route) => {
      const router = createRouter();
      addRoute(router, "", route, true);
      const found = findRoute(router, "", path);
      if (!found) return false;
      const params = definedCaptures(found.params);
      return Object.keys({ ...groups, ...params }).every(
        (key) => groups[key] === params[key] || (!(key in groups) && params[key] === ""),
      );
    }),
};

/** The routes `addRoute` registers for `pattern` (groups, then modifiers). */
function expansions(pattern: string): string[] {
  const groups = expandGroupDelimiters(pattern);
  if (groups) return groups.flatMap((route) => expansions(route));
  const modifiers = expandModifiers(splitRoute(pattern));
  return modifiers ? modifiers.flatMap((route) => expansions(route)) : [pattern];
}

/** Sweep patterns whose captures differ from the router beyond the accepted gap. */
const KNOWN_CAPTURE_DIFFS: ReadonlyMap<string, CaptureDiff> = new Map([
  ...[
    "/a/**",
    "/a/a/**",
    "//**",
    "/a//**",
    "/{b}?/**",
    "/a/{b}?/**",
    "/:x/**",
    "/a/:x/**",
    "/*/**",
    "/a/*/**",
    "/:x?/**",
    "/a/:x?/**",
    "/:x(\\d+)/**",
    "/a/:x(\\d+)/**",
    "/:x(\\d+)?/**",
    "/a/:x(\\d+)?/**",
    "/a{/b/**}?",
    "/a{/:x/**}?",
    "/a{/b/:x/**}?",
    "/:x/:y?/**",
    "/:x{.:e}?/**",
    "/a/:x{.:e}?/**",
    // Segments after `**`: its group is unset where it matches no segment
    // (with a prefix before it; at the root the leading slash doubles as the
    // separator and `_` is `""`).
    "/a/**/a",
    "/a/**/:y",
    "/a/**/*",
    "/a/**/*.png",
    "/a/**.png",
    "/a/**/b{.json}?",
    "/a/**/:y?",
    "/a/**/:page?",
    "/a/**/:n(\\d+)?",
    "/**/:y?",
    "/:x/**/a",
    "/:x(\\d+)/**/:y",
    "/a//**/b",
    "/a/**//b",
    "/a/:x?/**/b",
    "/**/:x/:y?",
    "/a/**/:y(\\d+)?",
    "/**/:y{/c}?",
    "/a/**/:y{/c}?",
    "/a/:p/**/:n(\\d+)?",
    "/*/**/:n(\\d+)?",
    "/a//**/:n(\\d+)?",
    "/a/**/x-:y",
    "/a/**/x-:y?",
    "/:x-:e/**",
    "/a/:x-:e/**",
    "/:x.:e/**",
    "/a/:x.:e/**",
    "/x-:x?/**",
    "/a/x-:x?/**",
    "/x-:x(\\d+)?/**",
    "/a/x-:x(\\d+)?/**",
  ].map((pattern) => [pattern, ZERO_SEGMENT_CATCH_ALL] as const),
  ...[
    "/**/:y?/:z?",
    "/a/**/:y?/:z?",
    "/a/**/:n(\\d+)?/:y?",
    "/a/**/:y?/:n(\\d+)?",
    "/a/**/:y?/:n(a|b)?",
    "/a/**/:y?{/b}?",
    "/a/**/{/b}?",
    "/a/**{/b/:c?}?",
    "/a/**{.png}?",
    "/a/:r*/:y?/*",
    "/a/:r*/:y?{/b}?",
  ].map((pattern) => [pattern, OTHER_EXPANSION] as const),
  ...[
    "/:x?/*",
    "/a/:x?/*",
    "/:x(\\d+)?/*",
    "/a/:x(\\d+)?/*",
    // The router prefers the constrained `y` (see `_selectMatcher`).
    "/a/:x?/:y(\\d+)?",
  ].map((pattern) => [pattern, OPTIONAL_BEFORE_WILDCARD] as const),
]);
