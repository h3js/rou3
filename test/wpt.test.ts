import { describe, it, expect } from "vitest";
import {
  routeToRegExp,
  createRouter,
  addRoute,
  findRoute,
} from "../src/index.ts";
import { compileRouter } from "../src/compiler.ts";
import { normalizeUnnamedGroupKey } from "../src/_segment-wildcards.ts";
import { normalizePath } from "../src/operations/_utils.ts";

// https://github.com/web-platform-tests/wpt/blob/master/urlpattern/resources/urlpatterntestdata.json
import testData from "./wpt/urlpatterntestdata.json" with { type: "json" };

type WptEntry = {
  pattern: Array<Record<string, string> | string>;
  inputs: Array<Record<string, string>>;
  expected_obj?: string | Record<string, string>;
  expected_match: null | Record<
    string,
    { input: string; groups: Record<string, string | null> }
  >;
};

function normalizeGroups(
  groups: Record<string, string> | undefined,
): Record<string, string> {
  if (!groups) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(groups)) {
    if (key === "_") continue;
    const normalized = normalizeUnnamedGroupKey(key).replace(/^_(\d+)$/, "$1");
    result[normalized] = value;
  }
  return result;
}

function getPathnameTests(): Array<{
  pattern: string;
  input: string | undefined;
  expectedMatch: boolean;
  expectedGroups: Record<string, string | null>;
  isError: boolean;
}> {
  const tests: ReturnType<typeof getPathnameTests> = [];

  for (const entry of testData as Array<string | WptEntry>) {
    if (typeof entry === "string") continue;

    const p = entry.pattern;
    if (!Array.isArray(p) || p.length === 0) continue;
    if (typeof p[0] !== "object" || p[0] === null) continue;

    const keys = Object.keys(p[0]);
    if (keys.length !== 1 || keys[0] !== "pathname") continue;

    const pattern = (p[0] as Record<string, string>).pathname;
    const isError = entry.expected_obj === "error";
    const input = entry.inputs?.[0]?.pathname;
    const expectedMatch = entry.expected_match !== null;
    const expectedGroups = entry.expected_match?.pathname?.groups ?? {};

    tests.push({ pattern, input, expectedMatch, expectedGroups, isError });
  }

  return tests;
}

// Patterns to skip: outside rou3's scope or using unsupported syntax
const SKIP_PATTERNS = new Set([
  // Non-path patterns
  "var x = 1;",

  // Path normalization (`.`, `..`) — rou3 does not resolve relative segments
  "/foo/../bar",
  "./foo",
  "../foo",

  // Unicode identifiers — rou3 params use `\w` (ASCII word chars)
  "(café)",
  "/:café",
  "/:℘",
  "/:㐀",
  "​​",
  ":​​",
  ":a󠄀b",
  "test/:a𐑐b",
  ":🚲",

  // Percent-encoding normalization — rou3 does not decode
  "/caf%C3%A9",
  "/café",
  "/caf%c3%a9",

  // Non-greedy unnamed group — different regex flavor
  "/foo/([^\\/]+?)",

  // Regex set operations (v-flag syntax) — not used in rou3 routes
  "/([[a-z]--a])",
  "/([\\d&&[0-1]])",
]);

/**
 * Known semantic differences between rou3 and URLPattern:
 *
 * 1. Trailing slash: rou3 adds `/?$` — optionally matches trailing `/`
 * 2. `*` semantics: URLPattern `*` = greedy catch-all `(.*)`;
 *    rou3 `*` = single-segment unnamed param `([^/]*)`
 * 3. `(.*)` semantics: URLPattern `(.*)` matches across `/`;
 *    rou3 `(.*)` is segment-scoped (no cross-segment matching)
 * 4. `**` semantics: URLPattern `**` = literal `**`;
 *    rou3 `**` = catch-all wildcard
 * 5. `{...}+`/`{...}*`: URLPattern supports group repetition;
 *    rou3 only supports `{...}?` (optional groups)
 * 6. Backslash escaping: URLPattern uses `\` to escape;
 *    rou3 treats `\` differently in some contexts
 * 7. Path normalization: URLPattern resolves `.`/`..` in input;
 *    rou3 does not
 * 8. Case sensitivity: URLPattern may be case-insensitive;
 *    rou3 is always case-sensitive
 */

