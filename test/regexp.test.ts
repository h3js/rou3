import { describe, it, expect } from "vitest";
import {
  routeToRegExp,
  createRouter,
  addRoute,
  findRoute,
} from "../src/index.ts";

describe("routeToRegExp", () => {
  const routes = {
    "/path": { regex: /^\/path\/?$/, match: [["/path"], ["/path/"]] },
    "/path/:param": {
      regex: /^\/path\/(?<param>[^/]+)\/?$/,
      match: [
        ["/path/value", { param: "value" }],
        ["/path/value/", { param: "value" }],
      ],
    },
    "/path/get-:file.:ext": {
      regex: /^\/path\/get-(?<file>[^/]+)\.(?<ext>[^/]+)\/?$/,
      match: [["/path/get-file.txt", { file: "file", ext: "txt" }]],
    },
    "/path/:param1/:param2": {
      regex: /^\/path\/(?<param1>[^/]+)\/(?<param2>[^/]+)\/?$/,
      match: [["/path/value1/value2", { param1: "value1", param2: "value2" }]],
    },
    "/path/*/foo": {
      regex: /^\/path\/(?<_0>[^/]*)\/foo\/?$/,
      match: [
        ["/path/anything/foo", { _0: "anything" }],
        ["/path//foo", { _0: "" }],
        ["/path//foo/", { _0: "" }],
      ],
    },
    "/path/**": {
      regex: /^\/path\/?(?<_>.*)\/?$/,
      match: [
        ["/path/", { _: "" }],
        ["/path", { _: "" }],
        ["/path/anything/more", { _: "anything/more" }],
      ],
    },
    "/base/**:path": {
      regex: /^\/base\/?(?<path>.+)\/?$/,
      match: [["/base/anything/more", { path: "anything/more" }]],
    },
    "/static%3Apath/\\*/\\*\\*": {
      regex: /^\/static%3Apath\/\*\/\*\*\/?$/,
      match: [["/static%3Apath/*/**"]],
    },
    "/**": {
      regex: /^\/?(?<_>.*)\/?$/,
      match: [
        ["/", { _: "" }],
        ["/anything", { _: "anything" }],
        ["/any/deep/path", { _: "any/deep/path" }],
      ],
    },
    "/path/:id(\\d+)": {
      regex: /^\/path\/(?<id>\d+)\/?$/,
      match: [["/path/123", { id: "123" }]],
    },
    "/path/:ext(png|jpg|gif)": {
      regex: /^\/path\/(?<ext>png|jpg|gif)\/?$/,
      match: [["/path/png", { ext: "png" }]],
    },
    "/path/:version(v\\d+)/:resource": {
      regex: /^\/path\/(?<version>v\d+)\/(?<resource>[^/]+)\/?$/,
      match: [["/path/v2/users", { version: "v2", resource: "users" }]],
    },
    "/path/:id?": {
      regex: /^\/path\/?(?<id>[^/]+)?\/?$/,
      match: [["/path/123", { id: "123" }], ["/path"]],
    },
    "/path/:id(\\d+)?": {
      regex: /^\/path\/?(?<id>\d+)?\/?$/,
      match: [["/path/123", { id: "123" }], ["/path"]],
    },
    "/path/:rest+": {
      regex: /^\/path\/?(?<rest>.+)\/?$/,
      match: [
        ["/path/a/b", { rest: "a/b" }],
        ["/path/a", { rest: "a" }],
      ],
    },
    "/path/:rest*": {
      regex: /^\/path\/?(?<rest>.*)\/?$/,
      match: [
        ["/path/a/b", { rest: "a/b" }],
        ["/path"],
      ],
    },
    "/path/(\\d+)": {
      regex: /^\/path\/(?<_0>\d+)\/?$/,
      match: [["/path/123", { _0: "123" }]],
    },
    "/path/(png|jpg|gif)": {
      regex: /^\/path\/(?<_0>png|jpg|gif)\/?$/,
      match: [["/path/png", { _0: "png" }]],
    },
  } as const;

  for (const [route, expected] of Object.entries(routes)) {
    it(`should convert route "${route}" to regex "${expected.regex.source}"`, () => {
      const router = createRouter();
      addRoute(router, "", route, { route });

      const regex = routeToRegExp(route);

      for (const [path, params] of expected.match) {
        expect(findRoute(router, "", path)).toMatchObject(
          params
            ? {
                data: { route },
                params,
              }
            : { data: { route } },
        );

        const match = path.match(regex);
        expect(match, path).not.toBeNull();
        if (params) {
          expect(match?.groups).toMatchObject(params);
        }
      }

      expect(regex.source).toBe(expected.regex.source);
    });
  }
});
