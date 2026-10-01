import { describe, it, expect } from "vitest";
import { routeToRegExp, createRouter, addRoute, findRoute } from "../src/index.ts";
import { compileRouter } from "../src/compiler.ts";
import { fromGroupName } from "../src/_group-names.ts";
import { normalizePath } from "../src/operations/_utils.ts";

// Vendored verbatim from web-platform-tests (wpt master 5cd8e3fa0a6c, 2026-10-01;
// the file last changed in 23aac9278460):
// https://github.com/web-platform-tests/wpt/blob/5cd8e3fa0a6c4ca11fa565f7c0956802c8e0045d/urlpattern/resources/urlpatterntestdata.json
// Read the way WPT's runner (`urlpattern/resources/urlpatterntests.js`) reads it.
import testData from "./wpt/urlpatterntestdata.json" with { type: "json" };

type WptResult = { input: string; groups: Record<string, string | null> };

type WptEntry = {
  "//"?: string;
  // `[init or URL string, base URL or options?, options?]`
  pattern: Array<Record<string, unknown> | string>;
  // `[init or URL string, base URL?]`
  inputs?: Array<Record<string, string> | string>;
  expected_obj?: "error" | Record<string, string>;
  // `null`: no match, `"error"`: test() / exec() throw on the inputs
  expected_match?: null | "error" | Record<string, WptResult>;
  // Components that match exactly `""` (no default `*` capture)
  exactly_empty_components?: string[];
};

type PathnameTest = {
  label: string;
  pattern: string;
  /** `undefined`: URLPattern rejects the pattern (`expected_obj: "error"`) */
  input?: string;
  /** Pathname groups, `null` for no match (an unset group is `undefined`) */
  groups?: Record<string, string | undefined> | null;
  /** Why no strategy can run this case */
  skip?: string;
};

/**
 * The pathname cases in the WPT data. Entries whose pattern is not a lone
 * `pathname` init are out of scope for a path router and only counted
 * (`outOfScope`, by reason).
 */
function readPathnameTests() {
  const tests: PathnameTest[] = [];
  const outOfScope = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  for (const entry of testData as WptEntry[]) {
    const test = readEntry(entry);
    if (typeof test === "string") {
      outOfScope.set(test, (outOfScope.get(test) ?? 0) + 1);
      continue;
    }
    const count = (labelCounts.get(test.label) ?? 0) + 1;
    labelCounts.set(test.label, count);
    if (count > 1) test.label += ` #${count}`;
    tests.push(test);
  }
  return { tests, outOfScope };
}

function readEntry(entry: WptEntry): PathnameTest | string {
  const [init, options] = entry.pattern;
  if (init === undefined) return "no pattern (an empty init matches any URL)";
  if (typeof init === "string") return "URL string pattern (constrains every component)";
  if (!("pathname" in init)) return "no pathname component";
  if (Object.keys(init).length > 1)
    return "constrains other components too (`baseURL`, `protocol`)";
  const pattern = init.pathname as string;

  if (entry.expected_obj === "error") {
    const test: PathnameTest = { label: `${pattern} (expected error)`, pattern };
    if (options !== undefined) {
      test.skip = "a base URL next to an init throws in the constructor, the pattern is fine";
    }
    return test;
  }

  const inputs = entry.inputs ?? [];
  const label = `${pattern} → ${inputs.length > 0 ? JSON.stringify(inputs) : "(no inputs)"}`;
  if (options !== undefined) {
    const reason =
      typeof options === "object" && options.ignoreCase
        ? "`ignoreCase`: rou3 is always case-sensitive"
        : `constructor options ${JSON.stringify(options)}`;
    return { label, pattern, skip: reason };
  }
  if (inputs.length === 0) {
    return { label, pattern, skip: "no inputs: checks the canonical pattern string only" };
  }
  if (entry.expected_match === "error") {
    return { label, pattern, skip: "exec() throws on its arguments (a base URL next to an init)" };
  }

  const input = readInput(inputs);
  if (typeof input === "string") return { label, pattern, skip: input };

  // WPT's runner: a missing component result is `""` with a `"0": ""` capture,
  // unless the component is in `exactly_empty_components`
  const result: WptResult | null = entry.expected_match
    ? (entry.expected_match.pathname ?? {
        input: "",
        groups: entry.exactly_empty_components?.includes("pathname") ? {} : { "0": "" },
      })
    : null;
  if (result && input.from && result.input !== input.pathname) {
    throw new Error(`wpt: "${input.from}" resolves to "${input.pathname}", not "${result.input}"`);
  }
  // `null` in the data is an unset (`undefined`) group
  const groups = result
    ? Object.fromEntries(Object.entries(result.groups).map(([k, v]) => [k, v ?? undefined]))
    : null;
  const from = input.from ? ` (from ${input.from})` : "";
  return {
    label: `${pattern} → ${input.pathname}${from} [${groups ? "match" : "no match"}]`,
    pattern,
    input: input.pathname,
    groups,
  };
}

