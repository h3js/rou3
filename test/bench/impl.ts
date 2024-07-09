import * as rou3Src from "../../src";
import * as rou3Release from "rou3-release";
import { requests, routes } from "./input";

export function createInstances() {
  return [
    ["rou3-src", createRouter(rou3Src)],
    ["rou3-src-find-all", createRouter(rou3Src, true)],
    ["rou3-release", createRouter(rou3Release as unknown as typeof rou3Src)],
    // [
    //   "rou3-release-find-all",
    //   createRouter(rou3Release as unknown as typeof rou3Src, true),
    // ],
    ["maximum", createFastestRouter()],
  ] as const;
}

export function createRouter(rou3: typeof rou3Src, withAll: boolean = false) {
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
      return rou3.findAllRoutes(router, method, path, { params: true }).pop();
    };
  }
  return (method: string, path: string) => {
    return rou3.findRoute(router, method, path);
  };
}

export function createFastestRouter() {
  const staticMap = Object.create(null);
  for (const req of requests) {
    staticMap[req.method] = staticMap[req.method] || Object.create(null);
    staticMap[req.method][req.path] = req;
  }
  return (method: string, path: string) => {
    return staticMap[method]?.[path];
  };
}
