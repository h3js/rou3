import { describe, it, expect } from "vitest";
import { routeToRegExp, createRouter, addRoute, findRoute } from "../src/index.ts";
import { compileRouter } from "../src/compiler.ts";
import { fromGroupName } from "../src/_group-names.ts";
import { normalizePath } from "../src/_match.ts";
import { withoutAlias } from "./_utils.ts";
import { DUPLICATE_NAMED_GROUPS, needsDuplicateNames } from "./_regexp-cases.ts";

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

  // The skips below check the exact shape their reason names; anything else
  // fails loudly so a new kind of entry is read on purpose, not skipped
  const unexpected = (what: string) =>
    new Error(`wpt: unexpected ${what} for ${JSON.stringify(entry.pattern)}`);

  if (entry.expected_obj === "error") {
    const test: PathnameTest = { label: `${pattern} (expected error)`, pattern };
    if (typeof options === "string") {
      test.skip = "a base URL next to an init throws in the constructor, the pattern is fine";
    } else if (options !== undefined) {
      throw unexpected(`constructor options ${JSON.stringify(options)}`);
    }
    return test;
  }

  const inputs = entry.inputs ?? [];
  const label = `${pattern} → ${inputs.length > 0 ? JSON.stringify(inputs) : "(no inputs)"}`;
  if (options !== undefined) {
    if (JSON.stringify(options) !== '{"ignoreCase":true}') {
      throw unexpected(`constructor options ${JSON.stringify(options)}`);
    }
    return { label, pattern, skip: "`ignoreCase`: rou3 is always case-sensitive" };
  }
  if (inputs.length === 0) {
    return { label, pattern, skip: "no inputs: checks the canonical pattern string only" };
  }
  if (entry.expected_match === "error") {
    if (inputs.length !== 2 || typeof inputs[0] !== "object" || typeof inputs[1] !== "string") {
      throw unexpected(`exec() error on ${JSON.stringify(inputs)}`);
    }
    return { label, pattern, skip: "exec() throws on its arguments (a base URL next to an init)" };
  }

  const input = readInput(inputs);
  if (typeof input === "string") return { label, pattern, skip: input };

  // WPT's runner defaults a missing component result (`""` with a `"0": ""`
  // capture); no pathname case relies on it, so one that does fails here
  const result: WptResult | null | undefined = entry.expected_match
    ? entry.expected_match.pathname
    : null;
  if (result === undefined) throw unexpected("`expected_match` without a pathname");
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
    // The unnamed-capture rule applies to the raw group name: a param `:_0` is
    // emitted escaped (`__rou3_esc___0`) and decodes to `_0`
    result[/^_\d+$/.test(key) ? key.slice(1) : fromGroupName(key)] = value;
  }
  return result;
}

/**
 * Known semantic differences between rou3 and URLPattern:
 *
 * 1. Trailing slash: rou3 ignores at most one trailing `/`
 * 2. `*` semantics: a greedy catch-all `(.*)` in both (a `(.*)` group is a
 *    `*`, a `:name(.*)` one keyed by name); rou3 allows one catch-all per
 *    route (two `*` are reserved), and a whole-segment `*` ending the route
 *    is optional (`/foo/*` matches `/foo`, no key)
 * 3. Other constraints that can match `/` (`(.+)`): URLPattern matches them
 *    across `/`, and so does `routeToRegExp`, while the tree's are
 *    segment-scoped (no WPT case reaches this)
 * 4. `**` semantics: URLPattern parses `**` as `*` with a `*` modifier (a
 *    catch-all across `/` captured as `"0"`, unset over zero segments); rou3
 *    `**` is a catch-all over whole segments keyed the same way, one per
 *    route (the tree also reports it as `_`, a deprecated alias that the
 *    router strategies check and drop: `withoutAlias`)
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
 * 10. Relative paths: rou3 reads every pattern as absolute (`/`-prefixed;
 *    a leading group per expansion, so `{/:a}?/b` is `/:a?/b` as in
 *    URLPattern, and `{:foo}bar` is `/:foo\bar`, see `LEADING_GROUP_CASES`)
 */