/**
 * The pathname rou3 is handed for a WPT input: an init `pathname` as written
 * (rou3 does not canonicalize, see percent-encoding in `KNOWN_DIFFS`), resolved
 * against its `baseURL`, or a URL string's parsed pathname. Returns a skip
 * reason when there is no path to route.
 */
function readInput(
  inputs: NonNullable<WptEntry["inputs"]>,
): { pathname: string; from?: string } | string {
  const [input, baseURL] = inputs;
  if (typeof input === "string") {
    const from = JSON.stringify(baseURL === undefined ? input : [input, baseURL]);
    try {
      return { pathname: new URL(input, baseURL as string | undefined).pathname, from };
    } catch {
      return "input is not a valid URL (URLPattern returns null)";
    }
  }
  if (input.protocol !== undefined) {
    return "input `protocol` decides how its pathname is canonicalized";
  }
  if (input.pathname === undefined) return "input has no pathname";
  if (input.baseURL !== undefined) {
    return {
      pathname: new URL(input.pathname, input.baseURL).pathname,
      from: JSON.stringify(input),
    };
  }
  // Other components (`hostname`) are wildcards in a pathname-only pattern
  return { pathname: input.pathname };
}

function normalizeGroups(groups: Record<string, string> | undefined): Record<string, string> {
  if (!groups) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(groups)) {
    if (key === "_") continue;
    const normalized = fromGroupName(key).replace(/^_(\d+)$/, "$1");
    result[normalized] = value;
  }
  return result;
}

/**
 * Known semantic differences between rou3 and URLPattern:
 *
 * 1. Trailing slash: rou3 ignores at most one trailing `/`
 * 2. `*` semantics: URLPattern `*` = greedy catch-all `(.*)`;
 *    rou3 `*` = single-segment unnamed param `([^/]*)`
 * 3. `(.*)` semantics: URLPattern `(.*)` matches across `/`; so does
 *    `routeToRegExp`, while the tree's `(.*)` is segment-scoped
 * 4. `**` semantics: URLPattern parses `**` as `*` with a `*` modifier (a
 *    catch-all captured as `"0"`); rou3 `**` is a catch-all captured as `_`
 * 5. `{...}+`/`{...}*`, and modifiers on `*` or an unnamed group
 *    (`(.*)?`, `*+`): URLPattern supports them; rou3 rejects them (see
 *    `RESERVED_PATTERNS`)
 * 6. Backslash escaping: any `\x` is a literal `x` in both (inside a
 *    constraint it is regex); rou3 rejects a `\/`
 * 7. Path normalization: URLPattern resolves `.`/`..` in patterns and
 *    inputs; rou3 only in inputs (`normalize`)
 * 8. Case sensitivity: URLPattern may be case-insensitive (`ignoreCase`);
 *    rou3 is always case-sensitive
 * 9. Percent-encoding: both encode the pattern's literal text; URLPattern
 *    also encodes the input, rou3 takes it encoded (`new URL().pathname`), so
 *    the strategies get it through `encodePathname`
 * 10. Relative paths: rou3 reads every pattern as absolute (`/`-prefixed)
 */

/**
 * The input as URLPattern (and `new URL().pathname`) encodes it: the URL path
 * percent-encode set as UTF-8, `%` kept. Checked against URLPattern below.
 */
