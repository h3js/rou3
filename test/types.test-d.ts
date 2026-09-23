import { describe, expectTypeOf, it } from "vitest";
import { routeNodeKeys } from "../src/index.ts";
import type { InferRouteParams, MatchedRoute } from "../src/index.ts";

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
      expectTypeOf<InferRouteParams<"/test/:id(\\d+)+/x">>().toEqualTypeOf<{ id: string }>();
    });

    it("should infer optional params as possibly undefined", () => {
      type Optional = { id: string | undefined };
      expectTypeOf<InferRouteParams<"/test/:id?">>().toEqualTypeOf<Optional>();
      expectTypeOf<InferRouteParams<"/test/:id*">>().toEqualTypeOf<Optional>();
      expectTypeOf<InferRouteParams<"/test/:id(\\d+)?">>().toEqualTypeOf<Optional>();
      expectTypeOf<InferRouteParams<"/test/:id(\\d+)*">>().toEqualTypeOf<Optional>();
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
});
