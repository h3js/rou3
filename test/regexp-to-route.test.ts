import { describe, it, expect } from "vitest";
import { addRoute, createRouter, findRoute, regExpToRoute, routeToRegExp } from "../src/index.ts";
import {
  DUPLICATE_NAMED_GROUPS,
  regexpCases,
  LOOKAHEAD_ROUTES,
  PCRE2_DUPLICATE_NAME_ROUTES,
  SWEEP_LOOKAHEAD_PATTERNS,
  sweepPaths,
  sweepPatterns,
} from "./_regexp-cases.ts";

// The look-behind trailing-slash suffix (as `RegExp#source` spells it).
const LB = "(?:(?<=\\/)\\/|(?<!\\/)\\/?)$";

describe("regExpToRoute", () => {
  // Every fixture route -> regex -> route must round-trip (its regex, converted
  // back, produces a route whose regex is identical) and route the same way:
  // equal sources alone let `/path/:rest*` come back as `/path/:rest(.*?)?`.
  // Alternation-fallback routes (PCRE2_DUPLICATE_NAME_ROUTES) and look-ahead
  // held params (LOOKAHEAD_ROUTES) are not reversible and excluded.
  for (const [route, { regex, match, noMatch = [] }] of Object.entries(regexpCases)) {
    if (PCRE2_DUPLICATE_NAME_ROUTES.has(route) || LOOKAHEAD_ROUTES.has(route)) {
      continue;
    }
    it(`round-trips "${route}"`, () => {
      const back = regExpToRoute(regex);
      expect(routeToRegExp(back).source).toBe(regex.source);
      if (!KNOWN_NON_EQUIVALENT[route]) {
        const paths = [...match.map(([path]) => path), ...noMatch, ...pathsUnder(route)];
        expect(routingDiffs(route, back, paths)).toEqual([]);
      }
    });
  }

  // The same over the sweep corpus, plus the listed non-equivalences. Only
  // alternation output (several expansions OR-ed together) and look-ahead held
  // params may be rejected.
  it("reverses sweep patterns to equivalent routes", () => {
    const paths = sweepPaths();
    const mismatches: string[] = [];
    const stale: string[] = [];
    for (const pattern of new Set([...sweepPatterns(), ...Object.keys(KNOWN_NON_EQUIVALENT)])) {
      let back: string;
      try {
        back = regExpToRoute(routeToRegExp(pattern));
      } catch (error) {
        expect((error as Error).message, pattern).toMatch(
          SWEEP_LOOKAHEAD_PATTERNS.has(pattern)
            ? /cannot contain "\/"/
            : /unsupported non-optional group/,
        );
        continue;
      }
      const diffs = routingDiffs(pattern, back, paths);
      const known = KNOWN_NON_EQUIVALENT[pattern];
      if (known) {
        if (known[0] !== back || diffs.length === 0) stale.push(`${pattern} -> ${back}`);
      } else if (diffs.length > 0) {
        mismatches.push(`${pattern} -> ${back}: ${diffs.slice(0, 3).join(", ")}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(stale, "KNOWN_NON_EQUIVALENT entries that no longer apply").toEqual([]);
  }, 10_000);

  it("reverses a named catch-all to an equivalent `:name+`", () => {
    const back = regExpToRoute(routeToRegExp("/base/**:path"));
    expect(back).toBe("/base/:path+");
    expect(routingDiffs("/base/**:path", back, pathsUnder("/base/**:path"))).toEqual([]);
  });

  it("accepts a RegExp or a source string", () => {
    expect(regExpToRoute(/^\/path\/(?<id>\d+)\/?$/)).toBe("/path/:id(\\d+)");
    expect(regExpToRoute("^\\/path\\/(?<id>\\d+)\\/?$")).toBe("/path/:id(\\d+)");
  });

  it("maps the core constructs", () => {
    expect(regExpToRoute(/^\/path\/?$/)).toBe("/path");
    expect(regExpToRoute(/^\/path\/(?<param>[^/]+)\/?$/)).toBe("/path/:param");
    expect(regExpToRoute(/^\/path\/(?<_0>[\s\S]*)\/foo\/?$/)).toBe("/path/*/foo");
    expect(regExpToRoute(/^\/path\/(?<_0>[\s\S]*)\.png\/?$/)).toBe("/path/*.png");
    expect(regExpToRoute(/^\/path\/(?<_0>(?:[\s\S]*[^/])?\/*?)\/?$/)).toBe("/path/*");
    expect(regExpToRoute(/^\/path\/(?<_0>[\s\S]*?)(?:\/(?<y>[^/]+))??\/?$/)).toBe("/path/*/:y?");
    // A single-segment `*` before 0.12 (`[^/]*`, as 0.11 emitted it) is the
    // constraint `([^\x2f]*)` now (a `*` takes `/` too): the same paths and
    // captures
    for (const [re, route] of [
      [/^\/path\/(?<_0>[^/]*)\/foo\/?$/, "/path/([^\\x2f]*)/foo"],
      [/^\/path\/(?<_0>[^/]*)\.png\/?$/, "/path/([^\\x2f]*).png"],
      [/^\/path(?:\/(?<_0>[^/]*))??\/?$/, "/path{/([^\\x2f]*)}?"],
      // At the root: a leading `{/…}?` (`/X` or `/`), as 0.11 emitted `/*`
      // and `/*/:x?`
      [/^(?:\/(?<_0>[^/]*))??\/?$/, "{/([^\\x2f]*)}?"],
      [/^(?:\/(?<_0>[^/]*)(?:\/(?<x>[^/]+))?)??\/?$/, "{/([^\\x2f]*)/:x?}?"],
    ] as const) {
      expect(regExpToRoute(re), re.source).toBe(route);
      const router = createRouter<string>();
      addRoute(router, "GET", route, route);
      for (const path of LEGACY_STAR_PATHS) {
        const groups = re.exec(path)?.groups;
        const found = findRoute(router, "GET", path);
        expect(!!found, `${route} on ${path}`).toBe(re.test(path));
        if (groups?._0 !== undefined) expect(found?.params?.["0"], path).toBe(groups._0);
      }
    }
    // 0.11's `/*/:x*` (its `:x*` could be empty, a `:x*` can't now)
    expect(regExpToRoute(/^(?:\/(?<_0>[^/]*)(?:\/(?<x>(?:[\s\S]*[^/])?\/*?))??)??\/?$/)).toBe(
      "{/([^\\x2f]*)/:x*}?",
    );
    // No route matches what these do: a hand-written trailing one matches `""`
    // on `/path/` (a route's last segment can't be empty there), and 0.11's
    // `*` after an empty segment (`/a//*`, `//*`) matches `/a//` (a route
    // ending in an empty segment is the route without it, `/a`)
    for (const re of [
      /^\/path\/(?<_0>[^/]*)\/?$/,
      /^\/path\/([^/]*)\/?$/,
      /^\/a\/\/(?:(?<_0>[^/]*)\/?)??$/,
      /^\/\/(?:(?<_0>[^/]*)\/?)??$/,
      /^\/(?<x>[^/]+)\/\/(?:(?<_0>[^/]*)\/?)??$/,
      /^\/a\/\/(?:(?<_0>\d+)\/?)??$/,
    ]) {
      expect(() => regExpToRoute(re), re.source).toThrow(/^rou3: /);
    }
    expect(regExpToRoute(/^\/path(?:\/(?<_>.*))?\/?$/)).toBe("/path/**");
    expect(regExpToRoute(/^\/?(?<_>.*)\/?$/)).toBe("/**");
    expect(regExpToRoute(/^\/path\/(?<id>\d+)\/?$/)).toBe("/path/:id(\\d+)");
    expect(regExpToRoute(/^\/path(?:\/(?<id>[^/]+))?\/?$/)).toBe("/path/:id?");
    expect(regExpToRoute(/^\/path(?:\/(?<rest>.*))?\/?$/)).toBe("/path/:rest*");
    expect(regExpToRoute(/^\/path\/(?<rest>.+)\/?$/)).toBe("/path/:rest+");
  });

  it("maps catch-all output back to an equivalent route", () => {
    // `**:name` and `:name+` compile to the same regex (both one-or-more
    // segments), so the named catch-all comes back as `:name+`.
    expect(routeToRegExp("/base/**:path").source).toBe(routeToRegExp("/base/:path+").source);
    expect(regExpToRoute(routeToRegExp("/base/**:path"))).toBe("/base/:path+");
    // A greedy `(?:/(?<_>…))?` is `**`, also with segments after it.
    expect(regExpToRoute(routeToRegExp("/a/**"))).toBe("/a/**");
    expect(regExpToRoute(/^\/a(?:\/(?<_>.*))?\/b\/?$/)).toBe("/a/**/b");
    expect(regExpToRoute(routeToRegExp("/a/**/b"))).toBe("/a/**/b");
    expect(regExpToRoute(routeToRegExp("/a/:_*/b"))).toBe("/a/:_*/b");
    // A param named `_` is not `**`: the router leaves `:_*` unset on `/a/`
    // where `**` reports `""`, so the two compile to different regexes (the
    // lazy `)??` group) and each reverses to itself.
    expect(routeToRegExp("/a/:_*").source).not.toBe(routeToRegExp("/a/**").source);
    expect(regExpToRoute(routeToRegExp("/a/:_*"))).toBe("/a/:_*");
    // Same at the root, where `:x*` also has to leave `x` unset on `/`.
    expect(regExpToRoute(routeToRegExp("/**"))).toBe("/**");
    expect(regExpToRoute(routeToRegExp("/:x*"))).toBe("/:x*");
    expect(regExpToRoute(routeToRegExp("/:_*"))).toBe("/:_*");
    // The `:name*` ending must not reverse to a single-segment constraint.
    expect(regExpToRoute(routeToRegExp("/path/:rest*"))).toBe("/path/:rest*");
    // `{/:w+}?` is `:w*` (both need a value), which reverses in one spelling.
    expect(routeToRegExp("/a/c{/:w+}?").source).toBe(routeToRegExp("/a/c/:w*").source);
    expect(regExpToRoute(routeToRegExp("/a/c{/:w+}?"))).toBe("/a/c/:w*");
    // ... also mid-route, where a `:w*` is lazy (`{/**:w}?` too).
    for (const route of ["/a{/:w+}?/b", "/a{/**:w}?/b", "/a{/:w+}?/:y", "/{/:w+}?/b"]) {
      const star = route.replace(/\{\/(?:\*\*:w|:w\+)\}\?/, "/:w*");
      expect(routeToRegExp(route).source, route).toBe(routeToRegExp(star).source);
      expect(regExpToRoute(routeToRegExp(route)), route).toBe(star);
    }
    // `{/**}?` is `**` (both unset over zero segments), which reverses in one
    // spelling.
    expect(routeToRegExp("/a{/**}?").source).toBe(routeToRegExp("/a/**").source);
    expect(regExpToRoute(routeToRegExp("/a{/**}?"))).toBe("/a/**");
  });

  it("accepts catch-all regexes emitted by older versions", () => {
    // Before the prefix/separator anchoring fix, catch-alls were emitted with a
    // bare optional separator (`\/?`). Keep parsing that form.
    expect(regExpToRoute(/^\/path\/?(?<_>.*)\/?$/)).toBe("/path/**");
    expect(regExpToRoute(/^\/base\/?(?<path>.+)\/?$/)).toBe("/base/**:path");
  });

  // Released versions built catch-alls on `.` (`.*` / `.+`), where
  // `routeToRegExp` now emits `[\s\S]*`. Their output still reverses to an
  // equivalent route: `[source, route it was emitted for, reversed route]`.
  it.each([
    // main: look-behind trailing-slash suffix.
    ["^\\/path(?:\\/(?<_>.*))?" + LB, "/path/**", "/path/**"],
    ["^\\/base\\/(?<p>.*)" + LB, "/base/**:p", "/base/:p+"],
    ["^\\/(?<p>.*)" + LB, "/:p+", "/:p+"],
    ["^\\/?(?<_>.*)" + LB, "/**", "/**"],
    ["^\\/?(?<x>.*)" + LB, "/:x*", "/:x*"],
    ["^\\/a(?:\\/(?<x>.*))?" + LB, "/a/:x*", "/a/:x*"],
    ["^\\/a(?:\\/b\\/(?<r>.*))?" + LB, "/a{/b/**:r}?", "/a{/b/:r+}?"],
    ["^\\/a(?:\\/b(?:\\/(?<_>.*))?)?" + LB, "/a{/b/**}?", "/a{/b/**}?"],
    ["^\\/a\\/(?<y>[^/]*)(?:\\/(?<_>.*))?" + LB, "/a/:y/**", "/a/:y/**"],
    // 0.9.x: plain `\/?` ending, `.+` for one-or-more.
    ["^\\/?(?<_>.*)\\/?$", "/**", "/**"],
    ["^\\/?(?<x>.*)\\/?$", "/:x*", "/:x*"],
    ["^\\/?(?<p>.+)\\/?$", "/**:p", "/**:p"],
    ["^\\/a\\/(?<x>.+)\\/?$", "/a/:x+", "/a/:x+"],
    ["^\\/a(?:\\/(?<x>.*))?\\/?$", "/a/:x*", "/a/:x*"],
    ["^\\/a(?:\\/b\\/?(?<r>.+))?\\/?$", "/a{/b/**:r}?", "/a{/b/**:r}?"],
    ["^\\/a(?:\\/b\\/?(?<_>.*))?\\/?$", "/a{/b/**}?", "/a{/b/**}?"],
  ])("reverses %s", (source, route, back) => {
    expect(regExpToRoute(source)).toBe(back);
    expect(routingDiffs(route, back, pathsUnder(route))).toEqual([]);
  });

  // A `:x(.*)` is a `*` keyed `x` (it may be `""`), a `:x+` / `:x*` needs a
  // value: their regexes differ, and each reads back as itself.
  it("tells a `:x(.*)` catch-all apart from `:x+` / `:x*`", () => {
    for (const route of [
      "/a/:x(.*)",
      "/:x(.*)",
      "/a/:x(.*)/b",
      "/a/pre-:x(.*)",
      "/a/:x(.*).png",
      "/a/:x(.*)/:y?",
      // In endings with the trailing-slash rule built in.
      "/a/:x/:y(.*)",
      "/a{/b/:x(.*)}?",
      "/a/:x+",
      "/a/:x*",
      "/:x+",
      "/:x*",
    ]) {
      expect(regExpToRoute(routeToRegExp(route)), route).toBe(route);
    }
  });

  // 0.10 closed endings, where a `:x` / `**:x` could be empty: back to the
  // route they were emitted for.
  it.each([
    [String.raw`^\/path\/(?:(?<param>[^/]+)\/?|\/)$`, "/path/:param"],
    [String.raw`^\/base\/(?:\/|(?<path>(?:[\s\S]*[^/]|\/)\/*?)\/?)$`, "/base/:path+"],
    [String.raw`^\/a(?:\/(?:(?:(?<_>[\s\S]*)\/)?(?:(?<page>[^/]+)\/?|\/))?)?$`, "/a/**/:page?"],
    [String.raw`^\/path\/(?:(?<id>[^/]+)(?:\/|$)|\/)(?:(?<tab>[^/]*)\/?)??$`, "/path/:id/:tab?"],
  ])("reverses the 0.10 ending %s", (source, route) => {
    expect(regExpToRoute(source)).toBe(route);
  });

  // 0.11 `:x*` forms, where a `:x*` could be empty (`[\s\S]*`): an optional
  // `:x(.*)` (a `*` keyed `x`, which may be empty too: the same paths as the
  // regex; the first is what `/path{/:rest(.*)}?` emits now), and the root
  // form back to the route it was emitted for, which now needs a value.
  it.each([
    [String.raw`^\/path(?:\/(?<rest>(?:[\s\S]*[^/])?\/*?))??\/?$`, "/path{/:rest(.*)}?"],
    [String.raw`^(?:\/?(?<path>(?:[\s\S]*[^/])?\/*?))??\/?$`, "/:path*"],
    [String.raw`^\/path(?:\/(?<rest>[\s\S]*))??\/suffix\/?$`, "/path{/:rest(.*)}?/suffix"],
  ])("reverses the 0.11 `:x*` form %s", (source, route) => {
    expect(regExpToRoute(source)).toBe(route);
  });

  // 0.11 `**:x` / `:x+` / `:x*` forms, where a segment of the value could be
  // empty (`[\s\S]+`, a `//` branch): back to the route they were emitted
  // for, whose segments now each need a value.
  it.each([
    [String.raw`^\/base\/(?:\/\/|(?<path>(?:[\s\S]*[^/]|\/\/)\/*?)\/?)$`, "/base/:path+"],
    [String.raw`^\/path(?:\/(?:(?:\/\/|(?<rest>(?:[\s\S]*[^/]|\/\/)\/*?)\/?))?)?$`, "/path/:rest*"],
    [String.raw`^\/path\/(?<rest>[\s\S]+)\/suffix\/?$`, "/path/:rest+/suffix"],
    [String.raw`^\/a\/(?<r>[\s\S]+?)(?:\/(?<y>[^/]+))?(?:(?<=\/)\/|(?<!\/)\/?)$`, "/a/:r+/:y?"],
  ])("reverses the 0.11 value form %s", (source, route) => {
    expect(regExpToRoute(source)).toBe(route);
  });

  it("rejects the 0.11 `:x*` then `*` form (two catch-alls now)", () => {
    expect(() =>
      regExpToRoute(String.raw`^\/a(?:\/(?:(?:(?<x>[\s\S]*)\/)?(?:(?<_0>[^/]+)\/?|\/))?)?$`),
    ).toThrow(/^rou3: /);
  });

  it("accepts the two-trailing-slash suffix emitted by older versions (#209)", () => {
    expect(regExpToRoute(/^\/path\/(?<id>[^/]*)(?:\/\/|(?<!\/)\/?)$/)).toBe("/path/:id");
    expect(regExpToRoute(/^\/\/?$/)).toBe("/");
    expect(routeToRegExp("/").source).toBe("^\\/$");
    expect(regExpToRoute(routeToRegExp("/"))).toBe("/");
  });

  it("decodes escaped capture-group names back to the original param name", () => {
    // Names in the reserved `__rou3_` space are emitted escaped; reversing
    // must restore the original name, not leak the internal form.
    expect(regExpToRoute(/^\/api\/(?<__rou3_esc_____rou3__x>[^/]+)\/?$/)).toBe("/api/:__rou3_x");
    expect(regExpToRoute(/^\/api\/(?<__rou3_esc_____rou3__x>.+)\/?$/)).toBe("/api/:__rou3_x+");
    expect(regExpToRoute(/^\/api(?:\/(?<__rou3_esc_____rou3__x>[^/]+))?\/?$/)).toBe(
      "/api/:__rou3_x?",
    );
    expect(regExpToRoute(/^\/mix\/(?<__rou3_esc_____rou3__x>[^/]+)\.(?<_0>[\s\S]*)\/?$/)).toBe(
      "/mix/:__rou3_x.*",
    );
    // A `_N` param (escaped, `__rou3_esc___N`) is no unnamed capture (`_N`).
    for (const route of [
      "/:_0",
      "/a/:_1-:b",
      "/a/:_0+",
      "/a/:_0?",
      "/a/:_0*",
      "/a/:_0(\\d+)",
      "/a/:_0.*",
      "/a/:_0*/:_1?",
      "/a/:_0/*",
      "/a/:_0+/b",
    ]) {
      const re = routeToRegExp(route);
      expect(regExpToRoute(re), route).toBe(route);
      expect(routeToRegExp(regExpToRoute(re)).source, route).toBe(re.source);
    }
    // Names a route can no longer have (`-`, leading digit) are rejected.
    expect(() => regExpToRoute(/^\/api\/(?<__rou3_esc_test_hid>[^/]+)\/?$/)).toThrow(/^rou3: /);
    expect(() => regExpToRoute(/^\/api\/(?<__rou3_esc_0>[^/]+)\/?$/)).toThrow(/^rou3: /);
  });

  it("rejects a capturing group inside a constraint", () => {
    // `addRoute` rejects it (a stray param), so it has no route form.
    for (const re of [
      /^\/a\/(?<x>(a)b)\/?$/,
      /^\/a\/((?:(a)))\/?$/,
      /^\/a\/(?<x>a(?<n>b)c)\/?$/,
      /^\/a\/((?<n>b)c)\/?$/,
    ]) {
      expect(() => regExpToRoute(re), re.source).toThrow(/^rou3: /);
    }
    expect(regExpToRoute(/^\/a\/(?<x>(?:a)b)\/?$/)).toBe("/a/:x((?:a)b)");
    expect(regExpToRoute(/^\/a\/(?<x>[(]\(a)\/?$/)).toBe("/a/:x([(]\\(a)");
  });

  it("rejects a `--` / `&&` in a class of a constraint", () => {
    // `addRoute` rejects it (a `v`-flag set operation in URLPattern), so it
    // has no route form.
    for (const re of [
      /^\/a\/(?<x>[!--z])\/?$/,
      /^\/a\/([a&&b])\/?$/,
      /^\/a\/(?<x>(?:[a&&b]))\/?$/,
      /^\/a\/(?<x>[a\]&&b])\/?$/,
    ]) {
      expect(() => regExpToRoute(re), re.source).toThrow(/^rou3: /);
    }
    expect(regExpToRoute(/^\/a\/(?<x>a--b&&c)\/?$/)).toBe("/a/:x(a--b&&c)");
    expect(regExpToRoute(/^\/a\/(?<x>[a]--[b])\/?$/)).toBe("/a/:x([a]--[b])");
    expect(regExpToRoute(/^\/a\/(?<x>[a\-\-b])\/?$/)).toBe("/a/:x([a\\-\\-b])");
  });

  it("writes a lone optional param ending its segment as `:x?`", () => {
    expect(regExpToRoute(/^\/a\/pre-(?:(?<x>[^/]+?))?\/?$/)).toBe("/a/pre-:x?");
    expect(regExpToRoute(/^\/a\/pre-(?:(?<x>\d+))?\/b\/?$/)).toBe("/a/pre-:x(\\d+)?/b");
    // Only where the group ends the segment: `b:x?{.:y}?` is no route.
    const cases: [RegExp, string][] = [
      [/^\/a\/b(?:(?<x>[^/]+))?(?:\.(?<y>[^/]+))?\/?$/, "/a/b{:x}?{.:y}?"],
      [/^\/a\/b(?:(?<x>[^/]+))?(?:(?<y>[^/]+))?\/?$/, "/a/b{:x}?{:y}?"],
      [/^\/a\/b(?:-(?<x>[^/]+))?(?:(?<y>[^/]+))?\/?$/, "/a/b{-:x}?{:y}?"],
    ];
    for (const [re, route] of cases) {
      expect(regExpToRoute(re), re.source).toBe(route);
      expect(() => addRoute(createRouter(), "", route)).not.toThrow();
    }
  });

  it("escapes a literal that would extend the param name before it", () => {
    // A name is `[A-Za-z_]\w*`: a word char right after `:name` would read as
    // more of the name, and a non-ASCII one is rejected there. A `-` ends it.
    expect(regExpToRoute(/^\/a\/(?<x>[^/]+)abc\/?$/)).toBe("/a/:x\\abc");
    expect(regExpToRoute(/^\/a\/(?<x>[^/]+)%C3%A9\/?$/)).toBe("/a/:x%C3%A9");
    expect(regExpToRoute(/^\/a\/pre-(?<x>[^/]+)-suf\/?$/)).toBe("/a/pre-:x-suf");
    expect(regExpToRoute(/^\/a\/(?<x>[^/]+)-\/?$/)).toBe("/a/:x-");
    expect(regExpToRoute(/^\/a\/(?<x>[^/]+)-(?<y>[^/]+)\/?$/)).toBe("/a/:x-:y");
    expect(regExpToRoute(/^\/a\/(?<x>\d+)abc\/?$/)).toBe("/a/:x(\\d+)abc");
    expect(regExpToRoute(/^\/a\/(?<x>[^/]+)\$\/?$/)).toBe("/a/:x\\$");
    for (const route of ["/a/:x\\abc", "/a/pre-:x-suf", "/a/:x\\é", "/a/:x\\$"]) {
      expect(routeToRegExp(regExpToRoute(routeToRegExp(route))).source).toBe(
        routeToRegExp(route).source,
      );
    }
    // A group right after `:name` would read as its constraint: the name gets
    // the one it has, spelled without a `/` (`{:x}(\d+)` expands to the lazy
    // one, see `joinGroup`).
    expect(regExpToRoute(/^\/a\/(?<x>[^/]+?)(?<_0>\d+)\/?$/)).toBe("/a/:x([^\\x2f]+?)(\\d+)");
    expect(regExpToRoute(/^\/a\/(?<x>[^/]+)(\d+)\/?$/)).toBe("/a/:x([^\\x2f]+)(\\d+)");
    for (const route of ["/a/{:x}(\\d+)", "/a/:x{}(.*)", "/a/b-{:x}(c)"]) {
      expect(routeToRegExp(regExpToRoute(routeToRegExp(route))).source).toBe(
        routeToRegExp(route).source,
      );
    }
    // The rest of a segment after an in-segment optional group is part of
    // that segment: a `(.+)` there is no `:_0+`, and an in-place optional
    // param after it (`-:bar?`) is no `{:bar}?` group (it routes otherwise)
    for (const route of ["/{:foo}?(.+)", "/{a-}?(.+)", "/{x}?(.+)", "/{:foo(\\d+)}?(.+)"]) {
      const back = regExpToRoute(routeToRegExp(route));
      expect(() => addRoute(createRouter(), "", back), `${route} -> ${back}`).not.toThrow();
      expect(routeToRegExp(back).source, route).toBe(routeToRegExp(route).source);
    }
    for (const route of ["/{:foo}?([^y]+)-:bar?", "/{:foo}?(.+)-:bar?"]) {
      expect(() => regExpToRoute(routeToRegExp(route)), route).toThrow(/^rou3: /);
    }
    // A hand-written `[^\x2f]+?` constraint with no group after it is kept as
    // written (only the `:name` before a group reads as `[^/]+?`)
    for (const route of ["/a/:x([^\\x2f]+?)", "/a/pre-:x([^\\x2f]+?)"]) {
      expect(routeToRegExp(route).source, route).toContain("(?<x>[^\\x2f]+?)");
      expect(regExpToRoute(routeToRegExp(route)), route).toBe(route);
    }
    // A `*` after a `*` would read as a `**` (and is a second catch-all): no
    // route emits these, so they throw.
    for (const re of [
      /^\/a(?<_0>[\s\S]*)(?<_1>[\s\S]*)\/?$/,
      /^\/a(?<_0>[\s\S]*)(?<_1>[\s\S]*)b\/?$/,
      /^\/(?<_0>[\s\S]*)(?<_1>[\s\S]*)\/?$/,
    ]) {
      expect(() => regExpToRoute(re), re.source).toThrow(/rou3: /);
    }
    // After a group a `*` would read as a modifier: it is the `(.*)` it is
    // (a `*` in URLPattern too)
    for (const [re, route] of [
      [/^\/a\/(?<x>[^/]+)(?<_0>[\s\S]*)\/?$/, "/a/:x([^\\x2f]+)(.*)"],
      [/^\/a\/(?<x>\d+)(?<_0>[\s\S]*)\/?$/, "/a/:x(\\d+)(.*)"],
    ] as const) {
      expect(regExpToRoute(re), re.source).toBe(route);
      // (the stripped trailing slash aside: these regexes end in a plain `\/?`)
      for (const path of ["/a/1", "/a/1x", "/a/1/x/y", "/a/x", "/a/", "/a"]) {
        expect(routeToRegExp(route).exec(path)?.groups, path).toEqual(re.exec(path)?.groups);
      }
    }
    // Group names no route param name decodes to are rejected.
    expect(() => regExpToRoute(/^\/a\/(?<__rou3_esc_x_h>[^/]+)\/?$/)).toThrow(/rou3: /);
  });

  it("rejects the constrained repeat form older versions emitted", () => {
    // `:id(\d+)+` / `:id(\d+)*` are rejected by `addRoute` now (the tree
    // dropped the constraint), so their old regexes have no route form.
    expect(() => regExpToRoute(/^\/path\/(?<id>\d+(?:\/\d+)*)\/?$/)).toThrow(/^rou3: /);
    expect(() => regExpToRoute(/^\/path(?:\/(?<id>\d+(?:\/\d+)*))?\/?$/)).toThrow(/^rou3: /);
  });

  it("keeps percent-encoded literals encoded", () => {
    // A route's literal text is percent-encoded (`%` kept), so `%XX` comes
    // back as written: decoding it would change the route (`%2F`, `%25`).
    for (const [route, reversed] of [
      ["/café/:id", "/caf%C3%A9/:id"],
      ["/caf%c3%a9", "/caf%c3%a9"],
      ["/a\\{b\\}/\\?/:x-é", "/a%7Bb%7D/%3F/:x-%C3%A9"],
      ["/100%/a%2F", "/100%/a%2F"],
    ]) {
      expect(regExpToRoute(routeToRegExp(route)), route).toBe(reversed);
      expect(routeToRegExp(reversed).source, route).toBe(routeToRegExp(route).source);
    }
  });

  it("rejects a literal a route would percent-encode", () => {
    // No route matches a raw `é`, space, `{`, `?`, ... (its text is encoded),
    // so a regex holding one outside a constraint has no equivalent route.
    for (const re of [
      /^\/café\/?$/,
      /^\/a\/(?<x>[^/]+)é\/?$/,
      /^\/a b\/?$/,
      /^\/a\{b\}\/?$/,
      /^\/a\?\/?$/,
      /^\/a\^\/?$/,
      /^\/a#\/?$/,
      /^\/😀\/?$/,
    ]) {
      expect(() => regExpToRoute(re), re.source).toThrow(/^rou3: /);
    }
    // Inside a constraint it is regex, kept as written
    expect(regExpToRoute(/^\/a\/(?<x>é)\/?$/)).toBe("/a/:x(é)");
    // The error quotes the whole char and its encoded form
    expect(() => regExpToRoute(/^\/a😀\/?$/)).toThrow(
      'rou3: no route has a literal "😀" (route text is percent-encoded, write it as %F0%9F%98%80) in "a😀"',
    );
    // An escaped one too (a string: a lint autofix would drop the escape)
    expect(() => regExpToRoute(new RegExp("^\\/a\\é\\/?$"))).toThrow('literal "é" (');
    expect(() => regExpToRoute(/^\/caf\/?$/)).not.toThrow();
    // A raw tab / LF / CR: no route has one (`addRoute` rejects it), also in
    // a constraint, where the regex escape is kept as written
    for (const ch of ["\t", "\n", "\r"]) {
      expect(() => regExpToRoute(`^\\/a${ch}\\/?$`), ch).toThrow(/^rou3: /);
      expect(() => regExpToRoute(`^\\/(?<x>a${ch})\\/?$`), ch).toThrow(/^rou3: /);
    }
    expect(regExpToRoute(/^\/(?<x>a\t\n\r)\/?$/)).toBe("/:x(a\\t\\n\\r)");
    // U+FFFD-U+FFFF are internal placeholders: no route has them either
    for (const code of [0xfffd, 0xfffe, 0xffff]) {
      const ch = String.fromCharCode(code);
      expect(() => regExpToRoute(`^\\/a${ch}\\/?$`), ch).toThrow(
        `write it as ${encodeURIComponent(ch)})`,
      );
    }
  });

  it("re-escapes literal route-syntax characters", () => {
    // A literal `*` in the source must come back escaped so it stays literal.
    expect(regExpToRoute(/^\/static\/\*\/\*\*\/?$/)).toBe("/static/\\*/\\*\\*");
  });

  it("round-trips literal regex metacharacters inside a dynamic segment", () => {
    // A literal (escaped) metachar sharing a segment with a param must come back
    // re-escaped, or routeToRegExp would reinterpret it as a regex operator.
    for (const route of [
      "/a\\+:id",
      "/foo\\?:id",
      "/foo\\|:id",
      "/a\\^b:id",
      "/a\\$b:id",
      "/a\\[b:id",
    ]) {
      const regex = routeToRegExp(route);
      expect(routeToRegExp(regExpToRoute(regex)).source, route).toBe(regex.source);
    }
  });

  it("reads an optional `:name(.*)` group back as itself", () => {
    // Its `*` tail may be empty (`/a//` gives `p: ""`): no `:p*`, which needs
    // a value
    for (const route of [
      "/a{/:p(.*)}?",
      "{/:p(.*)}?",
      "/:x{/:p(.*)}?",
      "/(\\d+){/:p(.*)}?/b",
      "/a{/:p(.*)}?/b",
    ]) {
      const back = regExpToRoute(routeToRegExp(route));
      expect(routeToRegExp(back).source, route).toBe(routeToRegExp(route).source);
      expect(
        routingDiffs(route, back, [...pathsUnder(route), "/a//", "//", "/1//b"]),
        route,
      ).toEqual([]);
    }
  });

  it("reads a `(.*)` group back as the `*` it is", () => {
    expect(regExpToRoute(routeToRegExp("/a/(.*)"))).toBe("/a/*");
    expect(regExpToRoute(routeToRegExp("/a/(.*)/b"))).toBe("/a/*/b");
    // Right after a name or group, where a `*` would be a modifier
    expect(regExpToRoute(routeToRegExp("/a/(\\d+)(.*)"))).toBe("/a/(\\d+)(.*)");
    expect(regExpToRoute(routeToRegExp("/a/{:x}(.*)"))).toBe("/a/:x([^\\x2f]+?)(.*)");
  });

  // Only the exact catch-all endings `routeToRegExp` emits are normalized: a
  // lazy quantifier the user wrote inside a constraint must survive.
  it("keeps lazy quantifiers inside constraints", () => {
    for (const route of ["/a/:x(b.*?)", "/a/pre-:x(.*?)", "/a/:x(a.*?)?"]) {
      expect(regExpToRoute(routeToRegExp(route)), route).toBe(route);
    }
    // The same constraints behind the plain `\/?` ending (older versions,
    // hand-written regexes).
    expect(regExpToRoute(/^\/a\/(?<x>b.*?)\/?$/)).toBe("/a/:x(b.*?)");
    expect(regExpToRoute(/^\/a\/pre-(?<x>.*?)\/?$/)).toBe("/a/pre-:x(.*?)");
    expect(regExpToRoute(/^\/a(?:\/(?<x>a.*?))?\/?$/)).toBe("/a/:x(a.*?)?");
    expect(regExpToRoute(/^\/a(?:\/(?<x>[a-z]+))??\/?$/)).toBe("/a/:x([a-z]+)?");
  });

  it("throws on the alternation fallback it cannot reverse", () => {
    // Its source, where the engine can't compile it (see DUPLICATE_NAMED_GROUPS).
    const alt = DUPLICATE_NAMED_GROUPS
      ? routeToRegExp("/media/*{.webp}?")
      : String.raw`^(?:\/media\/(?<_0>[^/]*)\.webp\/?|\/media(?:\/(?<_0>[^/]*))??\/?)$`;
    expect(() => regExpToRoute(alt)).toThrow();
  });

  it("throws on inline constraints that cannot be expressed as a route", () => {
    // A param body with a `/` can't survive rou3's path splitting.
    expect(() => regExpToRoute(/^\/foo\/(?<id>[a-z/]+)\/?$/)).toThrow(/cannot contain/);
    // Unnamed `[^/]+` has no route syntax (a raw `([^/]+)` group would mis-split).
    expect(() => regExpToRoute(/^\/path\/(?<_0>[^/]+)\/?$/)).toThrow(/cannot contain/);
  });

  it("throws when an optional group has no preceding segment", () => {
    expect(() => regExpToRoute(/^(?:foo)?\/?$/)).toThrow(/preceding segment/);
  });

  it("throws where the route would nest a group or follow a leading one with text", () => {
    // `addRoute` rejects `{/a{/b}?}?/c`, `/z{/a{/b}?}?/c` (nested `{}`) and
    // `{/a}?{b}?/c` (text after a leading group)
    for (const re of [
      /^(?:\/a(?:\/b)?)?\/c\/?$/,
      /^\/z(?:\/a(?:\/b)?)?\/c\/?$/,
      /^(?:\/a)?(?:b)?\/c\/?$/,
      /^(?:\/a)?b\/?$/,
    ]) {
      expect(() => regExpToRoute(re), re.source).toThrow(/^rou3: /);
    }
    // The error quotes the whole route, not the expansion that holds the text
    expect(() => regExpToRoute(/^(?:\/a)?(?:\/b)?(?:c)?\/d\/?$/)).toThrow(
      "rou3: text after a leading `{/...}?` ({/a}?{/b}?{c}?/d)",
    );
    // ... while a leading group followed by a segment or another group reads back
    expect(regExpToRoute(/^(?:\/a)?(?:\/b)?\/c\/?$/)).toBe("{/a}?{/b}?/c");
  });

  it("rejects out-of-dialect constructs instead of corrupting", () => {
    // Each of these was previously literalized into a wrong route (or crashed
    // with an internal TypeError); they must now throw a clear rou3: error.
    for (const re of [
      /^\/(?<a>[^/]+)\k<a>\/?$/, // backreference
      /^\/p(?=x)\/?$/, // lookahead
      /^\/p(?!x)\/?$/, // negative lookahead
      /^\/(?<=a)p\/?$/, // lookbehind (was: Cannot read properties of undefined)
      /^\/(?<!a)p\/?$/, // negative lookbehind
      /^\/\w+\/?$/, // bare metaclass escape outside a constraint
      /^\/a\d\/?$/, // metaclass escape sharing a segment with a literal
      /^\/x|y\/?$/, // bare alternation
      /^\/a.b\/?$/, // bare "any char"
      /^\/ab+\/?$/, // bare quantifier
    ]) {
      expect(() => regExpToRoute(re), re.source).toThrow(/^rou3:/);
    }
  });

  it("reads a top-level character class as one atom", () => {
    // The `(` in `[(]` is literal: the class is rejected as a bare
    // metacharacter, not scanned as the start of a group.
    expect(() => regExpToRoute(/^\/a[(](?:\/(?<x>[^/]*))??\/?$/)).toThrow(
      /unsupported metacharacter "\["/,
    );
  });

  it("rejects match-affecting regexp flags", () => {
    expect(() => regExpToRoute(/^\/path\/?$/i)).toThrow(/flag/);
    expect(() => regExpToRoute(/^\/path\/?$/m)).toThrow(/flag/);
    expect(() => regExpToRoute(/^\/path\/?$/s)).toThrow(/flag/);
    // `u` / `v` change what a constraint means (`\p{L}` is a letter class
    // with them, the literal `p{L}` without), and routes compile theirs
    // without flags.
    expect(() => regExpToRoute(/^\/a\/(?<x>\p{L}+)\/?$/u)).toThrow(/^rou3: .*flag/);
    expect(() => regExpToRoute(/^\/a\/(?<x>\p{L}+)\/?$/v)).toThrow(/^rou3: .*flag/);
    expect(() => regExpToRoute(/^\/path\/?$/u)).toThrow(/^rou3: .*flag/);
    // Flags that don't change what a fully-anchored regex matches are accepted.
    expect(regExpToRoute(/^\/path\/?$/g)).toBe("/path");
    expect(regExpToRoute(/^\/path\/?$/y)).toBe("/path");
    expect(regExpToRoute(/^\/path\/?$/d)).toBe("/path");
    expect(regExpToRoute(/^\/path\/?$/dgy)).toBe("/path");
  });

  it("rejects regexes that are not anchored at both ends", () => {
    // An unanchored regex matches any path containing it; a route matches
    // whole paths only, so the result would be far narrower than the input.
    for (const re of [
      /\/users\/(?<id>\d+)/,
      /\/users$/,
      /^\/users/,
      /\/users\/?/,
      /^\/a\$/, // an escaped `$` is a literal, not an anchor
      /^\/a\\\$/,
    ]) {
      expect(() => regExpToRoute(re), re.source).toThrow(/^rou3: .*anchored/);
    }
    for (const source of ["\\/users\\/?", "^\\/users\\/?", "\\/users\\/?$", ""]) {
      expect(() => regExpToRoute(source), source).toThrow(/^rou3: .*anchored/);
    }
    // An escaped backslash before the `$` leaves it an anchor.
    expect(regExpToRoute(/^\/a\\$/)).toBe("/a\\\\");
  });

  it("supports bare (unnamed) capturing groups", () => {
    // routeToRegExp emits `(?<_N>…)` for unnamed groups, but a hand-written bare
    // group following the same conventions should map too.
    expect(regExpToRoute(/^\/path\/(\d+)\/?$/)).toBe("/path/(\\d+)");
    expect(regExpToRoute(/^\/path\/(png|jpg)\/?$/)).toBe("/path/(png|jpg)");
    expect(regExpToRoute(/^\/path\/([\s\S]*)\/foo\/?$/)).toBe("/path/*/foo");
    expect(() => regExpToRoute(/^\/path\/([^/]*)\/?$/)).toThrow(/^rou3: /);
    expect(regExpToRoute(/^\/path\/(\d+)-x\/?$/)).toBe("/path/(\\d+)-x");
    // A bare group that can't survive path splitting still throws.
    expect(() => regExpToRoute(/^\/path\/([^/]+)\/?$/)).toThrow(/cannot contain/);
  });

  it("keeps an optional unnamed capture unnamed", () => {
    // No `:_0(…)?`: that is a param named `_0` (key `"_0"`, not `"0"`).
    const cases: [RegExp, string][] = [
      [/^\/a(?:\/(?<_0>\d+))?\/?$/, "/a{/(\\d+)}?"],
      [/^\/(?:\/(?<_0>\d+))?\/\.\/?$/, "/{/(\\d+)}?/\\."],
      [/^\/(?<y>[^/]+)(?:\/(?<_0>\d+))?\/?$/, "/:y{/(\\d+)}?"],
      [/^\/a(?:\/(?<_0>.*?))??\/?$/, "/a{/(.*)}?"],
      [/^\/a(?:\/(?<_0>\d+))?\/b\/?$/, "/a{/(\\d+)}?/b"],
      [/^\/a(?:\/(?<_0>[\s\S]+))?\/?$/, "/a{/([\\s\\S]+)}?"],
      [/^\/a(?:\/(\d+))?\/?$/, "/a{/(\\d+)}?"],
    ];
    for (const [re, route] of cases) {
      expect(regExpToRoute(re), re.source).toBe(route);
    }
    // A root one starts the route with the group (absolute, as in URLPattern)
    expect(regExpToRoute(/^(?:\/(?<_0>\d+))?\/b\/?$/)).toBe("{/(\\d+)}?/b");
    for (const route of ["/a{/(\\d+)}?/b", "/a{/(\\d+)}?", "{/(\\d+)}?/b", "{/a}?/b"]) {
      const re = routeToRegExp(route);
      expect(regExpToRoute(re), route).toBe(route);
    }
    // An unnamed catch-all is the bare `**`. A `([\s\S]*)` constraint in an
    // optional segment compiles to the same regex (it can match `/`, so the
    // regex over-matches the route), and reads back as `**` too.
    expect(regExpToRoute(/^\/a(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$/)).toBe("/a/**");
    expect(routeToRegExp("/a{/([\\s\\S]*)}?").source).toBe(routeToRegExp("/a/**").source);
    // Unnamed `[^/]+` has no route form.
    expect(() => regExpToRoute(/^\/a(?:\/(?<_0>[^/]+))?\/?$/)).toThrow(/cannot contain/);
    expect(() => regExpToRoute(/^\/a(?:\/(?<_0>[^/]+)(?:\/b)?)?\/?$/)).toThrow(/cannot contain/);
    // Nor an unnamed catch-all (no `:_0*`).
    expect(() => regExpToRoute(/^\/a(?:\/(?:(?<_0>[\s\S]*)\/)?(?<y>[^/]*))?\/?$/)).toThrow(
      /^rou3: /,
    );
    // Nor one inside an optional group: `{…}` can't nest.
    for (const re of [
      /^\/a(?:\/(?<x>[^/]+)(?:\/(?<_0>\d+))?)?\/?$/,
      /^\/a(?:\/b(?:\/(?<_0>\d+))?)?\/?$/,
      /^\/a(?:\/b(?:\/(?<_0>\d*))??\/c)?\/?$/,
    ]) {
      expect(() => regExpToRoute(re), re.source).toThrow(/^rou3: /);
    }
  });

  it("reads an optional `*` group back as `**`", () => {
    // `{/*}?` is a `*` (one segment or more) or nothing: a `**`'s paths and
    // captures (it reports the deprecated `_` alias too, see
    // KNOWN_NON_EQUIVALENT), and the same regex.
    for (const [route, back] of [
      ["/a{/*}?/b", "/a/**/b"],
      ["/a{/*}?/:q", "/a/**/:q"],
      ["/a{/*}?", "/a/**"],
    ]) {
      const re = routeToRegExp(route);
      expect(regExpToRoute(re), route).toBe(back);
      expect(routeToRegExp(back).source, route).toBe(re.source);
    }
  });
});

// Routes whose reversal is not equivalent, with the route they come back as.
const KNOWN_NON_EQUIVALENT: Record<string, readonly [back: string, reason: string]> = {
  // A constraint spelled like rou3's catch-all body compiles to the catch-all
  // regex (constraints that can match `/` are not modeled, see AGENTS.md).
  "/:x([\\s\\S]*)": ["/:x(.*)", "a `[\\s\\S]*` constraint comes back as a catch-all"],
  "/a/:x([\\s\\S]*)": ["/a/:x(.*)", "a `[\\s\\S]*` constraint comes back as a catch-all"],
  "/a/:x([\\s\\S]*)?": ["/a{/:x(.*)}?", "a `[\\s\\S]*` constraint comes back as a catch-all"],
  // Optionals after a whole-segment `:x?` nest in its group (see
  // `routeToRegExpSegments`), so these compile to the regex of the `{/:x/…}?`
  // route and come back as it: the same paths, captured like the regex does,
  // which differs from the original route (KNOWN_CAPTURE_DIFFS in
  // test/regexp.test.ts). One that can be empty (`*`, `**`) doesn't nest.
  "/a/:x?/:y(\\d+)?": [
    "/a{/:x/:y(\\d+)?}?",
    "the router gives a lone number to `y`, the regex to `x`",
  ],
  // The same after a catch-all, where the router ranks its routes from the end.
  "/a/**/:y?/:n(\\d+)?": [
    "/a/**{/:y/:n(\\d+)?}?",
    "the router gives a lone last number to `n`, the regex to `y`",
  ],
  "/a/**/:y?/:n(a|b)?": [
    "/a/**{/:y/:n(a|b)?}?",
    "the router gives a lone last `a` / `b` to `n`, the regex to `y`",
  ],
  // An optional `*` group compiles like a `**`, which also reports the
  // deprecated `_` alias (no regex can).
  "/a{/*}?": ["/a/**", "the `**` also reports `_`"],
  "/a{/*}?/b": ["/a/**/b", "the `**` also reports `_`"],
  "/a{/*}?/:q": ["/a/**/:q", "the `**` also reports `_`"],
  "/{/*}?/b": ["//**/b", "the `**` also reports `_`"],
  "{/*}?/b": ["/**/b", "the `**` also reports `_`"],
};

/** Sweep paths, also under the route's leading static segments (`/path/…`). */
function pathsUnder(route: string): string[] {
  const prefix = /^(?:\/[\w%-]+)*/.exec(route)![0];
  const paths = sweepPaths();
  return prefix ? [...paths, ...paths.map((path) => prefix + path)] : paths;
}

/** Paths where `a` and `b`, each alone in a router, route differently. */
function routingDiffs(a: string, b: string, paths: Iterable<string>): string[] {
  const routerA = createRouter();
  addRoute(routerA, "", a, true);
  const routerB = createRouter();
  addRoute(routerB, "", b, true);
  const diffs: string[] = [];
  for (const path of new Set(paths)) {
    const foundA = describeMatch(findRoute(routerA, "", path));
    const foundB = describeMatch(findRoute(routerB, "", path));
    if (foundA !== foundB) diffs.push(`${path} (${foundA} vs ${foundB})`);
  }
  return diffs;
}

/** A match as its params, unset ones dropped (the router reports some as `undefined`). */
function describeMatch(match?: { params?: Record<string, string | undefined> }): string {
  if (!match) return "no match";
  const params: Record<string, string> = {};
  for (const key in match.params) {
    if (match.params[key] !== undefined) params[key] = match.params[key];
  }
  return JSON.stringify(params);
}

// Paths for the 0.11 single-segment `*` regexes (`[^/]*`)
const LEGACY_STAR_PATHS = [
  "/",
  "//",
  "/a",
  "/a/",
  "/a//",
  "/a/b",
  "/a/b/",
  "/path",
  "/path/",
  "/path//",
  "/path/a",
  "/path/a/",
  "/path/a/b",
  "/path/foo",
  "/path//foo",
  "/path/a/foo",
  "/path/a/b/foo",
  "/path/.png",
  "/path/a.png",
  "/path/a/b.png",
];