function encodePathname(path: string): string {
  return path.replace(/[\0- "#<>?^`{}\x7F-\u{10FFFF}]/gu, (c) => encodeURIComponent(c));
}

// Known diff labels: tests where rou3 intentionally behaves differently.
// Asserted to differ (and not to throw) so we notice if rou3 gains compatibility.
// Labels include `[match]` or `[no match]` to disambiguate duplicate patterns.
const KNOWN_DIFFS = new Set([
  // `(.*)` cross-segment — a regex group `(.*)` matches across `/` (URLPattern
  // semantics), which routeToRegExp now reproduces, so single-segment inputs
  // agree for every strategy. The tree is segment-scoped, so multi-segment
  // and empty inputs stay router-only diffs (see ROUTER_KNOWN_DIFFS). Only inputs
  // that still differ for *every* strategy remain here.

  // `*` catch-all vs single-segment — URLPattern `*` = `(.*)`, rou3 `*` = `([^/]*)`
  "/foo/* → /foo/bar/baz [match]",

  // Trailing slash — rou3 ignores at most one trailing slash, so `/foo/` is
  // `/foo` (no empty last segment), and a trailing `*` is optional. URLPattern
  // matches `/foo/` with an empty capture and rejects `/foo` for `/foo/*`.
  // routeToRegExp reproduces the router here (#200).
  "/foo/(.*) → /foo/ [match]",
  "/foo/* → /foo/ [match]",
  "/foo/* → /foo [no match]",
  "/foo/:bar(.*) → /foo/ [match]",

  // `**` — URLPattern reads `**` as `*` with a `*` modifier and captures it as
  // `"0"`; rou3 names the bare `**` capture `_`
  "/foo/** → /foo/ [match]",
  "/foo/** → /foo/bar [match]",
  "/foo/** → /foo/bar/baz [match]",

  // Relative inputs — rou3's regex is anchored at `/` (the router skips them)
  "*/* → foo/bar [match]",
  "*/{*} → foo/bar [match]",

  // Patterns without leading `/` — rou3 always prefixes `/` in regex
  ":name → foobar [match]",
  "(foo)(.*) → foobarbaz [match]",
  "{(foo)bar}(.*) → foobarbaz [match]",
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
  ":foo(baz)(.*) → bazbar [match]",
  ":foo(baz)bar → bazbar [match]",
  ":foo./ → bar./ [match]",
  ":foo../ → bar../ [match]",
  "./foo → ./foo [match]",
  "../foo → ../foo [match]",
  "var x = 1; → var x = 1; [match]",

  // A relative pattern never matches an absolute path in URLPattern; rou3
  // reads it as absolute
  'foo/bar → /foo/bar (from "https://example.com/foo/bar") [no match]',

  // `.`/`..` in a pattern — URLPattern resolves them (`/foo/../bar` is
  // `/bar`); rou3 reads them as literal segments
  "/foo/../bar → /bar [match]",

  // `v`-flag set operations — rou3 compiles constraints without the `v` flag,
  // so `--` / `&&` are plain class chars
  "/([[a-z]--a]) → /z [match]",
  "/([\\d&&[0-1]]) → /0 [match]",

  // Trailing slash on a no-match case — rou3 ignores one trailing `/`, so
  // `/foo/bar/` is `/foo/bar` (a second one is an empty last segment)
  "/foo/bar → /foo/bar/ [no match]",
  "/foo/:bar → /foo/bar/ [no match]",
  "/foo/:bar? → /foo/ [no match]",
  "/foo/:bar* → /foo/ [no match]",
  "/foo{/bar}? → /foo/ [no match]",
]);

// Valid URLPattern syntax rou3 has no meaning for (yet): every strategy
// throws a `rou3:` error for these patterns instead of matching with a
// different meaning (modifiers on `*` / an unnamed group, group repetition,
// a `/` or a capturing group in a constraint, a `\/`, Unicode param names).
const RESERVED_PATTERNS = new Set([
  "/foo/(.*)?",
  "/foo/*?",
  "/foo/(.*)+",
  "/foo/*+",
  "/foo/(.*)*",
  "/foo{/bar}+",
  "/foo{/bar}*",
  "(foo)?(.*)",
  // `{}*`: repetition of an empty group
  "*{}**?",
  // A `/` inside a constraint: the pattern is split on `/` first
  "/foo/([^\\/]+?)",
  // A `\/`: the pattern is split on `/` first
  "*\\/*",
  // A capturing group inside a constraint: it would be a stray param
  "/:foo((?<x>a))",
  "/foo/(bar(?<x>baz))",
  // Unicode param names: rou3 names are ASCII, and a non-ASCII char right
  // after one throws instead of ending it
  "/:café",
  "/:℘",
  "/:㐀",
  "/:𠀀",
  "test/:a𐑐b",
]);

// Known diffs that only apply to routeToRegExp (the router skips relative inputs)
const REGEXP_ONLY_KNOWN_DIFFS = new Set([
  // Relative input — rou3's regex is anchored at `/` (a `:name*` regex makes
  // its leading `/` optional, so `:name* → foobar` agrees)
  ":name+ → foobar [match]",
]);

// Additional known diffs specific to router-based matching.
// These are tests where the tree router behaves differently from routeToRegExp.
const ROUTER_KNOWN_DIFFS = new Set([
  // `(.*)` cross-segment — routeToRegExp matches `bar/baz` (regex `.` spans `/`),
  // but the segment-scoped tree stops at one segment.
  "/foo/(.*) → /foo/bar/baz [match]",
  "/foo/:bar(.*) → /foo/bar/baz [match]",
  // `**` over zero segments — the router reports its capture as `""` (under
  // `_`), URLPattern and routeToRegExp leave it unset
  "/foo/** → /foo [match]",
]);

// Patterns URLPattern rejects (`expected_obj: "error"`) but rou3 accepts.
// Every other rejected pattern must throw a `rou3:` error.
const ACCEPTED_INVALID_PATTERNS = new Set([
  // URLPattern allows only ASCII in a regexp group; rou3 hands it to RegExp
  "(café)",
  // URLPattern compiles groups with the `u` / `v` flag, where `\m` is an
  // invalid escape; rou3 compiles without it, so `\m` is `m`
  "/(\\m)",
]);

const DIFF_SETS = {
  KNOWN_DIFFS,
  REGEXP_ONLY_KNOWN_DIFFS,
  ROUTER_KNOWN_DIFFS,
  RESERVED_PATTERNS,
  ACCEPTED_INVALID_PATTERNS,
};

type MatchStrategy = {
  name: string;
  /** Tree lookups take an absolute path: relative inputs are skipped */
  router?: boolean;
  match: (pattern: string, input: string) => { matched: boolean; params: Record<string, string> };
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
    router: true,
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
    router: true,
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

type Plan =
  | { kind: "skipped"; reason: string }
  | { kind: "throws" | "accepts" | "rejected" | "run" }
  | { kind: "known diff"; set: string };

/** How `strategy` checks `test`; records which diff-set entries are reached */
function planTest(strategy: MatchStrategy, test: PathnameTest, reached: Set<string>): Plan {
  if (test.skip) return { kind: "skipped", reason: test.skip };
  const reach = (set: keyof typeof DIFF_SETS, key: string) =>
    DIFF_SETS[set].has(key) && !!reached.add(`${set}: ${key}`);
  if (test.input === undefined) {
    return { kind: reach("ACCEPTED_INVALID_PATTERNS", test.pattern) ? "accepts" : "throws" };
  }
  if (reach("RESERVED_PATTERNS", test.pattern)) return { kind: "rejected" };
  if (strategy.router && !test.input.startsWith("/")) {
    return { kind: "skipped", reason: "relative input: tree lookups take an absolute path" };
  }
  for (const set of strategy.router
    ? (["KNOWN_DIFFS", "ROUTER_KNOWN_DIFFS"] as const)
    : (["KNOWN_DIFFS", "REGEXP_ONLY_KNOWN_DIFFS"] as const)) {
    if (reach(set, test.label)) return { kind: "known diff", set };
  }
  return { kind: "run" };
}

describe("wpt urlpattern compatibility", () => {
  const { tests, outOfScope } = readPathnameTests();
  const reached = new Set<string>();
  const counts: Record<string, Record<string, number>> = {};

  for (const strategy of strategies) {
    const count = (counts[strategy.name] = {} as Record<string, number>);
    describe(`${strategy.name}`, () => {
      describe("pathname matching", () => {
        for (const test of tests) {
          const plan = planTest(strategy, test, reached);
          const key = plan.kind === "skipped" ? `skipped: ${plan.reason}` : plan.kind;
          count[key] = (count[key] ?? 0) + 1;
          const { label, pattern, input, groups } = test;
          const match = () => {
            const { matched, params } = strategy.match(pattern, encodePathname(input!));
            return matched ? params : null;
          };
          switch (plan.kind) {
            case "skipped": {
              it.skip(`${label} (${plan.reason})`, () => {});
              break;
            }
            case "throws": {
              it(label, () => {
                expect(() => strategy.match(pattern, "/")).toThrow(/^rou3: /);
              });
              break;
            }
            case "accepts": {
              it(`${label} (accepted)`, () => {
                expect(() => strategy.match(pattern, "/")).not.toThrow();
              });
              break;
            }
            case "rejected": {
              it(`${label} (rejected)`, () => {
                expect(() => strategy.match(pattern, input!)).toThrow(/^rou3: /);
              });
              break;
            }
            case "known diff": {
              it(`${label} (${plan.set})`, () => {
                expect(match(), "listed as a known diff but agrees with URLPattern").not.toEqual(
                  groups,
                );
              });
              break;
            }
            default: {
              it(label, () => {
                // `toEqual` treats an unset group like a missing one
                expect(match(), `"${input}" on "${pattern}"`).toEqual(groups);
              });
            }
          }
        }
      });
    });
  }

  it("lists only entries that are in the data", () => {
    const stale = Object.entries(DIFF_SETS).flatMap(([set, entries]) =>
      [...entries].map((entry) => `${set}: ${entry}`).filter((key) => !reached.has(key)),
    );
    expect(stale).toEqual([]);
  });

  it("reads every entry", () => {
    const skipped = [...outOfScope.values()].reduce((a, b) => a + b, 0);
    expect(tests.length + skipped).toBe(testData.length);
    const lines = [`${testData.length} entries, ${tests.length} pathname cases`];
    for (const [reason, n] of outOfScope) lines.push(`  out of scope: ${n} ${reason}`);
    for (const [name, count] of Object.entries(counts)) {
      lines.push(`${name}:`);
      for (const [kind, n] of Object.entries(count).sort()) lines.push(`  ${n} ${kind}`);
    }
    console.info(lines.join("\n"));
  });
});

// Not in the WPT data: a `:name` / `:name+` needs a value, as in URLPattern
// (#229). `[pattern, input, groups]`, `null` for no match; checked against
// the runtime's URLPattern where it has one.
const EMPTY_SEGMENT_CASES: [string, string, Record<string, string> | null][] = [
  ["/foo/:bar", "/foo//", null],
  ["/foo/:bar+", "/foo//", null],
  ["/foo/:bar?", "/foo//", null],
  ["/foo{/:bar}?", "/foo//", null],
  ["/foo/:bar/baz", "/foo//baz", null],
  ["/foo/pre-:bar", "/foo/pre-", null],
  ["/foo/:bar", "/foo/a", { bar: "a" }],
  ["/foo/:bar+", "/foo/a/b", { bar: "a/b" }],
];

// Not in the WPT data: literal pattern text is percent-encoded like URLPattern
// (the URL path percent-encode set as UTF-8, `%` kept, a lone surrogate as
// U+FFFD). `[pattern, raw input, groups]`, `null` for no match; the input is
// encoded with `encodePathname`, checked against the runtime's URLPattern.
const PERCENT_ENCODING_CASES: [string, string, Record<string, string> | null][] = [
  ["/café", "/café", {}],
  ["/caf\\é", "/café", {}],
  ["/café/:id", "/café/1", { id: "1" }],
  ["/café-:id", "/café-1", { id: "1" }],
  ["/:id-café", "/1-café", { id: "1" }],
  ["/x/:id{é}?", "/x/1é", { id: "1" }],
  ["/x-:id-😀", "/x-1-😀", { id: "1" }],
  ["/a b/:id", "/a b/1", { id: "1" }],
  ['/a"b<c>`', '/a"b<c>`', {}],
  ["/a\\#b", "/a#b", {}],
  ["/a\\?b", "/a?b", {}],
  ["/a\\{b\\}", "/a{b}", {}],
  ["/a^b", "/a^b", {}],
  ["/a\x01\x7Fb", "/a\x01\x7Fb", {}],
  ["/a|b[c]'!$&=@;,~", "/a|b[c]'!$&=@;,~", {}],
  ["/caf%C3%A9", "/café", {}],
  ["/caf%c3%a9", "/café", null],
  ["/caf%c3%a9", "/caf%c3%a9", {}],
  ["/100%", "/100%", {}],
  ["/a%zz", "/a%zz", {}],
  ["/a\\%b", "/a%b", {}],
  ["/a\uD800", "/a�", {}],
  ["/:x(%C3%A9)", "/é", { x: "%C3%A9" }],
];

describe("wpt urlpattern compatibility: percent-encoding", () => {
  const URLPatternCtor = (globalThis as { URLPattern?: any }).URLPattern;
  for (const strategy of strategies) {
    for (const [pattern, input, groups] of PERCENT_ENCODING_CASES) {
      it(`${strategy.name}: ${JSON.stringify(pattern)} → ${JSON.stringify(input)}`, () => {
        const { matched, params } = strategy.match(pattern, encodePathname(input));
        expect(matched ? params : null).toEqual(groups);
      });
    }
  }

  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [pattern, input, groups] of PERCENT_ENCODING_CASES) {
      const urlPattern = new URLPatternCtor({ pathname: pattern });
      const result = urlPattern.exec({ pathname: input });
      expect(result ? result.pathname.groups : null, `${pattern} → ${input}`).toEqual(groups);
      // `encodePathname` encodes the input like URLPattern and `new URL()`
      expect(
        new URLPatternCtor({ pathname: input.replace(/[\\:*(){}?+]/g, "\\$&") }).pathname,
      ).toBe(encodePathname(input));
      const url = new URL("http://h");
      url.pathname = input;
      expect(url.pathname).toBe(encodePathname(input));
    }
  });
});

