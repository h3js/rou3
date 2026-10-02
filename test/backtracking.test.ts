import { describe, expect, it } from "vitest";
import { addRoute, createRouter, findRoute } from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";
import { getParamRegexp } from "../src/operations/add.ts";
import { encodeEscapes } from "../src/operations/_utils.ts";
import { linearRegExp } from "../src/operations/_linear.ts";

// Several captures in one segment (`:year-:month-:day.html`) used to try
// every split of a segment that doesn't match: cubic in its length with three
// lazy params (a 4KB path took seconds). The tree matches them in linear time
// (`linearRegExp`), in every matcher.

// eslint-disable-next-line no-new-func
const evalAOT = (code: string) => new Function(`return ${code}`)();

// [route, path prefix up to the segment]
const ROUTES: [string, string][] = [
  ["/blog/:year-:month-:day.html", "/blog/"],
  ["/pkg/:name-:version.tgz", "/pkg/"],
  ["/img/:w-:h.:ext", "/img/"],
  ["/:a.:b.:c.json", "/"],
  ["/blog/:id(\\d+)-:slug-:x", "/blog/"],
  ["/**/:a-:b-:c.json", "/x/"],
  ["/c/:a:b:c.json", "/c/"],
  ["/d/:a--:b--:c.html", "/d/"],
  ["/o/:a-:b-:c?", "/o/"],
  ["/f/*-:a.x", "/f/"],
  ["/g/*-:a-:b.x", "/g/"],
  ["/h/*.:a--:b.x", "/h/"],
  ["/i/:a-*-:b.json", "/i/"],
  ["/j/pre-*-:a-:b.tgz", "/j/"],
  ["/k/:a-:b-(\\d+)", "/k/"],
];

// Segment bodies of about `SIZE` chars, each with a few endings
const SIZE = 30_000;
const UNITS = ["-", ".", "a", "1", "-a", "-.", "a-", "--y", ".a", "-y", "1-"];
const ENDINGS = ["", "!", "x", ".x", ".tgz", ".json", ".html", "-", "."];

describe("several captures in one segment match in linear time", () => {
  for (const [route, prefix] of ROUTES) {
    it(route, () => {
      const router = createRouter<string>();
      addRoute(router, "GET", route, route);
      const matchers: [string, (path: string) => unknown][] = [
        ["findRoute", (p) => findRoute(router, "GET", p)],
        [
          "compileRouter",
          (
            (m) => (p: string) =>
              m("GET", p)
          )(compileRouter(router)),
        ],
        [
          "compileRouterToString",
          (
            (m) => (p: string) =>
              m("GET", p)
          )(evalAOT(compileRouterToString(router))),
        ],
      ];
      let slowest = 0;
      for (const unit of UNITS) {
        const body = unit.repeat(SIZE / unit.length);
        for (const ending of ENDINGS) {
          const path = prefix + body + ending;
          for (const [, match] of matchers) {
            const start = performance.now();
            match(path);
            slowest = Math.max(slowest, performance.now() - start);
          }
        }
      }
      // Linear: well under a millisecond per lookup; the old regexes took
      // seconds (cubic) or tens of milliseconds (quadratic) at this size
      expect(slowest).toBeLessThan(200);
    });
  }
});