/**
 * The input as URLPattern (and `new URL().pathname`) encodes it: the URL path
 * percent-encode set as UTF-8, `%` kept. Checked against URLPattern below.
 */
function encodePathname(path: string): string {
  return path.replace(/[\0- "#<>?^`{}\x7F-\u{10FFFF}]/gu, (c) => encodeURIComponent(c));
}

/** rou3's result for a case: its groups (an unset one is `undefined`), `null` for no match */
type Result = Record<string, string | undefined> | null;

const SPLIT = Symbol("split");

/** A known diff's results where `routeToRegExp` and the tree also differ from each other */
type Split = { [SPLIT]: true; regexp: Result; router: Result };

const split = (regexp: Result, router: Result): Split => ({ [SPLIT]: true, regexp, router });

const diffs = <T>(entries: Record<string, T>) => new Map(Object.entries(entries));

// Known diffs: tests where rou3 intentionally behaves differently, keyed by
// label (`[match]` / `[no match]` is URLPattern's outcome) with rou3's exact
// result. Each is asserted to differ from URLPattern and to equal the stored
// result, so any change in what rou3 returns fails: update the entry, or drop
// it once rou3 agrees with URLPattern.
const KNOWN_DIFFS = diffs<Result | Split>({
  // Trailing slash after `**`: `/foo/` is `/foo`, zero segments, where the
  // `**` is unset (URLPattern: an empty capture)
  "/foo/** → /foo/ [match]": split({ "0": undefined }, {}),

  // A trailing `*` is optional, as in 0.11 (`use("/api/*")` scopes cover
  // `/api`): no key (URLPattern: no match)
  "/foo/* → /foo [no match]": split({ "0": undefined }, {}),
  // ... and so is a `(.*)` group, a `*`, and a `:name(.*)`, a `*` keyed by
  // name
  "/foo/(.*) → /foo [no match]": split({ "0": undefined }, {}),
  "/foo/:bar(.*) → /foo [no match]": split({ bar: undefined }, {}),

  // Patterns without leading `/` — rou3 prefixes `/` (a leading `{:foo}`
  // group's expansions too), so the regex never matches a relative input
  // (the router skips relative inputs). With a leading `/`, the `{:foo}(…)`
  // ones agree (`GROUP_PARAM_CASES`).
  ":name → foobar [match]": null,
  "(foo)(.*) → foobarbaz [match]": null,
  "{(foo)bar}(.*) → foobarbaz [match]": null,
  "{:foo}(.*) → foobarbaz [match]": null,
  "{:foo}(barbaz) → foobarbaz [match]": null,
  "{:foo}{(.*)} → foobarbaz [match]": null,
  "{:foo}{bar(.*)} → foobarbaz [match]": null,
  "{:foo}:bar(.*) → foobarbaz [match]": null,
  "{:foo}?(.*) → foobarbaz [match]": null,
  "{:foo\\bar} → foobar [match]": null,
  "{:foo\\.bar} → foo.bar [match]": null,
  "{:foo(foo)bar} → foobar [match]": null,
  "{:foo}bar → foobar [match]": null,
  ":foo\\bar → foobar [match]": null,
  ":foo{}(.*) → foobar [match]": null,
  ":foo{}bar → foobar [match]": null,
  ":foo{}?bar → foobar [match]": null,
  ":foo(baz)(.*) → bazbar [match]": null,
  ":foo(baz)bar → bazbar [match]": null,
  ":foo./ → bar./ [match]": null,
  ":foo../ → bar../ [match]": null,
  "./foo → ./foo [match]": null,
  "../foo → ../foo [match]": null,
  "var x = 1; → var x = 1; [match]": null,

  // A relative pattern never matches an absolute path in URLPattern; rou3
  // reads it as absolute
  'foo/bar → /foo/bar (from "https://example.com/foo/bar") [no match]': {},

  // Trailing slash on a no-match case — rou3 ignores one trailing `/`, so
  // `/foo/bar/` is `/foo/bar` (a second one is an empty last segment)
  "/foo/bar → /foo/bar/ [no match]": {},
  "/foo/:bar → /foo/bar/ [no match]": { bar: "bar" },
  "/foo/:bar? → /foo/ [no match]": split({ bar: undefined }, {}),
  "/foo/:bar* → /foo/ [no match]": split({ bar: undefined }, {}),
  "/foo{/bar}? → /foo/ [no match]": {},
});

// Valid URLPattern syntax rou3 has no meaning for (yet): every strategy
// throws a `rou3:` error for these patterns instead of matching with a
// different meaning (modifiers on `*` / an unnamed group, group repetition,
// a `/`, a capturing group or a class set operation in a constraint, a `\/`,
// Unicode param names).
const RESERVED_PATTERNS = new Set([
  // Two catch-alls (`*`, `**`, `:x+`, `:x*`): rou3 allows one per route
  "*/*",
  "*/{*}",
  "*//*",
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
  // `v`-flag set operations: rou3 compiles constraints without the `v` flag,
  // where `--` / `&&` in a class are plain chars
  "/([[a-z]--a])",
  "/([\\d&&[0-1]])",
  // Unicode param names: rou3 names are ASCII, and a non-ASCII char right
  // after one throws instead of ending it
  "/:café",
  "/:℘",
  "/:㐀",
  "/:𠀀",
  "test/:a𐑐b",
]);

// Known diffs that only apply to routeToRegExp (the router skips relative
// inputs), with routeToRegExp's result
const REGEXP_ONLY_KNOWN_DIFFS = diffs<Result>({
  // Relative input — rou3's regex is anchored at `/` (a root `:name*` is
  // `(?:/(?<name>…))?`, like `{/:name+}?`, so it needs the `/` too)
  ":name+ → foobar [match]": null,
  ":name* → foobar [match]": null,
});

// Known diffs that only apply to the tree (routeToRegExp agrees with
// URLPattern), with the tree's result: none since a `(.*)` group is a `*` (a
// constraint that can match `/`, `(.+)`, is segment-scoped in the tree only,
// but no WPT case reaches one)
const ROUTER_KNOWN_DIFFS = diffs<Result>({});

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
  match: (pattern: string, input: string) => { matched: boolean; params: NonNullable<Result> };
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
      return { matched: true, params: withoutAlias(router, result.params) };
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
      return { matched: true, params: withoutAlias(router, result.params) };
    },
  },
];

