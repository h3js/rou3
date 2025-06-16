import type { MatchedRoute, MethodData, Node, RouterContext } from "./types.ts";

// p: path
// s: path parts
// l: path parts length
// m: method
// e: Empty group

/**
 * Whether the current node has children nodes
 * @param n
 */
const _hasChild = (n: Node<any>): boolean =>
  n.static != null || n.param != null || n.wildcard != null;

// Skip a native call for common methods
const _fastMethodStringify = (m: string) =>
  m === "GET"
    ? '"GET"'
    : m === "POST"
      ? '"POST"'
      : // eslint-disable-next-line
        m === "PUT"
        ? '"PUT"'
        : m === "DELETE"
          ? '"DELETE"'
          : JSON.stringify(m);

const _compileMethodMatch = (
  methods: Record<string, MethodData<any>[] | undefined>,
  params: string[],
  deps: any[],
  currentIdx: number, // Set to -1 for non-param node
): string => {
  let str = "";
  for (const key in methods) {
    const data = methods[key];
    if (data != null && data.length > 0) {
      // Don't check for all method handler
      if (key !== "") str += `if(m===${_fastMethodStringify(key)})`;
      let returnData = `return{data:d${deps.push(data[0].data)}`;

      // Add param properties
      const { paramsMap } = data[0];
      if (paramsMap != null && paramsMap.length > 0) {
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
              : `...(${map[1].toString()}.exec(${params[i]})||e).groups,`;
        }
        returnData += "}";
      }

      str += returnData + "}";
    }
  }
  return str;
};

/**
 * Compile a node to matcher logic
 */
const _compileNode = (
  node: Node<any>,
  params: string[],
  startIdx: number,
  deps: any[],
  isParamNode: boolean,
): string => {
  let str = "";

  if (node.methods != null)
    str += `if(l===${startIdx}${isParamNode ? `||l===${startIdx - 1}` : ""}){${_compileMethodMatch(node.methods, params, deps, isParamNode ? startIdx : -1)}}`;

  if (node.static != null)
    for (const key in node.static)
      str += `if(s[${startIdx}]===${JSON.stringify(key)}){${_compileNode(
        node.static[key],
        params,
        startIdx + 1,
        deps,
        false,
      )}}`;

  if (node.param != null)
    str += _compileNode(
      node.param,
      [...params, `s[${startIdx}]`],
      startIdx + 1,
      deps,
      true,
    );

  if (node.wildcard != null) {
    const { wildcard } = node;
    if (_hasChild(wildcard))
      throw new Error("Compiler mode does not support patterns after wildcard");

    if (wildcard.methods != null)
      str += _compileMethodMatch(
        wildcard.methods,
        [...params, `s.slice(${startIdx}).join('/')`],
        deps,
        startIdx,
      );
  }

  return str;
};

/**
 * Compile a router to pattern matching statements
 * @param router
 * @param deps - Dependencies of the function scope
 */
const _compileRouteMatch = (
  router: RouterContext<any>,
  deps: any[],
): string => {
  // Support trailing slash
  let str = "if(p[p.length-1]==='/')p=p.slice(0,-1);";

  for (const key in router.static) {
    const node = router.static[key];
    if (node != null && node.methods != null)
      str += `if(p===${JSON.stringify(key)}){${_compileMethodMatch(node.methods, [], deps, -1)}}`;
  }

  return (
    str +
    "let s=p.split('/').filter(q=>q!==''),l=s.length;" +
    _compileNode(router.root, [], 0, deps, false)
  );
};

/**
 * Compiles the router instance into a faster route-matching function.
 *
 * **IMPORTANT:** Compiler is an experimental feature, may contain issues and the API may change between versions.
 *
 * **IMPORTANT:** This function requires eval (`new Function`) support in the runtime environment for JIT (Just-In-Time)
 * compilation.
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
export const compileRouter = <T>(
  router: RouterContext<T>,
): ((method: string, path: string) => MatchedRoute<T> | undefined) => {
  const deps: any[] = [];
  const compiled = _compileRouteMatch(router, deps);
  return new Function(
    ...deps.map((_, i) => "d" + (i + 1)),
    `let e={groups:{}};return(m,p)=>{${compiled}}`,
  )(...deps);
};
