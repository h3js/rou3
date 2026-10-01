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
      // `pre-:id?` makes only the param optional (`pre-{:id}?`)
      expectTypeOf<InferRouteParams<"/test/pre-:id?">>().toEqualTypeOf<Optional>();
      expectTypeOf<InferRouteParams<"/test/pre-:id(\\d+)?/x">>().toEqualTypeOf<Optional>();
      expectTypeOf<InferRouteParams<"/test/:a-:id?">>().toEqualTypeOf<{
        a: string;
        id: string | undefined;
      }>();
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
      // An unnamed capture (as in URLPattern), unset over zero segments, also
      // under the deprecated `_`
      type Params = InferRouteParams<"/test/**">;
      type Expected = { "0": string | undefined; _?: string };
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
    });

    it("should handle named wildcard", () => {
      type Params = InferRouteParams<"/test/**:id">;
      type Expected = { id: string };
      expectTypeOf<Params>().toEqualTypeOf<Expected>();
    });

    it("should handle segments after a wildcard", () => {
      expectTypeOf<InferRouteParams<"/**/_payload.json">>().toEqualTypeOf<{
        "0": string | undefined;
        _?: string;
      }>();
      expectTypeOf<InferRouteParams<"/blog/**:path/_payload.json">>().toEqualTypeOf<{
        path: string;
      }>();
      expectTypeOf<InferRouteParams<"/**/*.png">>().toEqualTypeOf<{
        "0": string | undefined;
        "1": string;
        _?: string;
      }>();
      expectTypeOf<InferRouteParams<"/*/**/:file/*">>().toEqualTypeOf<{
        "0": string;
        "1": string | undefined;
        file: string;
        "2": string;
        _?: string;
      }>();
      expectTypeOf<InferRouteParams<"/**:p/:f(.*)">>().toEqualTypeOf<{ p: string; f: string }>();
      // `**<rest>` is `**/*<rest>`
      expectTypeOf<InferRouteParams<"/**.md">>().toEqualTypeOf<{
        "0": string | undefined;
        "1": string;
        _?: string;
      }>();
      expectTypeOf<InferRouteParams<"/docs/*/**.md">>().toEqualTypeOf<{
        "0": string;
        "1": string | undefined;
        "2": string;
        _?: string;
      }>();
      // `:x+` before the last segment is a `**`: a `*` after it takes a segment
      expectTypeOf<InferRouteParams<"/a/:x+/b/*">>().toEqualTypeOf<{ x: string; "0": string }>();
      // ... but a static segment ending in `+` is not one
      expectTypeOf<InferRouteParams<"/c++/*">>().toEqualTypeOf<{ "0": string | undefined }>();
      // A `}` right after `**` closes a group: no `*` capture follows
      expectTypeOf<InferRouteParams<"/a{/**}?">>().toEqualTypeOf<{
        "0": string | undefined;
        _?: string;
      }>();
      expectTypeOf<InferRouteParams<"/a{/**}?/b">>().toEqualTypeOf<{
        "0": string | undefined;
        _?: string;
      }>();
      // No `_` alias without a bare `**`
      expectTypeOf<InferRouteParams<"/a/**:_">>().toEqualTypeOf<{ _: string }>();
      expectTypeOf<InferRouteParams<"/a/*">>().toEqualTypeOf<{ "0": string | undefined }>();
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
      // The `:` of a `(?:…)` group is no param (the group is unnamed)
      expectTypeOf<keyof InferRouteParams<"/((?:a|b))">>().toEqualTypeOf<"0">();
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

    it("should end param names at a `{` / `}`", () => {
      expectTypeOf<InferRouteParams<"/:a{b}?">>().toEqualTypeOf<{ a: string }>();
      expectTypeOf<InferRouteParams<"/:a{b}">>().toEqualTypeOf<{ a: string }>();
      expectTypeOf<InferRouteParams<"/:foo{}bar">>().toEqualTypeOf<{ foo: string }>();
      expectTypeOf<InferRouteParams<"/c/{:a}b">>().toEqualTypeOf<{ a: string }>();
      // A `**:name` too
      expectTypeOf<InferRouteParams<"/a{/**:x}?">>().toEqualTypeOf<{ x: string | undefined }>();
      expectTypeOf<InferRouteParams<"/a/**:x{/b}?">>().toEqualTypeOf<{ x: string }>();
      expectTypeOf<InferRouteParams<"/a/**:x{s}?">>().toEqualTypeOf<{ x: string }>();
    });

    // Types read names like `addRoute` but don't validate routes: a name it
    // rejects (`:0`, `:id$`) gives no key.
    it("should give no key for an invalid param name", () => {
      expectTypeOf<keyof InferRouteParams<"/:0">>().toEqualTypeOf<never>();
      expectTypeOf<keyof InferRouteParams<"/:id$">>().toEqualTypeOf<never>();
      expectTypeOf<keyof InferRouteParams<"/a/:$x">>().toEqualTypeOf<never>();
      expectTypeOf<keyof InferRouteParams<"/a/**:id$">>().toEqualTypeOf<never>();
      expectTypeOf<InferRouteParams<"/a/:x-:id$">>().toEqualTypeOf<{ x: string }>();
      // An escaped `$` is a literal
      expectTypeOf<InferRouteParams<"/:id\\$">>().toEqualTypeOf<{ id: string }>();
    });

    // Literal text is percent-encoded at insert; it never changes the keys
    it("should ignore literal text, encoded or not", () => {
      expectTypeOf<InferRouteParams<"/café/:id">>().toEqualTypeOf<{ id: string }>();
      expectTypeOf<InferRouteParams<"/café-:id">>().toEqualTypeOf<{ id: string }>();
      expectTypeOf<InferRouteParams<"/:id-café">>().toEqualTypeOf<{ id: string }>();
      expectTypeOf<InferRouteParams<"/:caf\\é">>().toEqualTypeOf<{ caf: string }>();
      expectTypeOf<InferRouteParams<"/:id%C3%A9">>().toEqualTypeOf<{ id: string }>();
      expectTypeOf<InferRouteParams<"/a b/\\{x\\}/:id">>().toEqualTypeOf<{ id: string }>();
    });

    it("should number unnamed groups with `*` and `**`", () => {
      expectTypeOf<InferRouteParams<"/path/(\\d+)">>().toEqualTypeOf<{ "0": string }>();
      expectTypeOf<InferRouteParams<"/(\\d+)/**">>().toEqualTypeOf<{
        "0": string;
        "1": string | undefined;
        _?: string;
      }>();
      // A capture in an optional group may be unset
      expectTypeOf<InferRouteParams<"/x{(\\d+)}?/*">>().toEqualTypeOf<{
        "0": string | undefined;
        "1": string | undefined;
      }>();
      expectTypeOf<InferRouteParams<"/a{/(\\d+)}?/**">>().toEqualTypeOf<{
        "0": string | undefined;
        "1": string | undefined;
        _?: string;
      }>();
      expectTypeOf<InferRouteParams<"/a/x{-(\\d+)}?/**">>().toEqualTypeOf<{
        "0": string | undefined;
        "1": string | undefined;
        _?: string;
      }>();
      expectTypeOf<InferRouteParams<"/a{/*}?/b">>().toEqualTypeOf<{ "0": string | undefined }>();
      expectTypeOf<InferRouteParams<"/a{-*}/b">>().toEqualTypeOf<{ "0": string }>();
      // `**{.png}?` is `**` or `**.png` (`**/*.png`)
      expectTypeOf<InferRouteParams<"/a/**{.png}?">>().toEqualTypeOf<{
        "0": string | undefined;
        "1": string | undefined;
        _?: string;
      }>();
      // Long static routes stay in TS's recursion limit
      expectTypeOf<
        InferRouteParams<"/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/**">
      >().toEqualTypeOf<{
        "0": string | undefined;
        _?: string;
      }>();
      expectTypeOf<
        keyof InferRouteParams<"/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
      >().toEqualTypeOf<never>();
      // A `*` inside a group is the group's, a `(?:` or an escaped `\(` is none
      expectTypeOf<InferRouteParams<"/(a*)/*">>().toEqualTypeOf<{
        "0": string;
        "1": string | undefined;
      }>();
      expectTypeOf<InferRouteParams<"/((?:a|b))/*">>().toEqualTypeOf<{
        "0": string;
        "1": string | undefined;
      }>();
      expectTypeOf<InferRouteParams<"/\\(x\\)/*">>().toEqualTypeOf<{ "0": string | undefined }>();
      // A constraint is its param's
      expectTypeOf<InferRouteParams<"/:id(\\d+)/*">>().toEqualTypeOf<{
        id: string;
        "0": string | undefined;
      }>();
      // Numbered over the whole pattern, a left-out group's included
      expectTypeOf<InferRouteParams<"/a{/**}?/*">>().toEqualTypeOf<{
        "0": string | undefined;
        "1": string;
        _?: string;
      }>();
      // Scanned char by char, also a long route
      expectTypeOf<
        InferRouteParams<"/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/:id/(\\d+)/*">
      >().toEqualTypeOf<{ id: string; "0": string; "1": string | undefined }>();
      // A `{` right after `**` starts a group: no `*` capture follows
      expectTypeOf<InferRouteParams<"/**{/b}?">>().toEqualTypeOf<{
        "0": string | undefined;
        _?: string;
      }>();
    });

    it("should infer mixed params", () => {
      type Params = InferRouteParams<"/test/:id/*/foo/:name/**">;
      type Expected = {
        id: string;
        "0": string;
        name: string;
        "1": string | undefined;
        _?: string;
      };
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