type Plan =
  | { kind: "skipped"; reason: string }
  | { kind: "throws" | "accepts" | "rejected" | "run" }
  | { kind: "known diff"; set: string; result: Result };

/**
 * URLPattern's groups as `strategy` reports them. The one representation
 * rule modelled: the tree leaves an unset param out of `params` (`/foo/:bar?`
 * on `/foo` is `{}`) where URLPattern and `routeToRegExp` report an unset
 * group as `undefined`, so for the tree an unset URLPattern group ≡ an absent
 * key. Nothing else is normalized (a tree param that is present but
 * `undefined` still differs from an absent one).
 */
function expectedGroups(strategy: MatchStrategy, groups: Result): Result {
  if (!groups || !strategy.router) return groups;
  return Object.fromEntries(Object.entries(groups).filter(([, value]) => value !== undefined));
}

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
    if (!reach(set, test.label)) continue;
    const stored = DIFF_SETS[set].get(test.label)!;
    const result =
      stored && SPLIT in stored ? stored[strategy.router ? "router" : "regexp"] : stored;
    return noDuplicateNames(strategy, test.pattern) ?? { kind: "known diff", set, result };
  }
  return noDuplicateNames(strategy, test.pattern) ?? { kind: "run" };
}

/**
 * Without duplicate named groups (Node 22), `routeToRegExp` throws for a
 * pattern whose regex is an alternation repeating a group (`{:foo}?(.*)`: a
 * `(.*)` is a `*`, so its route and the one without the group each have
 * one): skipped, after its diff-set entry is reached.
 */
function noDuplicateNames(strategy: MatchStrategy, pattern: string): Plan | undefined {
  if (!strategy.router && !DUPLICATE_NAMED_GROUPS && needsDuplicateNames(pattern)) {
    return { kind: "skipped", reason: "needs duplicate named groups (Node 22)" };
  }
}

