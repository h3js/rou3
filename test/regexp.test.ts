import { describe, it, expect } from "vitest";
import { routeToRegExp } from "../src/index.ts";

describe("routeToRegExp", () => {
  const cases = {
    "/path": { regex: /^\/path\/?$/, match: ["/path"] },
    "/path/:param": {
      regex: /^\/path\/(?<param>[^/]+)\/?$/,
      match: ["/path/value"],
    },
    "/path/get-:file:ext.txt": {
      regex: /^\/path\/get-(?<file>[^/]+)(?<ext>[^/]+)\.txt\/?$/,
      match: ["/path/get-file.ext.txt"],
    },
    "/path/:param1/:param2": {
      regex: /^\/path\/(?<param1>[^/]+)\/(?<param2>[^/]+)\/?$/,
      match: ["/path/value1/value2"],
    },
    "/path/*/foo": {
      regex: /^\/path\/[^/]*\/foo\/?$/,
      match: ["/path/anything/foo"],
    },
    "/path/**": { regex: /^\/path\/.*\/?$/, match: ["/path/anything/more"] },
  };
  for (const [route, expected] of Object.entries(cases)) {
    it(`should convert route "${route}" to regex "${expected.regex.source}"`, () => {
      const regex = routeToRegExp(route);
      expect(regex.source).toBe(expected.regex.source);
      for (const match of expected.match) {
        expect(regex.test(match), `Matches ${match}`).toBe(true);
      }
    });
  }
});
