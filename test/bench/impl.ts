import * as rou3 from "../../src/index.ts";
import * as rou3C from "../../src/compiler.ts";
import { requests, routes } from "./input.ts";

import * as rou3Latest from "rou3-latest";
import * as rou3CLatest from "rou3-latest/compiler";

export function createInstances() {
  const router = rou3.createRouter();
  const routerLatest = rou3.createRouter();
  for (const route of routes) {
    rou3.addRoute(
      router,
      route.method,
      route.path,
      `[${route.method}] ${route.path}`,
    );
    rou3Latest.addRoute(
      routerLatest,
      route.method,
      route.path,
      `[${route.method}] ${route.path}`,
    );
  }

  const compiledLookup = rou3C.compileRouter(router);
  const compiledLookupLatest = rou3CLatest.compileRouter(routerLatest);

  return [
    [
      "findRoute",
      (method: string, path: string) => rou3.findRoute(router, method, path),
    ],
    [
      "compileRouter",
      (method: string, path: string) => compiledLookup(method, path),
    ],
    [
      "findRouteLatest",
      (method: string, path: string) =>
        rou3Latest.findRoute(routerLatest, method, path),
    ],
    [
      "compileRouterLatest",
      (method: string, path: string) => compiledLookupLatest(method, path),
    ],
    process.argv.includes("--max") && ["maximum", createFastestRouter()],
  ].filter(Boolean) as [string, (method: string, path: string) => any][];
}

function createFastestRouter(): (method: string, path: string) => any {
  const staticMap = Object.create(null);
  for (const req of requests) {
    staticMap[req.method] = staticMap[req.method] || Object.create(null);
    staticMap[req.method][req.path] = req;
  }
  return (method: string, path: string) => {
    return staticMap[method]?.[path];
  };
}