const URLPatternCtor = (globalThis as { URLPattern?: any }).URLPattern;

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
                const result = match();
                expect(result, "agrees with URLPattern: drop the known diff").not.toStrictEqual(
                  expectedGroups(strategy, groups!),
                );
                expect(result, `rou3's result changed: update ${plan.set}`).toStrictEqual(
                  plan.result,
                );
              });
              break;
            }
            default: {
              it(label, () => {
                expect(match(), `"${input}" on "${pattern}"`).toStrictEqual(
                  expectedGroups(strategy, groups!),
                );
              });
            }
          }
        }
      });
    });
  }

  it("lists only entries that are in the data", () => {
    const stale = Object.entries(DIFF_SETS).flatMap(([set, entries]) =>
      [...entries.keys()].map((entry) => `${set}: ${entry}`).filter((key) => !reached.has(key)),
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

  // The fixture expectations as this harness reads them (the resolved input,
  // `null` read as `undefined`), checked against the runtime's own URLPattern
  // where it has one
  it.runIf(URLPatternCtor)("agrees with the runtime's URLPattern", () => {
    for (const { label, pattern, input, groups, skip } of tests) {
      if (skip) continue;
      if (input === undefined) {
        expect(() => new URLPatternCtor({ pathname: pattern }), label).toThrow(TypeError);
        continue;
      }
      const result = new URLPatternCtor({ pathname: pattern }).exec({ pathname: input });
      expect(result ? { ...result.pathname.groups } : null, label).toStrictEqual(groups);
    }
  });
});

// Not in the WPT data: a `:name` / `:name+` needs a value, as in URLPattern
// (#229), in each segment it takes. `[pattern, input, groups]`, groups as
// URLPattern reports them (see `expectedGroups`), `null` for no match;
// checked against the runtime's URLPattern where it has one.
const EMPTY_SEGMENT_CASES: [string, string, Result][] = [
  ["/foo/:bar", "/foo//", null],
  ["/foo/:bar+", "/foo//", null],
  ["/foo/:bar*", "/foo//", null],
  ["/foo/:bar*/baz", "/foo//baz", null],
  ["/foo/:bar*", "/foo", { bar: undefined }],
  ["/foo/:bar*/baz", "/foo/baz", { bar: undefined }],
  ["/foo/:bar?", "/foo//", null],
  ["/foo{/:bar}?", "/foo//", null],
  ["/foo/:bar/baz", "/foo//baz", null],
  ["/foo/pre-:bar", "/foo/pre-", null],
  ["/foo/:bar", "/foo/a", { bar: "a" }],
  ["/foo/:bar+", "/foo/a/b", { bar: "a/b" }],
  // Every segment a `:name+` / `:name*` takes needs a value (URLPattern's
  // `[^/]+(?:/[^/]+)*`), also before more of the route
  ["/foo/:bar+", "/foo////", null],
  ["/foo/:bar+", "/foo//a", null],
  ["/foo/:bar+", "/foo/a//b", null],
  ["/foo/:bar+", "/foo/a//", null],
  ["/foo/:bar*", "/foo//a", null],
  ["/foo/:bar*", "/foo/a//", null],
  ["/foo/:bar*", "/foo/a//b", null],
  ["/foo/:bar*", "/foo/a/b", { bar: "a/b" }],
  ["/foo/:bar+/baz", "/foo/a//b/baz", null],
  ["/foo/:bar+/baz", "/foo//a/baz", null],
  ["/foo/:bar+/baz", "/foo/a/b/baz", { bar: "a/b" }],
  ["/foo/:bar*/baz", "/foo/a//baz", null],
  ["/foo/:bar*/baz", "/foo/a/b/baz", { bar: "a/b" }],
  ["/:bar+", "/a//b", null],
  ["/:bar*", "//a", null],
];

// Not in the WPT data: literal pattern text is percent-encoded like URLPattern
// (the URL path percent-encode set as UTF-8, `%` kept, a lone surrogate as
// U+FFFD). `[pattern, raw input, groups]` (as for `EMPTY_SEGMENT_CASES`); the input is
// encoded with `encodePathname`, checked against the runtime's URLPattern.
const PERCENT_ENCODING_CASES: [string, string, Result][] = [
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
  // An encoded prefix before a `:name*`, which needs a value or no segment
  ["/café/:x*", "/café", { x: undefined }],
  ["/café/:x*", "/café/a/é", { x: "a/%C3%A9" }],
  ["/café/:x*", "/café//", null],
  // Encoded text around an optional param compiled in place after a capture
  // (its `?` is the modifier, never a literal `%3F`)
  ["/café-*-:x?", "/café-a-b", { "0": "a", x: "b" }],
  ["/café-*-:x?", "/café-a-", { "0": "a", x: undefined }],
  ["/café-*-:x?", "/café---", { "0": "-", x: undefined }],
  ["/*-é-:x?", "/a-é-b", { "0": "a", x: "b" }],
  ["/*-é-:x?", "/a-é-", { "0": "a", x: undefined }],
  ["/a\\?*-:x?", "/a?b-c", { "0": "b", x: "c" }],
  ["/a\\?*-:x?", "/a?b-", { "0": "b", x: undefined }],
  ["/:a(\\d+)é:b?", "/12é", { a: "12", b: undefined }],
  ["/:a(\\d+)é:b?", "/12é3", { a: "12", b: "3" }],
];

describe("wpt urlpattern compatibility: percent-encoding", () => {
  for (const strategy of strategies) {
    for (const [pattern, input, groups] of PERCENT_ENCODING_CASES) {
      it(`${strategy.name}: ${JSON.stringify(pattern)} → ${JSON.stringify(input)}`, () => {
        const { matched, params } = strategy.match(pattern, encodePathname(input));
        expect(matched ? params : null).toStrictEqual(expectedGroups(strategy, groups));
      });
    }
  }

  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [pattern, input, groups] of PERCENT_ENCODING_CASES) {
      const urlPattern = new URLPatternCtor({ pathname: pattern });
      const result = urlPattern.exec({ pathname: input });
      expect(result ? { ...result.pathname.groups } : null, `${pattern} → ${input}`).toStrictEqual(
        groups,
      );
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

// Not in the WPT data: URLPattern drops a tab / LF / CR from a pathname
// pattern outside a regexp group (URL parsing; kept in a group, where no
// pathname has it), so `/a\tb` matches `/ab`. rou3 throws instead of matching
// something else: `[pattern, URLPattern's canonical pathname]`.
const TAB_NEWLINE_PATTERNS: [string, string][] = [
  ["/a\tb", "/ab"],
  ["/a\nb", "/ab"],
  ["/a\rb", "/ab"],
  ["/a/\n:id", "/a/{:id}"],
  ["/:x(a\tb)", "/:x(a\tb)"],
];

describe("wpt urlpattern compatibility: tab / LF / CR", () => {
  for (const strategy of strategies) {
    for (const [pattern] of TAB_NEWLINE_PATTERNS) {
      it(`${strategy.name}: ${JSON.stringify(pattern)} throws`, () => {
        expect(() => strategy.match(pattern, "/ab")).toThrow(/^rou3: a tab, LF, CR /);
      });
    }
  }

  it.runIf(URLPatternCtor)("URLPattern drops them outside a group", () => {
    for (const [pattern, canonical] of TAB_NEWLINE_PATTERNS) {
      expect(new URLPatternCtor({ pathname: pattern }).pathname, pattern).toBe(canonical);
    }
  });
});

// Not in the WPT data (only as `expected_obj`: `/:foo\bar` is `{/:foo}bar`):
// a pattern starting with a `{/…}` group is absolute, so it gets no `/` in
// front (`{/:a}?/b` is `/:a?/b`, never `//b`). `[pattern, input, groups]` (as
// for `EMPTY_SEGMENT_CASES`), checked against the runtime's URLPattern.
const LEADING_GROUP_CASES: [string, string, Result][] = [
  ["{/:a}?/b", "/b", { a: undefined }],
  ["{/:a}?/b", "/x/b", { a: "x" }],
  ["{/:a}?/b", "//b", null],
  ["{/:a}?/b", "//x/b", null],
  ["{/:a}/b", "/x/b", { a: "x" }],
  ["{/:a}/b", "//x/b", null],
  ["{/:a}?", "/x", { a: "x" }],
  ["{/:a}?", "//x", null],
  ["{/:foo}bar", "/bazbar", { foo: "baz" }],
  ["{/:a(\\d+)}?/b", "/1/b", { a: "1" }],
  ["{/:a(\\d+)}?/b", "/b", { a: undefined }],
  ["{/:a(\\d+)}?/b", "/x/b", null],
  ["{/a/:b}?", "/a/x", { b: "x" }],
  ["{/a/:b}?", "//a/x", null],
  ["{/a}b", "/ab", {}],
  ["{/}a", "/a", {}],
  ["{}/a", "/a", {}],
  ["{}/a", "//a", null],
  ["{/a}?{/:b}?/c", "/c", { b: undefined }],
  ["{/a}?{/:b}?/c", "/a/c", { b: undefined }],
  ["{/a}?{/:b}?/c", "/x/c", { b: "x" }],
  ["{/a}?{/:b}?/c", "/a/x/c", { b: "x" }],
  ["{/a}?{/:b}?/c", "//c", null],
  ["{a}?/b", "/b", {}],
  ["{a}?/b", "//b", null],
  ["{:x}?/b", "/b", { x: undefined }],
  ["{:x}?/b", "//b", null],
  // With a regex group after the param's group (`joinGroup`), a `{:x}?`
  // rewrite after text, and unnamed numbering over the whole pattern
  ["{/:foo}(\\d+)", "/a12", { foo: "a", "0": "12" }],
  ["{/:foo}(\\d+)", "/a", null],
  ["{/a}/*-{:x}?", "/a/b-c", { "0": "b", x: "c" }],
  ["{/a}/*-{:x}?", "/a/--", { "0": "-", x: undefined }],
  ["{/a}?/*-{:x}?", "/b-c", { "0": "b", x: "c" }],
  ["{/a}?/*-{:x}?", "/a/b-", { "0": "b", x: undefined }],
  ["{/(\\d+)}?/*", "/b", { "0": undefined, "1": "b" }],
  ["{/(\\d+)}?/*", "/1/b", { "0": "1", "1": "b" }],
];

// Where rou3 differs: an expansion that does not start with `/` is relative
// and gets one, as a relative pattern does (URLPattern never matches it on an
// absolute path), and `{/:a}?` matches `/` like `/:a?` (URLPattern matches
// the empty pathname instead, which rou3 reads as `/`). `[pattern, input, rou3's params]`.
const LEADING_GROUP_DIFFS: [string, string, Record<string, string>][] = [
  ["{/:a}?", "/", {}],
  ["{a}/b", "/a/b", {}],
  ["{:x}/b", "/y/b", { x: "y" }],
  ["{a}?/b", "/a/b", {}],
  ["{:x}?/b", "/y/b", { x: "y" }],
  // Each expansion gets its `/`, also the one `inlineOptionalGroup` reads
  // without the group (`{:x}?(\d+)` is `/:x…(\d+)` or `/(\d+)`)
  ["{:foo}(\\d+)", "/a12", { foo: "a", "0": "12" }],
  ["{:x}?(\\d+)", "/a12", { x: "a", "0": "12" }],
  ["{:x}?(\\d+)", "/12", { x: "1", "0": "2" }],
  ["{:x}?(\\d+)", "/1", { "0": "1" }],
];

describe("wpt urlpattern compatibility: leading groups", () => {
  for (const strategy of strategies) {
    for (const [pattern, input, groups] of LEADING_GROUP_CASES) {
      // An alternation fallback (`{/a}?{/:b}?/c`) needs duplicate named groups (not Node 22)
      const skip = !strategy.router && needsDuplicateNames(pattern);
      it.skipIf(skip)(`${strategy.name}: ${pattern} → ${input}`, () => {
        const { matched, params } = strategy.match(pattern, input);
        expect(matched ? params : null).toStrictEqual(expectedGroups(strategy, groups));
      });
    }
    for (const [pattern, input, params] of LEADING_GROUP_DIFFS) {
      it(`${strategy.name}: ${pattern} → ${input} (rou3 only)`, () => {
        const result = strategy.match(pattern, input);
        expect(result.matched).toBe(true);
        // `routeToRegExp` reports an unset group as `undefined`
        expect(expectedGroups({ ...strategy, router: true }, result.params)).toStrictEqual(params);
      });
    }
  }

  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [pattern, input, groups] of LEADING_GROUP_CASES) {
      const result = new URLPatternCtor({ pathname: pattern }).exec({ pathname: input });
      expect(result ? { ...result.pathname.groups } : null, `${pattern} → ${input}`).toStrictEqual(
        groups,
      );
    }
    for (const [pattern, input] of LEADING_GROUP_DIFFS) {
      const result = new URLPatternCtor({ pathname: pattern }).exec({ pathname: input });
      expect(result, `${pattern} → ${input}`).toBeNull();
    }
  });
});