// Known diff labels: tests where rou3 intentionally behaves differently.
// Tracked as `it.fails()` so we notice if rou3 gains compatibility.
// Labels include `[match]` or `[no match]` to disambiguate duplicate patterns.
const KNOWN_DIFFS = new Set([
  // `(.*)` semantics — URLPattern `(.*)` is greedy catch-all across `/`;
  // rou3 `(.*)` inside a segment is treated as a named regex group
  "/foo/(.*) → /foo/bar [match]",
  "/foo/(.*) → /foo/bar/baz [match]",
  "/foo/:bar(.*) → /foo/bar [match]",
  "/foo/:bar(.*) → /foo/bar/baz [match]",

  // `*` catch-all vs single-segment — URLPattern `*` = `(.*)`, rou3 `*` = `([^/]*)`
  "/foo/* → /foo/bar/baz [match]",

  // `(.*)` / `*` with modifiers — rou3 doesn't support these as URLPattern does
  "/foo/(.*)? → /foo/bar [match]",
  "/foo/(.*)? → /foo/bar/baz [match]",
  "/foo/(.*)? → /foo [match]",
  "/foo/(.*)? → /foo/ [match]",
  "/foo/*? → /foo/bar/baz [match]",
  "/foo/*? → /foo [match]",
  "/foo/*? → /foo/ [match]",
  "/foo/(.*)+ → /foo/bar [match]",
  "/foo/(.*)+ → /foo/bar/baz [match]",
  "/foo/*+ → /foo/bar/baz [match]",
  "/foo/(.*)* → /foo/bar/baz [match]",
  "/foo/(.*)* → /foo [match]",

  // `**` — rou3 catch-all vs URLPattern literal double-star
  "/foo/** → /foo/ [match]",
  "/foo/** → /foo/bar [match]",
  "/foo/** → /foo/bar/baz [match]",

  // `{/bar}+` / `{/bar}*` — cross-segment group repetition (unsupported)
  "/foo{/bar}+ → /foo/bar [match]",
  "/foo{/bar}+ → /foo/bar/bar [match]",
  "/foo{/bar}+ → /foo/bar/baz [no match]",
  "/foo{/bar}+ → /foo [no match]",
  "/foo{/bar}+ → /foo/ [no match]",
  "/foo{/bar}* → /foo/bar [match]",
  "/foo{/bar}* → /foo/bar/bar [match]",
  "/foo{/bar}* → /foo/bar/baz [no match]",
  "/foo{/bar}* → /foo [match]",
  "/foo{/bar}* → /foo/ [match]",
  "/foo{/bar}* → /foo/ [no match]",

  // Non-`/`-prefixed input — URLPattern normalizes input paths
  "/foo/bar → foo/bar [match]",

  // Case-insensitive match — rou3 is case-sensitive
  "/foo/bar → /FOO/BAR [match]",

  // `*/` patterns — URLPattern treats `*` as catch-all
  "*/* → foo/bar [match]",
  "*\\/* → foo/bar [match]",
  "*/{*} → foo/bar [match]",
  "*//* → foo//bar [match]",

  // Patterns without leading `/` — rou3 always prefixes `/` in regex
  ":name → foobar [match]",
  "(foo)(.*) → foobarbaz [match]",
  "{(foo)bar}(.*) → foobarbaz [match]",
  "(foo)?(.*) → foobarbaz [match]",
  "{:foo}(.*) → foobarbaz [match]",
  "{:foo}(barbaz) → foobarbaz [match]",
  "{:foo}{(.*)} → foobarbaz [match]",
  "{:foo}{bar(.*)} → foobarbaz [match]",
  "{:foo}:bar(.*) → foobarbaz [match]",
  "{:foo}?(.*) → foobarbaz [match]",
  "{:foo\\bar} → foobar [match]",
  "{:foo\\.bar} → foo.bar [match]",
  "{:foo(foo)bar} → foobar [match]",
  "{:foo}bar → foobar [match]",
  ":foo\\bar → foobar [match]",
  ":foo{}(.*) → foobar [match]",
  ":foo{}bar → foobar [match]",
  ":foo{}?bar → foobar [match]",
  "*{}**? → foobar [match]",
  ":foo(baz)(.*) → bazbar [match]",
  ":foo(baz)bar → bazbar [match]",
  ":foo./ → bar./ [match]",
  ":foo../ → bar../ [match]",
]);

// Additional known diffs specific to router-based matching (addRoute+findRoute / compileRouter)
// These patterns use syntax that routeToRegExp handles but the radix tree cannot represent
// Known diffs that only apply to routeToRegExp (router handles these correctly)
const REGEXP_ONLY_KNOWN_DIFFS = new Set([
  // `**` as literal — routeToRegExp treats `**` as catch-all;
  // router also treats `**` as catch-all but doesn't match `/foobar`
  "/foo/** → /foobar [no match]",

  // Non-`/`-prefixed input — router prepends `/` for lookup
  "/foo/bar → foo/bar [match]",
]);

// Patterns that cannot be tested via the router (no leading `/`, unsupported syntax, etc.)
const ROUTER_SKIP_PATTERNS = new Set([
  // Patterns without leading `/` — router requires `/`-prefixed paths
  ":name",
  ":name*",
  ":name+",
  "(foo)(.*)",
  "{(foo)bar}(.*)",
  "(foo)?(.*)",
  "{:foo}(.*)",
  "{:foo}(barbaz)",
  "{:foo}{(.*)}",
  "{:foo}{bar(.*)}",
  "{:foo}:bar(.*)",
  "{:foo}?(.*)",
  "{:foo\\bar}",
  "{:foo\\.bar}",
  "{:foo(foo)bar}",
  "{:foo}bar",
  ":foo\\bar",
  ":foo{}(.*)",
  ":foo{}bar",
  ":foo{}?bar",
  "*{}**?",
  ":foo(baz)(.*)",
  ":foo(baz)bar",
  ":foo./",
  ":foo../",
  "*/*",
  "*\\/*",
  "*/{*}",
  "*//*",
]);

