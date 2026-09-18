import { describe, expectTypeOf, it } from "vitest";
import type { InferRouteParams, MatchedRoute } from "../src/index.ts";

describe("types", () => {
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
