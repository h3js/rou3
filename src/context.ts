import { NullProtoObj } from "./object.ts";
import type { RouterContext } from "./types.ts";

/**
 * Create a new router context.
 */
export function createRouter<T = unknown>(): RouterContext<T> {
  const ctx: RouterContext<T> = {
    root: { key: "" },
    static: new NullProtoObj(),
  };
  return ctx;
}
