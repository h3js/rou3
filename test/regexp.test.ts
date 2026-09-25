import { describe, it, expect } from "vitest";
import { routeToRegExp, createRouter, addRoute, findRoute } from "../src/index.ts";
import { fromGroupName } from "../src/_group-names.ts";
import { expandGroupDelimiters } from "../src/_group-delimiters.ts";
import { expandModifiers, splitRoute } from "../src/operations/_utils.ts";
import { canBeEmpty, canEndInSlash } from "../src/_regexp-scan.ts";
import {
  type Captures,
  regexpCases as routes,
  LOOKAHEAD_ROUTES,
  LOOKBEHIND_ROUTES,
  SWEEP_DUPLICATE_NAME_PATTERNS,
  SWEEP_LOOKAHEAD_PATTERNS,
  SWEEP_LOOKBEHIND_PATTERNS,
  duplicateGroupNames,
  hasLookahead,
  hasLookbehind,
  TWO_CATCH_ALL_ROUTES,
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
    expect([...KNOWN_CAPTURE_DIFFS.keys()].filter((pattern) => !seen.has(pattern))).toEqual([]);
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

  // A named group declared twice is rejected by Node 22, PCRE2 and RE2, even
  // across alternatives (#213): no fixture may emit one, and only the sweep
  // patterns in SWEEP_DUPLICATE_NAME_PATTERNS do.
  it("does not emit duplicate named capture groups", () => {
    for (const route of Object.keys(routes)) {
      const duplicates = duplicateGroupNames(routeToRegExp(route).source);
      expect(duplicates, `duplicate named groups for "${route}"`).toEqual([]);
    }
    const duplicates = sweepPatterns().filter(
      (pattern) => duplicateGroupNames(routeToRegExp(pattern).source).length > 0,
    );
    expect(duplicates.sort()).toEqual([...SWEEP_DUPLICATE_NAME_PATTERNS].sort());
  });

  // RE2-family engines (Go, Rust `regex`, RE2) have no look-around. Only the
  // shapes tracked in LOOKBEHIND_ROUTES may still need the look-behind suffix,
  // and only those in LOOKAHEAD_ROUTES a look-ahead.
  it("emits no look-around outside LOOKBEHIND_ROUTES and LOOKAHEAD_ROUTES", () => {
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
  // (no ripgrep needed) makes a change that moves routes onto a look-around
  // fail loudly.
  it("pins the sweep patterns RE2 engines reject", () => {
    const lookbehind: string[] = [];
    const lookahead: string[] = [];
    for (const pattern of sweepPatterns()) {
      const source = routeToRegExp(pattern).source;
      if (hasLookbehind(source)) lookbehind.push(pattern);
      if (hasLookahead(source)) lookahead.push(pattern);
    }
    expect(lookbehind.sort()).toEqual([...SWEEP_LOOKBEHIND_PATTERNS].sort());
    expect(lookahead.sort()).toEqual([...SWEEP_LOOKAHEAD_PATTERNS].sort());
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
    const message = /^rou3: a route can have only one `\*\*`/;
    expect(() => addRoute(createRouter(), "", route)).toThrow(message);
    expect(() => routeToRegExp(route)).toThrow(message);
  });
});

// A param shared by several expansions of a route (an optional group before
// more of the route, or after a greedy capture) used to be emitted once per
// branch of a `^(?:…|…)$` alternation. Node 22 (V8 12.4), PCRE2 and RE2
// reject a group name declared twice even across alternatives, so
// `routeToRegExp` threw there (#213).
describe("routeToRegExp: shared params across expansions (#213)", () => {
  it.each([
    "/files/:name{.:ext}?",
    "/users{/:id}?/posts/:post",
    "/a/:x(\\d+){-:y}?/b",
    "/docs/{v2}?/:page?",
    "/media/*{.webp}?",
    "/a{/:b}?{/:c}?",
    "/a/:x*/b{.json}?",
    "/api{/v:version}?/users{/:id}?/posts/:post{.:ext}?",
    "/:lang?/docs{/:section}?/:page{.:ext}?",
    "/files{/:dir}?/:name{.:ext}?",
    "/files/:name{.:ext}?{/raw}?",
    "/img/*{.webp}?{/:size}?",
    "/:a{.:b}?{.:c}?",
    "/x/:a{.:b}?/:c{.:d}?/:e{.:f}?",
  ])("declares each group once for %s", (route) => {
    const regex = routeToRegExp(route);
    expect(duplicateGroupNames(regex.source)).toEqual([]);
    const router = createRouter();
    addRoute(router, "", route, true);
    for (const path of sweepPaths()) {
      expect(regex.test(path), path).toBe(findRoute(router, "", path) !== undefined);
    }
  });

  // Malformed shapes no merge fits (a modifier right before a group) keep the
  // alternation, which repeats a group name: only engines that support
  // duplicate named groups compile it.
  it("keeps the alternation for shapes no merge fits", () => {
    let duplicatesCompile = true;
    try {
      new RegExp("(?<a>x)|(?<a>y)");
    } catch {
      duplicatesCompile = false;
    }
    if (duplicatesCompile) {
      expect(duplicateGroupNames(routeToRegExp("/:x?{.json}?").source)).toEqual(["x"]);
    } else {
      expect(() => routeToRegExp("/:x?{.json}?")).toThrow(SyntaxError);
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

  // Duplicates are per expansion: expansions may share a name (it is emitted
  // once, #213), and generated unnamed captures (`_N`) never collide.
  it.each([
    "/media/*{.webp}?",
    "/docs/{v2}?/:page?",
    "/media/:name{.webp}?",
    "/a/*/*",
    "/a/(\\d+)/(\\d+)",
    "/a/*/b/*.png/(\\d+)",
    // `:0` escapes to `__rou3_esc_0`, distinct from the unnamed `*` (`_0`).
    "/w/:0/*",
  ])("accepts %s", (route) => {
    expect(() => routeToRegExp(route)).not.toThrow();
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

// The relaxed merge (#213): an optional param next to an optional group can't
// share its params across expansions in their order, so where a segment fits
// either, the earlier optional takes it and the router gives it to a later
// param (`/:x?/a{/:y}?/:z` on `/a/a/b`: `x`, the router's `y`).
const RELAXED_MERGE: CaptureDiff = {
  reason: "a relaxed merge: an optional param takes a segment the router gives a later one",
  test: (_pattern, keys, groups, params) =>
    keys.length === 2 &&
    keys.every((key) => key in groups !== key in params) &&
    groups[keys.find((key) => key in groups)!] === params[keys.find((key) => key in params)!],
};

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
  ["/:x?/a{/:y}?/:z", RELAXED_MERGE],
]);
