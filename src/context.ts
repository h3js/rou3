import { createNode } from "./node.ts";
import { NullProtoObj } from "./object.ts";
import type { RouterContext } from "./types.ts";

/**
 * Create a new router. `T` is the type of the route data.
 */
export function createRouter<T = unknown>(): RouterContext<T> {
  const ctx: RouterContext<T> = {
    root: createNode<T>(""),
    static: new NullProtoObj(),
  };
  return ctx;
}