// Not in the WPT data with a leading `/` (only the relative `{:foo}(.*)`
// forms, see `KNOWN_DIFFS`): a regex group right after a `{…}` group that
// ends in a param is an unnamed capture next to it, not its constraint.
// Single-segment inputs, so the tree's segment-scoped `(.*)` agrees.
// `[pattern, input, groups]` (as for `EMPTY_SEGMENT_CASES`).
const GROUP_PARAM_CASES: [string, string, Result][] = [
  ["/{:foo}(.*)", "/foobarbaz", { foo: "f", "0": "oobarbaz" }],
  ["/{:foo}(.*)", "/f", { foo: "f", "0": "" }],
  ["/{:foo}(barbaz)", "/foobarbaz", { foo: "foo", "0": "barbaz" }],
  ["/{:foo}(barbaz)", "/barbaz", null],
  ["/{:foo}{(.*)}", "/foobarbaz", { foo: "f", "0": "oobarbaz" }],
  ["/{:foo}{bar(.*)}", "/foobarbaz", { foo: "foo", "0": "baz" }],
  ["/{:foo}:bar(.*)", "/foobarbaz", { foo: "f", bar: "oobarbaz" }],
  ["/{:foo}?(.*)", "/foobarbaz", { foo: "f", "0": "oobarbaz" }],
  ["/:foo{}(.*)", "/foobarbaz", { foo: "f", "0": "oobarbaz" }],
  ["/:foo{}(.*)", "/foobar", { foo: "f", "0": "oobar" }],
  ["/{:foo(\\d+)}(.*)", "/123abc", { foo: "123", "0": "abc" }],
  ["/:foo{(x)}?", "/abcx", { foo: "abc", "0": "x" }],
  ["/:foo{(x)}?", "/x", { foo: "x", "0": undefined }],
  // A stray `)` is a literal, no group a `*` would modify
  ["/a){*}", "/a)x", { "0": "x" }],
  // An optional group in the middle of its segment (not inlined)
  ["/a{b}?c", "/abc", {}],
  ["/a{b}?c", "/ac", {}],
  ["/a{b}?c", "/abbc", null],
];

