import { describe, it, expect } from "vitest";
import { regExpToRoute, routeToRegExp } from "../src/index.ts";
import { regexpCases, PCRE2_DUPLICATE_NAME_ROUTES } from "./_regexp-cases.ts";

describe("regExpToRoute", () => {
  // Every fixture route -> regex -> route must round-trip (its regex, converted
  // back, produces a route whose regex is identical). Alternation-fallback
  // routes (PCRE2_DUPLICATE_NAME_ROUTES) are not reversible and excluded.
  for (const [route, { regex }] of Object.entries(regexpCases)) {
    if (PCRE2_DUPLICATE_NAME_ROUTES.has(route)) {
      continue;
    }
    it(`round-trips "${route}"`, () => {
      const back = regExpToRoute(regex);
      expect(routeToRegExp(back).source).toBe(regex.source);
    });
  }

  it("accepts a RegExp or a source string", () => {
    expect(regExpToRoute(/^\/path\/(?<id>\d+)\/?$/)).toBe("/path/:id(\\d+)");
    expect(regExpToRoute("^\\/path\\/(?<id>\\d+)\\/?$")).toBe("/path/:id(\\d+)");
  });

  it("maps the core constructs", () => {
    expect(regExpToRoute(/^\/path\/?$/)).toBe("/path");
    expect(regExpToRoute(/^\/path\/(?<param>[^/]+)\/?$/)).toBe("/path/:param");
    expect(regExpToRoute(/^\/path\/(?<_0>[^/]*)\/foo\/?$/)).toBe("/path/*/foo");
    expect(regExpToRoute(/^\/path\/(?<_0>[^/]*)\.png\/?$/)).toBe("/path/*.png");
    expect(regExpToRoute(/^\/path\/?(?<_>.*)\/?$/)).toBe("/path/**");
    expect(regExpToRoute(/^\/base\/?(?<path>.+)\/?$/)).toBe("/base/**:path");
    expect(regExpToRoute(/^\/path\/(?<id>\d+)\/?$/)).toBe("/path/:id(\\d+)");
    expect(regExpToRoute(/^\/path(?:\/(?<id>[^/]+))?\/?$/)).toBe("/path/:id?");
    expect(regExpToRoute(/^\/path(?:\/(?<rest>.*))?\/?$/)).toBe("/path/:rest*");
    expect(regExpToRoute(/^\/path\/(?<rest>.+)\/?$/)).toBe("/path/:rest+");
  });

  it("re-escapes literal route-syntax characters", () => {
    // A literal `*` in the source must come back escaped so it stays literal.
    expect(regExpToRoute(/^\/static\/\*\/\*\*\/?$/)).toBe("/static/\\*/\\*\\*");
  });

  it("throws on the alternation fallback it cannot reverse", () => {
    const alt = routeToRegExp("/media/*{.webp}?");
    expect(() => regExpToRoute(alt)).toThrow();
  });
});