// Where rou3 still differs (see the README): a `:name*` takes an empty segment
// (URLPattern's needs a value in each), and `:name+` / `:name*` / `**` take
// empty segments between others.
const EMPTY_SEGMENT_DIFFS: [string, string, Record<string, string>][] = [
  ["/foo/:bar*", "/foo//", { bar: "" }],
  ["/foo/:bar+", "/foo////", { bar: "//" }],
  ["/foo/:bar+", "/foo//a", { bar: "/a" }],
];

describe("wpt urlpattern compatibility: empty segments", () => {
  const URLPatternCtor = (globalThis as { URLPattern?: any }).URLPattern;
  for (const strategy of strategies) {
    for (const [pattern, input, groups] of EMPTY_SEGMENT_CASES) {
      it(`${strategy.name}: ${pattern} → ${input}`, () => {
        const { matched, params } = strategy.match(pattern, input);
        expect(matched ? params : null).toEqual(groups);
      });
    }
    for (const [pattern, input, groups] of EMPTY_SEGMENT_DIFFS) {
      it(`${strategy.name}: ${pattern} → ${input} (rou3 only)`, () => {
        const { matched, params } = strategy.match(pattern, input);
        expect(matched ? params : null).toEqual(groups);
      });
    }
  }

  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [pattern, input, groups] of EMPTY_SEGMENT_CASES) {
      const result = new URLPatternCtor({ pathname: pattern }).exec({ pathname: input });
      expect(result ? result.pathname.groups : null, `${pattern} → ${input}`).toEqual(groups);
    }
    for (const [pattern, input] of EMPTY_SEGMENT_DIFFS) {
      const result = new URLPatternCtor({ pathname: pattern }).exec({ pathname: input });
      expect(result, `${pattern} → ${input}`).toBeNull();
    }
  });
});
