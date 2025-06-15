import type {
  MatchedRoute,
  MethodData,
  Node,
  RouterContext,
} from "../types.ts";

/**
 * TODO: Support optional parameters and correct handling for wildcard
 */

// p: path
// s: path parts
// l: path parts length
// m: method

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

export const _compileMethodMatch = (
  methods: Record<string, MethodData<any>[] | undefined>,
  params: string[],
  deps: any[],
): string => {
  let str = "";
  for (const key in methods) {
    const data = methods[key];
    if (data != null && data.length > 0) {
      // Don't check for all method handler
      if (key !== "") str += `if(m===${_fastMethodStringify(key)})`;

      // Add new dependency to the function scope
      str += `return{data:d${deps.push(data[0].data)}`;

      // Add param property
      const { paramsMap } = data[0];
      if (paramsMap != null && paramsMap.length > 0) {
        // Create the param object based on previous parameters
        str += ",params:{";
        for (let i = 0; i < paramsMap.length; i++) {
          const map = paramsMap[i];

          if (typeof map[1] !== "string")
            throw new Error("Compiler does not handle regexp parameter name");

          // Select proper parameter
          str += `${JSON.stringify(map[1])}:${params[i]},`;
        }
        str += "}";
      }

      str += "}";
    }
  }
  return str;
};

/**
 * Compile a node to matcher logic
 */
export const _compileNode = (
  node: Node<any>,
  params: string[],
  startIdx: number,
  deps: any[],
): string => {
  let str = "";

  if (node.methods != null)
    str += `if(l===${startIdx}){${_compileMethodMatch(node.methods, params, deps)}}`;

  if (node.static != null)
    for (const key in node.static)
      str += `if(s[${startIdx}]===${JSON.stringify(key)}){${_compileNode(
        node.static[key],
        params,
        startIdx + 1,
        deps,
      )}}`;

  if (node.param != null)
    str += `if(l>${startIdx})if(s[${startIdx}]!==''){${_compileNode(
      node.param,
      [...params, `s[${startIdx}]`],
      startIdx + 1,
      deps,
    )}}`;

  if (node.wildcard != null) {
    const { wildcard } = node;
    if (_hasChild(wildcard))
      throw new Error("Compiler mode does not support patterns after wildcard");

    if (wildcard.methods != null)
      str += _compileMethodMatch(
        wildcard.methods,
        [...params, `s.slice(${startIdx}).join('/')`],
        deps,
      );
  }

  return str;
};

/**
 * Compile a router to pattern matching statements
 * @param router
 * @param deps - Dependencies of the function scope
 */
export const _compileRouteMatch = (
  router: RouterContext<any>,
  deps: any[],
): string => {
  let str = "";

  for (const key in router.static) {
    const node = router.static[key];
    if (node != null && node.methods != null)
      str += `if(p===${JSON.stringify(key)}){${_compileMethodMatch(node.methods, [], deps)}}`;
  }

  return (
    str +
    "let s=p.split('/'),l=s.length;" +
    _compileNode(router.root, [], 1, deps)
  );
};

/**
 * Compile the router to a pattern matching function
 * @param router
 */
export const compileRoute = <T>(
  router: RouterContext<T>,
): ((method: string, path: string) => MatchedRoute<T> | undefined) => {
  const deps: any[] = [];
  const compiled = _compileRouteMatch(router, deps);

  return new Function(
    ...deps.map((_, i) => "d" + (i + 1)),
    `return(m,p)=>{${compiled}}`,
  )(...deps);
};
