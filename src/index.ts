export { createRouter } from "./context.ts";

export type { RouterContext, MatchedRoute, InferRouteParams } from "./types.ts";

export { addRoute } from "./operations/add.ts";
export { findRoute } from "./operations/find.ts";
export { removeRoute } from "./operations/remove.ts";
export { findAllRoutes } from "./operations/find-all.ts";
export { routesOverlap, compareRoutes, findOverlappingRoutes } from "./overlap/overlap.ts";
export type { RouteComparison } from "./overlap/overlap.ts";
export { routeNodeKeys } from "./route-node-keys.ts";
export { routeToRegExp } from "./regexp/route-to-regexp.ts";
export { regExpToRoute } from "./regexp/regexp-to-route.ts";

export { NullProtoObj } from "./object.ts";
