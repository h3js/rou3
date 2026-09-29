import { describe, expectTypeOf, it } from "vitest";
import { createRouter, routeNodeKeys } from "../src/index.ts";
import type { InferRouteParams, MatchedRoute } from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";
import type {
  CompiledMatch,
  CompiledMatchAll,
  CompileRouterOptions,
  CompileRouterToStringOptions,
  RouterCompilerOptions,
} from "../src/compiler.ts";

describe("types", () => {
  describe("routeNodeKeys", () => {
    it("returns a string array", () => {
      expectTypeOf(routeNodeKeys("/a")).toEqualTypeOf<string[]>();
    });
  });

  describe("infer route params", () => {
    it("should infer params from path", () => {
      type Params = InferRouteParams<"/test/:id/:name">;
      type Expected = { id: string; name: string };
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
    });

    it("should be empty for static paths", () => {
      type Params = InferRouteParams<"/test/static">;
      // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      type Expected = {};
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
    });

    it("should infer wildcard params", () => {
      type Params = InferRouteParams<"/test/*">;
      type Expected = { "0": string | undefined };
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
      expectTypeOf<InferRouteParams<"/test/*/">>().toEqualTypeOf<Expected>();
      // the generic (non-inferred) params type stays narrow
      expectTypeOf<NonNullable<MatchedRoute["params"]>>().toEqualTypeOf<Record<string, string>>();
    });

    it("should infer multiple wildcard params", () => {
      type Params = InferRouteParams<"/test/*/foo/*/bar">;
      type Expected = { "0": string; "1": string };
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
      expectTypeOf<InferRouteParams<"/file-*-*">>().toEqualTypeOf<Expected>();
      expectTypeOf<InferRouteParams<"/test/*/foo/*">>().toEqualTypeOf<{
        "0": string;
        "1": string | undefined;
      }>();
    });

    it("should strip regex constraints and modifiers from param names", () => {
      expectTypeOf<InferRouteParams<"/test/:id(\\d+)">>().toEqualTypeOf<{ id: string }>();
      expectTypeOf<InferRouteParams<"/test/:id+">>().toEqualTypeOf<{ id: string }>();
    });

    it("should infer optional params as possibly undefined", () => {
      type Optional = { id: string | undefined };
      expectTypeOf<InferRouteParams<"/test/:id?">>().toEqualTypeOf<Optional>();
      expectTypeOf<InferRouteParams<"/test/:id*">>().toEqualTypeOf<Optional>();
      expectTypeOf<InferRouteParams<"/test/:id(\\d+)?">>().toEqualTypeOf<Optional>();
      expectTypeOf<InferRouteParams<"/test/:id?/x">>().toEqualTypeOf<Optional>();
      // a modifier `*` is not a wildcard capture; a real trailing `*` still is
      expectTypeOf<InferRouteParams<"/test/:id*/x/*">>().toEqualTypeOf<{
        id: string | undefined;
        "0": string | undefined;
      }>();
      expectTypeOf<InferRouteParams<"/test/:a/:b?/*/**:rest">>().toEqualTypeOf<{
        a: string;
        b: string | undefined;
        "0": string;
        rest: string;
      }>();
    });

    it("should handle catch-all wildcard", () => {
      type Params = InferRouteParams<"/test/**">;
      type Expected = { _: string };
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
    });

    it("should handle named wildcard", () => {
      type Params = InferRouteParams<"/test/**:id">;
      type Expected = { id: string };
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
    });

    it("should handle segments after a wildcard", () => {
      expectTypeOf<InferRouteParams<"/**/_payload.json">>().toEqualTypeOf<{ _: string }>();
      expectTypeOf<InferRouteParams<"/blog/**:path/_payload.json">>().toEqualTypeOf<{
        path: string;
      }>();
      expectTypeOf<InferRouteParams<"/**/*.png">>().toEqualTypeOf<{ _: string; "0": string }>();
      expectTypeOf<InferRouteParams<"/*/**/:file/*">>().toEqualTypeOf<{
        "0": string;
        _: string;
        file: string;
        "1": string;
      }>();
      expectTypeOf<InferRouteParams<"/**:p/:f(.*)">>().toEqualTypeOf<{ p: string; f: string }>();
      // `**<rest>` is `**/*<rest>`
      expectTypeOf<InferRouteParams<"/**.md">>().toEqualTypeOf<{ _: string; "0": string }>();
      expectTypeOf<InferRouteParams<"/docs/*/**.md">>().toEqualTypeOf<{
        "0": string;
        _: string;
        "1": string;
      }>();
      // `:x+` before the last segment is a `**`: a `*` after it takes a segment
      expectTypeOf<InferRouteParams<"/a/:x+/b/*">>().toEqualTypeOf<{ x: string; "0": string }>();
      // ... but a static segment ending in `+` is not one
      expectTypeOf<InferRouteParams<"/c++/*">>().toEqualTypeOf<{ "0": string | undefined }>();
      // A `}` right after `**` closes a group: no `*` capture follows
      expectTypeOf<InferRouteParams<"/a{/**}?">>().toEqualTypeOf<{ _: string }>();
      expectTypeOf<InferRouteParams<"/a{/**}?/b">>().toEqualTypeOf<{ _: string }>();
    });

    it("should end param names at a `-`", () => {
      expectTypeOf<InferRouteParams<"/blog/:year-:month">>().toEqualTypeOf<{
        year: string;
        month: string;
      }>();
      expectTypeOf<InferRouteParams<"/a/:x-">>().toEqualTypeOf<{ x: string }>();
      expectTypeOf<InferRouteParams<"/a/:test-id/b">>().toEqualTypeOf<{ test: string }>();
      expectTypeOf<InferRouteParams<"/a/:test\\-id/b">>().toEqualTypeOf<{ test: string }>();
      expectTypeOf<InferRouteParams<"/a/:name-suffix">>().toEqualTypeOf<{ name: string }>();
      expectTypeOf<InferRouteParams<"/a/:a-b.:a_b">>().toEqualTypeOf<{ a: string; a_b: string }>();
      expectTypeOf<InferRouteParams<"/a/:v2/:_0">>().toEqualTypeOf<{ v2: string; _0: string }>();
      // The `:` of a `(?:…)` group is no param
      expectTypeOf<keyof InferRouteParams<"/((?:a|b))">>().toEqualTypeOf<never>();
      expectTypeOf<InferRouteParams<"/x/:id((?:a|b)c)">>().toEqualTypeOf<{ id: string }>();
      expectTypeOf<InferRouteParams<"/a/get-:file.:ext">>().toEqualTypeOf<{
        file: string;
        ext: string;
      }>();
      expectTypeOf<InferRouteParams<"/blog/:id(\\d+){-:title}?">>().toEqualTypeOf<{
        id: string;
        title: string | undefined;
      }>();
      expectTypeOf<InferRouteParams<"/a/:x((?:a|b))/:y?">>().toEqualTypeOf<{
        x: string;
        y: string | undefined;
      }>();
      expectTypeOf<InferRouteParams<"/a/:x(\\)|a)/:y?">>().toEqualTypeOf<{
        x: string;
        y: string | undefined;
      }>();
      expectTypeOf<InferRouteParams<"/a/:x(\\)|a)?">>().toEqualTypeOf<{ x: string | undefined }>();
      expectTypeOf<InferRouteParams<"/static\\:path/:id">>().toEqualTypeOf<{ id: string }>();
    });

    it("should infer mixed params", () => {
      type Params = InferRouteParams<"/test/:id/*/foo/:name/**">;
      type Expected = { id: string; "0": string; name: string; _: string };
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
    });

    it("should work with trailing slash", () => {
      type Params = InferRouteParams<"/test/:id/static">;
      type Expected = { id: string };
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
    });
  });

  describe("compiler", () => {
    type Data = { handler: string };
    const router = createRouter<Data>();

    it("types compileRouter by its matchAll option", () => {
      expectTypeOf(compileRouter(router)).toEqualTypeOf<CompiledMatch<Data>>();
      expectTypeOf(compileRouter(router, {})).toEqualTypeOf<CompiledMatch<Data>>();
      expectTypeOf(compileRouter(router, { matchAll: false })).toEqualTypeOf<CompiledMatch<Data>>();
      expectTypeOf(compileRouter(router, { matchAll: true })).toEqualTypeOf<
        CompiledMatchAll<Data>
      >();
      expectTypeOf(compileRouter(router, { normalize: true, matchAll: true })).toEqualTypeOf<
        CompiledMatchAll<Data>
      >();
      expectTypeOf<CompiledMatch<Data>>().toEqualTypeOf<
        (method: string, path: string) => MatchedRoute<Data> | undefined
      >();
      expectTypeOf<CompiledMatchAll<Data>>().toEqualTypeOf<
        (method: string, path: string) => MatchedRoute<Data>[]
      >();
    });

    it("types compileRouter with an explicit data type", () => {
      expectTypeOf(compileRouter<Data>(router, { matchAll: true })).toEqualTypeOf<
        CompiledMatchAll<Data>
      >();
      expectTypeOf(compileRouter<Data>(router)).toEqualTypeOf<CompiledMatch<Data>>();
    });

    it("types compileRouter with widened options as either result", () => {
      const opts = { matchAll: true };
      expectTypeOf(compileRouter(router, opts)).toEqualTypeOf<
        CompiledMatch<Data> | CompiledMatchAll<Data>
      >();
      const flag = Math.random() > 0.5;
      expectTypeOf(compileRouter(router, { matchAll: flag })).toEqualTypeOf<
        CompiledMatch<Data> | CompiledMatchAll<Data>
      >();
      const general: CompileRouterOptions<Data> = {};
      expectTypeOf(compileRouter(router, general)).toEqualTypeOf<
        CompiledMatch<Data> | CompiledMatchAll<Data>
      >();
      const exact = { matchAll: true } as const;
      expectTypeOf(compileRouter(router, exact)).toEqualTypeOf<CompiledMatchAll<Data>>();
    });

    it("types compileRouterToString options with the data type", () => {
      expectTypeOf(
        compileRouterToString(router, {
          functionName: "findRoute",
          matchAll: true,
          normalize: true,
          serialize: (data) => {
            expectTypeOf(data).toEqualTypeOf<Data>();
            return data.handler;
          },
        }),
      ).toEqualTypeOf<string>();
      expectTypeOf<CompileRouterToStringOptions<Data>["serialize"]>().toEqualTypeOf<
        ((data: Data) => string) | undefined
      >();
    });

    it("keeps the deprecated positional function name and option type", () => {
      expectTypeOf(compileRouterToString(router, "findRoute")).toEqualTypeOf<string>();
      const opts: RouterCompilerOptions<Data> = { matchAll: true, serialize: (d) => d.handler };
      expectTypeOf(compileRouterToString(router, undefined, opts)).toEqualTypeOf<string>();
      expectTypeOf<RouterCompilerOptions<Data>>().toEqualTypeOf<
        CompileRouterToStringOptions<Data>
      >();
    });
  });
});