// URLPattern syntax of the same shape with a `*` or a modifier after the
// group: rou3 throws instead of reading it as a modifier on the param.
const GROUP_PARAM_RESERVED = [
  "/{:foo}{*}",
  "/{:foo}?*",
  "/:foo{}?*",
  "/{:foo}(x)?",
  // ... and after a `*` (two wildcards in URLPattern, a `**` once joined)
  "/{*}{*}",
  "/*{*}",
];

describe("wpt urlpattern compatibility: a regex group after a param's group", () => {
  for (const strategy of strategies) {
    for (const [pattern, input, groups] of GROUP_PARAM_CASES) {
      // Without duplicate named groups (Node 22) an alternation regex throws
      // (`/{:foo}?(.*)`)
      it.skipIf(!strategy.router && !DUPLICATE_NAMED_GROUPS && needsDuplicateNames(pattern))(
        `${strategy.name}: ${pattern} → ${input}`,
        () => {
          const { matched, params } = strategy.match(pattern, input);
          expect(matched ? params : null).toStrictEqual(expectedGroups(strategy, groups));
        },
      );
    }
    it.each(GROUP_PARAM_RESERVED)(`${strategy.name}: %s throws`, (pattern) => {
      expect(() => strategy.match(pattern, "/")).toThrow(/^rou3: /);
    });
  }

  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [pattern, input, groups] of GROUP_PARAM_CASES) {
      const result = new URLPatternCtor({ pathname: pattern }).exec({ pathname: input });
      expect(result ? { ...result.pathname.groups } : null, `${pattern} → ${input}`).toStrictEqual(
        groups,
      );
    }
    for (const pattern of GROUP_PARAM_RESERVED) {
      expect(() => new URLPatternCtor({ pathname: pattern }), pattern).not.toThrow();
    }
  });
});

