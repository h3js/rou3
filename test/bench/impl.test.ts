import { describe, it, expect } from "vitest";
import { requests } from "./input.ts";
import { createInstances } from "./impl.ts";

describe("benchmark", () => {
  const instances = createInstances();
  describe("app works as expected", () => {
    for (const [name, _find] of instances) {
      for (const request of requests) {
        it(`[${name}] [${request.method}] ${request.path}`, async () => {
          const match = _find(request.method, request.path);
          expect(match).toBeDefined();
          expect(match.params).toEqual(request.params);
          expect(match.data).toEqual(request.data);
        });
      }
    }
  });
});
