import { describe, it, expect } from "vitest";
import { addRoute, createRouter, findRoute, regExpToRoute, routeToRegExp } from "../src/index.ts";
import {
  regexpCases,
  PCRE2_DUPLICATE_NAME_ROUTES,
  sweepPaths,
  sweepPatterns,
} from "./_regexp-cases.ts";

// The look-behind trailing-slash suffix (as `RegExp#source` spells it).
const LB = "(?:(?<=\\/)\\/|(?<!\\/)\\/?)$";

describe("regExpToRoute", () => {
  // Every fixture route -> regex -> route must round-trip (its regex, converted
  // back, produces a route whose regex is identical) and route the same way:
  // equal sources alone let `/path/:rest*` come back as `/path/:rest(.*?)?`.
  // Alternation-fallback routes (PCRE2_DUPLICATE_NAME_ROUTES) are not
  // reversible and excluded.
  for (const [route, { regex, match, noMatch = [] }] of Object.entries(regexpCases)) {
    if (PCRE2_DUPLICATE_NAME_ROUTES.has(route)) {
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
  // alternation output (several expansions OR-ed together) may be rejected.
  it("reverses sweep patterns to equivalent routes", () => {
    const paths = sweepPaths();
    const mismatches: string[] = [];
    const stale: string[] = [];
    for (const pattern of new Set([...sweepPatterns(), ...Object.keys(KNOWN_NON_EQUIVALENT)])) {
      let back: string;
      try {
        back = regExpToRoute(routeToRegExp(pattern));
      } catch (error) {
        expect((error as Error).message, pattern).toMatch(/unsupported non-optional group/);
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
  });

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
    expect(regExpToRoute(/^\/path\/(?<_0>[^/]*)\/foo\/?$/)).toBe("/path/*/foo");
    expect(regExpToRoute(/^\/path\/(?<_0>[^/]*)\.png\/?$/)).toBe("/path/*.png");
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
    // `(?<_>.*)` is `**` only when it ends the route; `**` is terminal.
    expect(regExpToRoute(routeToRegExp("/a/**"))).toBe("/a/**");
    expect(regExpToRoute(/^\/a(?:\/(?<_>.*))?\/b\/?$/)).toBe("/a/:_*/b");
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
    expect(regExpToRoute(routeToRegExp("/a/c{/:w+}?"))).toBe("/a/c/:w*");
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

  // rou3's catch-alls match any char (`[\s\S]*`); a `.*` is a constraint the
  // user wrote, and keeps its own ending, so the two no longer collide.
  it("tells a `(.*)` constraint apart from a catch-all", () => {
    for (const route of [
      "/a/:x(.*)",
      "/a/:x(.*)?",
      "/:x(.*)",
      "/:x(.*)?",
      "/a/(.*)",
      "/a/:x+",
      "/a/:x*",
      "/:x+",
      "/:x*",
    ]) {
      expect(regExpToRoute(routeToRegExp(route)), route).toBe(route);
    }
  });

  it("accepts the two-trailing-slash suffix emitted by older versions (#209)", () => {
    expect(regExpToRoute(/^\/path\/(?<id>[^/]*)(?:\/\/|(?<!\/)\/?)$/)).toBe("/path/:id");
    expect(regExpToRoute(/^\/\/?$/)).toBe("/");
    expect(routeToRegExp("/").source).toBe("^\\/$");
    expect(regExpToRoute(routeToRegExp("/"))).toBe("/");
  });

  it("decodes escaped capture-group names back to the original param name", () => {
    // Param names that aren't valid capture-group names (`-`, leading digit) are
    // emitted escaped; reversing must restore the original name, not leak the
    // internal form as `:__rou3_esc_test_hid`.
    expect(regExpToRoute(/^\/api\/(?<__rou3_esc_test_hid>[^/]+)\/?$/)).toBe("/api/:test-id");
    expect(regExpToRoute(/^\/api\/(?<__rou3_esc_test_hid>.+)\/?$/)).toBe("/api/:test-id+");
    expect(regExpToRoute(/^\/api(?:\/(?<__rou3_esc_test_hid>[^/]+))?\/?$/)).toBe("/api/:test-id?");
    expect(regExpToRoute(/^\/api\/(?<__rou3_esc_0>[^/]+)\/?$/)).toBe("/api/:0");
    expect(regExpToRoute(/^\/mix\/(?<__rou3_esc_a_hb>[^/]+)\.(?<a_b>[^/]+)\/?$/)).toBe(
      "/mix/:a-b.:a_b",
    );
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

  it("keeps a trailing unnamed `(.*)` a constraint", () => {
    expect(regExpToRoute(routeToRegExp("/a/(.*)"))).toBe("/a/(.*)");
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
    const alt = routeToRegExp("/media/*{.webp}?");
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

  it("rejects match-affecting regexp flags", () => {
    expect(() => regExpToRoute(/^\/path\/?$/i)).toThrow(/flag/);
    expect(() => regExpToRoute(/^\/path\/?$/m)).toThrow(/flag/);
    expect(() => regExpToRoute(/^\/path\/?$/s)).toThrow(/flag/);
    // Flags that don't change matching semantics are accepted.
    expect(regExpToRoute(/^\/path\/?$/u)).toBe("/path");
    expect(regExpToRoute(/^\/path\/?$/g)).toBe("/path");
  });

  it("supports bare (unnamed) capturing groups", () => {
    // routeToRegExp emits `(?<_N>…)` for unnamed groups, but a hand-written bare
    // group following the same conventions should map too.
    expect(regExpToRoute(/^\/path\/(\d+)\/?$/)).toBe("/path/(\\d+)");
    expect(regExpToRoute(/^\/path\/(png|jpg)\/?$/)).toBe("/path/(png|jpg)");
    expect(regExpToRoute(/^\/path\/([^/]*)\/?$/)).toBe("/path/*");
    expect(regExpToRoute(/^\/path\/(\d+)-x\/?$/)).toBe("/path/(\\d+)-x");
    // A bare group that can't survive path splitting still throws.
    expect(() => regExpToRoute(/^\/path\/([^/]+)\/?$/)).toThrow(/cannot contain/);
  });
});

// Routes whose reversal is not equivalent, with the route they come back as.
const KNOWN_NON_EQUIVALENT: Record<string, readonly [back: string, reason: string]> = {
  // A constraint spelled like rou3's catch-all body compiles to the catch-all
  // regex (constraints that can match `/` are not modeled, see AGENTS.md).
  "/:x([\\s\\S]*)": ["/:x+", "a `[\\s\\S]*` constraint comes back as a catch-all"],
  "/a/:x([\\s\\S]*)": ["/a/:x+", "a `[\\s\\S]*` constraint comes back as a catch-all"],
  "/a/:x([\\s\\S]*)?": ["/a/:x*", "a `[\\s\\S]*` constraint comes back as a catch-all"],
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