describe("wpt urlpattern compatibility: empty segments", () => {
  for (const strategy of strategies) {
    for (const [pattern, input, groups] of EMPTY_SEGMENT_CASES) {
      it(`${strategy.name}: ${pattern} → ${input}`, () => {
        const { matched, params } = strategy.match(pattern, input);
        expect(matched ? params : null).toStrictEqual(expectedGroups(strategy, groups));
      });
    }
  }

  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [pattern, input, groups] of EMPTY_SEGMENT_CASES) {
      const result = new URLPatternCtor({ pathname: pattern }).exec({ pathname: input });
      expect(result ? { ...result.pathname.groups } : null, `${pattern} → ${input}`).toStrictEqual(
        groups,
      );
    }
  });
});

// Not in the WPT data: unnamed captures (`*`, `**`, unnamed groups) are
// numbered over the whole pattern, a left-out optional group's included, and
// a param named like one (`:_0`) stays a param. `[pattern, input, groups]`.
const UNNAMED_CAPTURE_CASES: [string, string, Result][] = [
  ["/:_0", "/x", { _0: "x" }],
  ["/:_0/*", "/x/y", { _0: "x", "0": "y" }],
  ["/a{/(\\d+)}?/**", "/a/x/y", { "0": undefined, "1": "x/y" }],
  ["/a{/(\\d+)}?/**", "/a/1/y", { "0": "1", "1": "y" }],
  ["/x{(\\d+)}?/*", "/x/b", { "0": undefined, "1": "b" }],
  ["/a{/*}?/(\\d+)", "/a/1", { "0": undefined, "1": "1" }],
  ["/(\\d+)/**", "/1/b/c", { "0": "1", "1": "b/c" }],
  // A regex group after a param's group is an unnamed capture (see
  // `GROUP_PARAM_CASES`); left out, it still uses up its number, so the `*`
  // after it is `1` in both expansions (`skipGroup` joins it like the router)
  ["/:a{(\\d+)}?/*", "/x1/b", { a: "x", "0": "1", "1": "b" }],
  ["/:a{(\\d+)}?/*", "/x/b", { a: "x", "0": undefined, "1": "b" }],
  ["/:a{(\\d+)}?/**", "/x/b/c", { a: "x", "0": undefined, "1": "b/c" }],
  ["/:a{(\\d+)}?/*.png", "/x/b.png", { a: "x", "0": undefined, "1": "b" }],
  ["/{:foo}?(\\d+)/*", "/a1/b", { foo: "a", "0": "1", "1": "b" }],
  ["/{:foo}?(\\d+)/*", "/1/b", { foo: undefined, "0": "1", "1": "b" }],
];

describe("wpt urlpattern compatibility: unnamed captures", () => {
  for (const strategy of strategies) {
    for (const [pattern, input, groups] of UNNAMED_CAPTURE_CASES) {
      // Without duplicate named groups (Node 22) an alternation regex throws
      const skip =
        strategy.name === "routeToRegExp" &&
        !DUPLICATE_NAMED_GROUPS &&
        needsDuplicateNames(pattern);
      it.skipIf(skip)(`${strategy.name}: ${pattern} → ${input}`, () => {
        const { matched, params } = strategy.match(pattern, input);
        expect(matched ? params : null).toStrictEqual(expectedGroups(strategy, groups));
      });
    }
  }

  it.runIf(URLPatternCtor)("agrees with URLPattern", () => {
    for (const [pattern, input, groups] of UNNAMED_CAPTURE_CASES) {
      const result = new URLPatternCtor({ pathname: pattern }).exec({ pathname: input });
      expect(result ? { ...result.pathname.groups } : null, `${pattern} → ${input}`).toStrictEqual(
        groups,
      );
    }
  });
});
