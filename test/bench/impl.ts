// import * as rou3Release from "rou3-release";
import * as rou3Src from "../../src/index.ts";
import { requests, routes } from "./input.ts";

export function createInstances() {
  return [
    ["rou3", createRouter(rou3Src)],
    ["rou3-compiled", createRouter(rou3Src, "compiled")],
    ["rou3-findAll", createRouter(rou3Src, "findAll")],
    ["maximum", createFastestRouter()],
  ].filter(Boolean) as [string, (method: string, path: string) => any][];
}

export function createRouter(
  rou3: typeof rou3Src,
  variant?: "findAll" | "compiled",
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
  if (variant === "findAll") {
    return (method: string, path: string) => {
      return rou3.findAllRoutes(router, method, path).pop();
    };
  }
  if (variant === "compiled") {
    const matchCompiled = rou3.compileRouter(router);
    console.log(matchCompiled.toString());
    return matchCompiled;
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
