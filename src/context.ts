import { NullProtoObj } from "./_utils";
import type { RouterContext } from "./types";

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
