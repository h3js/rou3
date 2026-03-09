import { createRouter, addRoute } from "../src/index.ts";
import { compileRouterToString } from "../src/compiler.ts";
import { format } from "oxfmt";

const router = createRouter();

addRoute(router, "GET", "/npm/@:param1/:param2", {
  path: "/npm/@:param1/:param2",
});

addRoute(router, "GET", "/npm/:param1/:param2", {
  path: "/npm/:param1/:param2",
});

const compiled = compileRouterToString(router);

console.log(await format("snapshot.ts", compiled.toString()));
