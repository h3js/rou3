import { createRouter, addRoute } from "../src/index.ts";
import { compileRouter } from "../src/compiler.ts";
import { format } from "prettier";

const router = createRouter();

addRoute(router, "GET", "/npm/@:param1/:param2", {
  path: "/npm/@:param1/:param2",
});

addRoute(router, "GET", "/npm/:param1/:param2", {
  path: "/npm/:param1/:param2",
});

const compiled = compileRouter(router);

console.log(await format(compiled.toString(), { parser: "typescript" }));
