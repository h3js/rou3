import { describe, expectTypeOf, it } from "vitest";
import type { InferRouteParams } from "../src/index.ts";

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
  });
});