// The rewritten regex against `getParamRegexp`'s (the reference, also what
// `routeToRegExp` emits): same match, same groups, on every short string
describe("linearRegExp keeps getParamRegexp's matches and captures (sweep)", () => {
  const SEGMENTS = [
    ":a-:b",
    ":a-:b-:c",
    ":a-:b.x",
    ":a.:b.:c.x",
    ":a-:b.:c",
    ":a:b",
    ":a:b.x",
    ":a:b:c",
    ":a:b?",
    ":a-:b?",
    ":a-:b-:c?",
    ":a--:b",
    ":a--:b--:c.x",
    ":a-a-:b",
    ":a-aa-:b.a",
    ":a.a.:b-:c",
    ":a-:b-:c-:d",
    "x:a-:b-x",
    ":a-*",
    "*-:a",
    "*-:a.x",
    "*-:a-:b.x",
    "*.:a-:b.x",
    "*:a.x",
    "*:a:b",
    "*-:a--:b.x",
    "*-:a-:b?",
    "*-:x?",
    "*.:a.:b",
    ":a-*-:b.x",
    ":a-:b-*",
    "a*-:b",
    "a*-:b-:c",
    ":id(\\d+)-:slug-:x",
    ":a(\\d+):b:c.x",
    ":a-:b-(\\d+)",
    ":a-(\\d+)-:b.x",
    ":a-:b(\\d+)",
    ":a-:b(\\d+)?",
    ":a.:b(x|a)",
    "(\\d+)-:a-:b",
    ":a-(x)-:b-:c",
  ];
  const ALPHABET = ["a", "x", "-", ".", "1"];
  const strings: string[] = [""];
  for (let n = 1, layer = [""]; n <= 6; n++) {
    layer = layer.flatMap((s) => ALPHABET.map((c) => s + c));
    strings.push(...layer);
  }

  for (const segment of SEGMENTS) {
    it(segment, () => {
      const [reference] = getParamRegexp(encodeEscapes(segment), 0, [], segment);
      const linear = linearRegExp(reference);
      let differ = 0;
      for (const s of strings) {
        const a = reference.exec(s)?.groups;
        const b = linear.exec(s)?.groups;
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          differ++;
          expect({ s, groups: b }).toEqual({ s, groups: a });
        }
      }
      expect(differ).toBe(0);
    });
  }

  it("rewrites only segments that can backtrack over their text", () => {
    const linear = (segment: string) =>
      linearRegExp(getParamRegexp(encodeEscapes(segment), 0, [], segment)[0]).source;
    expect(linear(":year-:month-:day.html")).toBe(
      "^(?<year>[^/][^/-]*)-(?<month>[^/][^/-]*)-(?<day>[^/]+?)\\.html$",
    );
    expect(linear(":a--:b.x")).toBe("^(?<a>[^/](?:(?!--)[^/])*)--(?<b>[^/]+?)\\.x$");
    expect(linear(":a:b.x")).toBe("^(?<a>[^/])(?<b>[^/]+?)\\.x$");
    expect(linear("*-:a.x")).toBe(
      "^(?=[^/]*$(?<=(-[^/-]*[^/]\\.x)))(?<__rou3_unnamed_0>[^/]*)(?=\\1$)-(?<a>[^/]+?)\\.x$",
    );
    // Nothing to gain: left as `getParamRegexp` built them
    expect(linear("pre-:x.json")).toBe("^pre-(?<x>[^/]+?)\\.json$");
    expect(linear("*.json")).toBe("^(?<__rou3_unnamed_0>[^/]*)\\.json$");
    expect(linear(":id(\\d+).json")).toBe("^(?<id>\\d+)\\.json$");
    expect(linear(":a-:b(\\d+)")).toBe("^(?<a>[^/]+?)-(?<b>\\d+)$");
  });
});

describe("several captures in one segment: lazy params on tricky values", () => {
  const router = createRouter<string>();
  for (const route of [
    "/blog/:year-:month-:day.html",
    "/pkg/:name-:version.tgz",
    "/d/:a--:b.x",
    "/c/:a:b:c",
    "/o/:a-:b-:c?",
    "/g/*-:a-:b.x",
    "/h/*.:a--:b.x",
  ]) {
    addRoute(router, "GET", route, route);
  }
  const jit = compileRouter(router);
  const aot = evalAOT(compileRouterToString(router));
  // Expected values are URLPattern's (and `routeToRegExp`'s)
  const cases: [string, Record<string, string> | undefined][] = [
    // Repeated separators: each param takes one char or more, the first ones
    // as few as they can
    ["/blog/-----.html", { year: "-", month: "-", day: "-" }],
    ["/blog/----.html", undefined],
    ["/blog/2024-01-02.html", { year: "2024", month: "01", day: "02" }],
    ["/blog/2024-01-02-03.html", { year: "2024", month: "01", day: "02-03" }],
    ["/blog/a--b-c.html", { year: "a", month: "-b", day: "c" }],
    ["/blog/a-b.html", undefined],
    ["/d/a---b.x", { a: "a", b: "-b" }],
    ["/d/----.x", { a: "-", b: "-" }],
    ["/d/---.x", undefined],
    ["/c/xyz", { a: "x", b: "y", c: "z" }],
    ["/c/xy", undefined],
    ["/o/----", { a: "-", b: "-" }],
    ["/o/---", undefined],
    // Separators inside the values
    ["/blog/a.html-b-c.html", { year: "a.html", month: "b", day: "c" }],
    ["/pkg/my-lib-1.0.0.tgz", { name: "my", version: "lib-1.0.0" }],
    ["/pkg/a-.tgz.tgz", { name: "a", version: ".tgz" }],
    ["/pkg/-a-b.tgz", { name: "-a", version: "b" }],
    ["/pkg/--.tgz", undefined],
    ["/o/a-b-", { a: "a", b: "b" }],
    ["/o/a-b-c-d", { a: "a", b: "b", c: "c-d" }],
    // A `*` before them stays greedy
    ["/g/x-1-2-3.x", { "0": "x-1", a: "2", b: "3" }],
    ["/g/---.x", undefined],
    ["/g/----.x", { "0": "", a: "-", b: "-" }],
    ["/g/-----.x", { "0": "-", a: "-", b: "-" }],
    ["/h/x.1.2--3--4.x", { "0": "x.1", a: "2", b: "3--4" }],
    ["/h/.a--b.x", { "0": "", a: "a", b: "b" }],
    ["/h/a.b.c---d.x", { "0": "a.b", a: "c", b: "-d" }],
  ];
  const plain = (r: any) => r && { ...r.params };
  it.each(cases)("%s", (path, params) => {
    expect(plain(findRoute(router, "GET", path))).toEqual(params);
    expect(plain(jit("GET", path))).toEqual(params);
    expect(plain(aot("GET", path))).toEqual(params);
  });
});