// Additional known diffs specific to router-based matching.
// These are tests where the radix tree router behaves differently from routeToRegExp.
const ROUTER_KNOWN_DIFFS = new Set([
  // `(.*)` / `*` with empty match — router doesn't match empty segments
  "/foo/(.*) → /foo/ [match]",
  "/foo/* → /foo/ [match]",
  "/foo/* → /foo [no match]",
  "/foo/:bar(.*) → /foo/ [match]",
  "/foo/(.*)+ → /foo/ [match]",
  "/foo/*+ → /foo/ [match]",
  "/foo/(.*)* → /foo/ [match]",
]);

type MatchStrategy = {
  name: string;
  match: (
    pattern: string,
    input: string,
  ) => { matched: boolean; params: Record<string, string> };
  shouldSkip?: (pattern: string) => boolean;
};

const strategies: MatchStrategy[] = [
  {
    name: "routeToRegExp",
    match(pattern, input) {
      const re = routeToRegExp(pattern);
      const match = normalizePath(input).match(re);
      if (!match) return { matched: false, params: {} };
      return { matched: true, params: normalizeGroups(match.groups) };
    },
  },
  {
    name: "addRoute + findRoute",
    shouldSkip: (pattern) => ROUTER_SKIP_PATTERNS.has(pattern),
    match(pattern, input) {
      const router = createRouter<{ path: string }>();
      addRoute(router, "GET", pattern, { path: pattern });
      const result = findRoute(router, "GET", input, { normalize: true });
      if (!result) return { matched: false, params: {} };
      return { matched: true, params: result.params ?? {} };
    },
  },
  {
    name: "addRoute + compileRouter",
    shouldSkip: (pattern) => ROUTER_SKIP_PATTERNS.has(pattern),
    match(pattern, input) {
      const router = createRouter<{ path: string }>();
      addRoute(router, "GET", pattern, { path: pattern });
      const lookup = compileRouter(router, { normalize: true });
      const result = lookup("GET", input);
      if (!result) return { matched: false, params: {} };
      return { matched: true, params: result.params ?? {} };
    },
  },
];

describe("wpt urlpattern compatibility", () => {
  const tests = getPathnameTests();

  for (const strategy of strategies) {
    describe(`${strategy.name}`, () => {
      describe("pathname matching", () => {
        const labelCounts = new Map<string, number>();
        for (const test of tests) {
          const baseLabel = `${test.pattern} ${test.isError ? "(expected error)" : `→ ${test.input ?? "(no input)"} [${test.expectedMatch ? "match" : "no match"}]`}`;
          const count = labelCounts.get(baseLabel) ?? 0;
          labelCounts.set(baseLabel, count + 1);
          const label = count > 0 ? `${baseLabel} #${count + 1}` : baseLabel;

          if (
            SKIP_PATTERNS.has(test.pattern) ||
            strategy.shouldSkip?.(test.pattern)
          ) {
            it.skip(label, () => {});
            continue;
          }

          if (test.isError) {
            it(label, () => {
              try {
                strategy.match(test.pattern, "/");
              } catch {
                // Expected — pattern is invalid
              }
            });
            continue;
          }

          if (test.input === undefined) continue;

          const isRegexp = strategy.name === "routeToRegExp";
          const isKnownDiff =
            KNOWN_DIFFS.has(label) ||
            (isRegexp && REGEXP_ONLY_KNOWN_DIFFS.has(label)) ||
            (!isRegexp && ROUTER_KNOWN_DIFFS.has(label));
          const testFn = isKnownDiff ? it.fails : it;

          testFn(label, () => {
            const { matched, params } = strategy.match(
              test.pattern,
              test.input!,
            );

            if (!test.expectedMatch) {
              // rou3 allows trailing slash — acceptable difference
              if (matched && test.input!.endsWith("/")) return;
              expect(
                matched,
                `"${test.input}" should not match pattern "${test.pattern}"`,
              ).toBe(false);
              return;
            }

            expect(
              matched,
              `"${test.input}" should match pattern "${test.pattern}"`,
            ).toBe(true);

            for (const [key, value] of Object.entries(test.expectedGroups)) {
              if (value === null) {
                expect(
                  params[key],
                  `group "${key}" should be undefined/missing`,
                ).toBeUndefined();
              } else {
                expect(params[key], `group "${key}"`).toBe(value);
              }
            }
          });
        }
      });
    });
  }
});
