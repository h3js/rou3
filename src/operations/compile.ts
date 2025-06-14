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
// l: path length
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
          str += `${JSON.stringify(map[1])}:p${i},`;
        }
        str += "}";
      }

      str += "};";
    }
  }
  return str;
};

export const _compileKeyMatch = (
  key: string,
  startIdx: string,
  ifBody: string,
): string =>
  `if(p.startsWith(${JSON.stringify(key)}${
    startIdx === "0" ? "" : "," + startIdx
  })){${ifBody}}`;

/**
 * Compile a node to matcher logic
 *
 * Local variables:
 * - `p`: input path
 * - `l`: input path length
 * - `m`: input request method
 * - `p{i}`: parsed parameter
 * - `u`, `v`: Temporary index store
 *
 * Dependencies:
 * - `d{i}`: Dependency index i (index starts at 1)
 *
 * @param notParamNode - Whether the current node is a parameter node
 * @param param0 - Target node to compile
 * @param idxPrefix - Set to `u+` or `v+` to track parameter index
 * @param startIdx - The start index of the input string to start matching
 * @param paramCnt - Count previous path parameters
 * @param deps - Dependencies of the function scope
 */
export const _compileNode = (
  notParamNode: boolean,
  node: Node<any>,
  idxPrefix: string,
  startIdx: number,
  paramCnt: number,
  deps: any[],
): string => {
  let str = "";

  let currentIdx = idxPrefix + startIdx;
  if (notParamNode && node.methods != null)
    str += `if(l===${currentIdx}){${_compileMethodMatch(node.methods, deps)}}`;

  if (node.static != null)
    for (const key in node.static)
      str += _compileKeyMatch(
        "/" + key,
        currentIdx,
        _compileNode(
          true,
          node.static[key],
          idxPrefix,
          startIdx + key.length + 1,
          paramCnt,
          deps,
        ),
      );

  if (node.param != null) {
    const { param } = node;

    const hasMethods = param.methods != null;
    const hasChildNodes = _hasChild(param);

    // Declare a variable to save previous param index
    if (paramCnt > 0) {
      str += `let v=${currentIdx};`;
      currentIdx = "v";
    }

    const slashIndex = `p.indexOf("/"${currentIdx === "0" ? "" : "," + currentIdx})`;

    // Need to save the current parameter index if the parameter node is not a leaf node
    if (hasChildNodes || !hasMethods)
      str += `${paramCnt > 0 ? "" : "let "}u=${slashIndex};`;

    // End of parameter
    if (hasMethods)
      str += `if(${hasChildNodes ? "u" : slashIndex}===-1){let p${paramCnt}=p.slice(${currentIdx});${_compileMethodMatch(param.methods!, deps)}}`;

    // Compile other nodes
    if (hasChildNodes)
      str += `if(u>${currentIdx}){${_compileNode(false, param, "u+", 1, paramCnt + 1, deps)}}`;
  }

  if (node.wildcard != null) {
    const { wildcard } = node;
    if (_hasChild(wildcard))
      throw new Error("Compiler mode does not support patterns after wildcard");

    const wildcardMethods = wildcard.methods;
    if (wildcardMethods != null) {
      const compiled = _compileMethodMatch(wildcardMethods, deps);
      str +=
        node.methods == null ? `if(l>${currentIdx}){${compiled}}` : compiled;
    }
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
    if (node != null)
      str += _compileKeyMatch(
        key,
        "0",
        _compileNode(true, node, "", key.length, 0, deps),
      );
  }

  return str + _compileNode(true, router.root, "", 1, 0, deps);
};

/**
 * Compile the router to a pattern matching function
 * @param router
 */
export const compileRoute = <T>(
  router: RouterContext<T>,
): ((path: string, method: string) => MatchedRoute<T> | undefined) => {
  const deps: any[] = [];
  const compiled = _compileRouteMatch(router, deps);

  return new Function(
    ...deps.map((_, i) => "d" + (i + 1)),
    `return(p,m)=>{let l=p.length;${compiled}}`,
  )(...deps);
};
