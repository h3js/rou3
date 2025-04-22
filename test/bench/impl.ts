import * as rou3Release from "rou3-release";
import * as rou3Src from "../../src/index.ts";
import { requests, routes } from "./input.ts";

export function createInstances() {
  return [
    ["rou3", createRouter(rou3Src)],
    ["rou3-find-all", createRouter(rou3Src, true)],
    ["rou3-release", createRouter(rou3Release as unknown as typeof rou3Src)],
    [
      "rou3-release-find-all",
      createRouter(rou3Release as unknown as typeof rou3Src, true),
    ],
    process.argv.includes("--max")
      ? ["maximum", createFastestRouter()]
      : undefined,
  ].filter(Boolean) as [string, (method: string, path: string) => any][];
}

export function createRouter(
  rou3: typeof rou3Src,
  withAll: boolean = false,
): (method: string, path: string) => any {
  const router = rou3.createRouter();
  for (const route of routes) {
    rou3.addRoute(
      router,
      route.method,
      route.path,
      `[${route.method}] ${route.path}`,
    );
  }
  if (withAll) {
    return (method: string, path: string) => {
      return rou3.findAllRoutes(router, method, path).pop();
    };
  }
  return (method: string, path: string) => {
    return rou3.findRoute(router, method, path);
  };
}

export function createFastestRouter(): (method: string, path: string) => any {
  const staticMap = Object.create(null);
  for (const req of requests) {
    staticMap[req.method] = staticMap[req.method] || Object.create(null);
    staticMap[req.method][req.path] = req;
  }
  return (method: string, path: string) => {
    return staticMap[method]?.[path];
  };
}
