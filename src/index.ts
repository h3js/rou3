export { createRouter } from "./context.ts";

export type { RouterContext, MatchedRoute } from "./types.ts";

export { addRoute } from "./operations/add.ts";
export { findRoute } from "./operations/find.ts";
export { compileRoute } from "./operations/compile.ts";
export { removeRoute } from "./operations/remove.ts";
export { findAllRoutes } from "./operations/find-all.ts";
export { routeToRegExp } from "./regexp.ts";

export { NullProtoObj } from "./_utils.ts";
