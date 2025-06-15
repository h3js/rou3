import { compileRouter } from "../../src/compiler.ts";
import { createRouter, addRoute, findRoute } from "../../src/index.ts";
import { requests, routes } from "./input.ts";

export function createInstances() {
  const router = createRouter();
  for (const route of routes) {
    addRoute(
      router,
      route.method,
      route.path,
      `[${route.method}] ${route.path}`,
    );
  }

  const compiledLookup = compileRouter(router);

  return [
    [
      "findRoute",
      (method: string, path: string) => findRoute(router, method, path),
    ],
    [
      "compileRouter",
      (method: string, path: string) => compiledLookup(method, path),
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
