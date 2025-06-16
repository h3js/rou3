import type { MatchedRoute, MethodData, Node, RouterContext } from "./types.ts";

/**
 * Compiles the router instance into a faster route-matching function.
 *
 * **IMPORTANT:** `compileRouter` requires eval support with `new Function()` in the runtime for JIT compilation.
 *
 * @example
 * import { createRouter, addRoute } from "rou3";
 * import { compileRouter } from "rou3/experimental-compiler";
 * const router = createRouter();
 * // [add some routes]
 * const findRoute = compileRouter(router);
 * findRoute("GET", "/path/foo/bar");
 *
 * @param router - The router context to compile.
 */
export function compileRouter<T>(
  router: RouterContext<T>,
): (method: string, path: string) => MatchedRoute<T> | undefined {
  const deps: any[] = [];
  const compiled = compileRouteMatch(router, deps);
  return new Function(
    ...deps.map((_, i) => "d" + (i + 1)),
    `return(m,p)=>{${compiled}}`,
  )(...deps);
}

/**
 * Compile the router instance into a compact runnable code.
 *
 * **IMPORTANT:** Route data must be serializable to JSON (i.e., no functions or classes) or implement the `toJSON()` method to render custom code.
 *
 * @example
 * import { createRouter, addRoute } from "rou3";
 * import { compileRouterToString } from "rou3/experimental-compiler";
 * const router = createRouter();
 * // [add some routes with serializable data]
 * const compilerCode = compileRouterToString(router, "findRoute");
 * // "const findRoute=(m, m) => {}"
 */
export function compileRouterToString(
  router: RouterContext,
  functionName?: string,
): string {
  const compiled = `(m,p)=>{${compileRouteMatch(router)}}`;
  return functionName ? `const ${functionName}=${compiled};` : compiled;
}

// ------- internal functions -------

// p: path
// s: path parts
// l: path parts length
// m: method

/**
 * Compile a router to pattern matching statements
 * @param router
 * @param deps - Dependencies of the function scope
 */
function compileRouteMatch(router: RouterContext<any>, deps?: any[]): string {
  // Ignore trailing slash
  let str = `if(p[p.length-1]==='/')p=p.slice(0,-1)||'/';`;

  const staticNodes = new Set<Node>();

  for (const key in router.static) {
    const node = router.static[key];
    if (node?.methods) {
      staticNodes.add(node);
      str += `if(p===${JSON.stringify(key.replace(/\/$/, "") || "/")}){${compileMethodMatch(node.methods, [], deps, -1)}}`;
    }
  }

  return (
    str +
    "let s=p.split('/').filter(q=>q!==''),l=s.length;" +
    compileNode(router.root, [], 0, deps, false, staticNodes)
  );
}

function compileMethodMatch(
  methods: Record<string, MethodData<any>[] | undefined>,
  params: string[],
  deps: any[] | undefined,
  currentIdx: number, // Set to -1 for non-param node
): string {
  let str = "";
  for (const key in methods) {
    const data = methods[key];
    if (data && data?.length > 0) {
      // Don't check for all method handler
      if (key !== "") str += `if(m==='${key}')`;
      const dataValue = data[0].data;
      let returnData = deps
        ? `return{data:d${deps.push(dataValue)}`
        : `return{data:${typeof dataValue?.toJSON === "function" ? dataValue.toJSON() : JSON.stringify(dataValue)}`;

      // Add param properties
      const { paramsMap } = data[0];
      if (paramsMap && paramsMap.length > 0) {
        // Check for optional end parameters
        const required =
          !paramsMap[paramsMap.length - 1][2] && currentIdx !== -1;
        if (required) str += `if(l>=${currentIdx})`;

        // Create the param object based on previous parameters
        returnData += ",params:{";
        for (let i = 0; i < paramsMap.length; i++) {
          const map = paramsMap[i];

          returnData +=
            typeof map[1] === "string"
              ? `${JSON.stringify(map[1])}:${params[i]},`
              : `...(${map[1].toString()}.exec(${params[i]}))?.groups,`;
        }
        returnData += "}";
      }

      str += returnData + "}";
    }
  }
  return str;
}

/**
 * Compile a node to matcher logic
 */
function compileNode(
  node: Node<any>,
  params: string[],
  startIdx: number,
  deps: any[] | undefined,
  isParamNode: boolean,
  staticNodes: Set<Node>,
): string {
  let str = "";

  if (node.methods && !staticNodes.has(node)) {
    str += `if(l===${startIdx}${isParamNode ? `||l===${startIdx - 1}` : ""}){${compileMethodMatch(node.methods, params, deps, isParamNode ? startIdx : -1)}}`;
  }

  if (node.static) {
    for (const key in node.static)
      str += `if(s[${startIdx}]===${JSON.stringify(key)}){${compileNode(
        node.static[key],
        params,
        startIdx + 1,
        deps,
        false,
        staticNodes,
      )}}`;
  }

  if (node.param) {
    str += compileNode(
      node.param,
      [...params, `s[${startIdx}]`],
      startIdx + 1,
      deps,
      true,
      staticNodes,
    );
  }

  if (node.wildcard) {
    const { wildcard } = node;
    if (hasChild(wildcard)) {
      throw new Error("Compiler mode does not support patterns after wildcard");
    }

    if (wildcard.methods)
      str += compileMethodMatch(
        wildcard.methods,
        [...params, `s.slice(${startIdx}).join('/')`],
        deps,
        startIdx,
      );
  }

  return str;
}

/**
 * Whether the current node has children nodes
 * @param n
 */
function hasChild(n: Node<any>): boolean {
  return !!(n.static || n.param || n.wildcard);
}
