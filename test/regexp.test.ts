import { describe, it, expect } from "vitest";
import {
  routeToRegExp,
  createRouter,
  addRoute,
  findRoute,
} from "../src/index.ts";
import { normalizeUnnamedGroupKey } from "../src/_segment-wildcards.ts";

function normalizeGroups(groups?: Record<string, string>) {
  if (!groups) {
    return groups;
  }

  const normalized: Record<string, string> = {};
  for (const key in groups) {
    const normalizedKey = normalizeUnnamedGroupKey(key).replace(/^_(\d+)$/, "$1");
    normalized[normalizedKey] = groups[key];
  }

  return normalized;
}

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
        ["/path/anything/foo", { "0": "anything" }],
        ["/path//foo", { "0": "" }],
        ["/path//foo/", { "0": "" }],
      ],
    },
    "/path/*.png": {
      regex: /^\/path\/(?<_0>[^/]*)\.png\/?$/,
      match: [["/path/icon.png", { "0": "icon" }]],
    },
    "/path/file-*-*.png": {
      regex: /^\/path\/file-(?<_0>[^/]*)-(?<_1>[^/]*)\.png\/?$/,
      match: [["/path/file-a-b.png", { "0": "a", "1": "b" }]],
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
      match: [["/path/a/b", { rest: "a/b" }], ["/path"]],
    },
    "/path/(\\d+)": {
      regex: /^\/path\/(?<_0>\d+)\/?$/,
      match: [["/path/123", { "0": "123" }]],
    },
    "/path/(png|jpg|gif)": {
      regex: /^\/path\/(?<_0>png|jpg|gif)\/?$/,
      match: [["/path/png", { "0": "png" }]],
    },
    "/path/:id(\\d+)+": {
      regex: /^\/path\/?(?<id>\d+(?:\/\d+)*)\/?$/,
      match: [
        ["/path/123", { id: "123" }],
        ["/path/123/456", { id: "123/456" }],
      ],
    },
    "/path/:id(\\d+)*": {
      regex: /^\/path\/?(?<id>\d+(?:\/\d+)*)?\/?$/,
      match: [["/path/123", { id: "123" }], ["/path"]],
    },
    "/book{s}?": {
      regex: /^(?:\/books\/?|\/book\/?)$/,
      match: [["/book"], ["/books"]],
    },
    "/blog/:id(\\d+){-:title}?": {
      regex:
        /^(?:\/blog\/(?<id>\d+)-(?<title>[^/]+)\/?|\/blog\/(?<id>\d+)\/?)$/,
      match: [
        ["/blog/123", { id: "123" }],
        ["/blog/123-my-post", { id: "123", title: "my-post" }],
      ],
    },
    "/foo{/bar}?": {
      regex: /^(?:\/foo\/bar\/?|\/foo\/?)$/,
      match: [["/foo"], ["/foo/bar"]],
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
          expect(normalizeGroups(match?.groups)).toMatchObject(params);
        }
      }

      expect(regex.source).toBe(expected.regex.source);
    });
  }
});
