import type { MatchedRoute, MethodData, Node, RouterContext } from "./types.ts";

export interface RouterCompilerOptions<T = any> {
  matchAll?: boolean;
  serialize?: (data: T) => string;
}

/**
 * Compiles the router instance into a faster route-matching function.
 *
 * **IMPORTANT:** `compileRouter` requires eval support with `new Function()` in the runtime for JIT compilation.
 *
 * @example
 * import { createRouter, addRoute } from "rou3";
 * import { compileRouter } from "rou3/compiler";
 * const router = createRouter();
 * // [add some routes]
 * const findRoute = compileRouter(router);
 * const matchAll = compileRouter(router, { matchAll: true });
 * findRoute("GET", "/path/foo/bar");
 *
 * @param router - The router context to compile.
 */
export function compileRouter<
  T,
  O extends RouterCompilerOptions<T> = RouterCompilerOptions<T>,
>(
  router: RouterContext<T>,
  opts?: O,
): (
  method: string,
  path: string,
) => O["matchAll"] extends true
  ? MatchedRoute<T>[]
  : MatchedRoute<T> | undefined {
  const ctx: CompilerContext = { opts: opts || {}, router, deps: [] };
  const compiled = compileRouteMatch(ctx);
  return new Function(
    ...ctx.deps!.map((_, i) => "d" + (i + 1)),
    `return(m,p)=>{${compiled}}`,
  )(...ctx.deps!);
}

/**
 * Compile the router instance into a compact runnable code.
 *
 * **IMPORTANT:** Route data must be serializable to JSON (i.e., no functions or classes) or implement the `toJSON()` method to render custom code or you can pass custom `serialize` function in options.
 *
 * @example
 * import { createRouter, addRoute } from "rou3";
 * import { compileRouterToString } from "rou3/compiler";
 * const router = createRouter();
 * // [add some routes with serializable data]
 * const compilerCode = compileRouterToString(router, "findRoute");
 * // "const findRoute=(m, p) => {}"
 */
export function compileRouterToString(
  router: RouterContext,
  functionName?: string,
  opts?: RouterCompilerOptions,
): string {
  const ctx: CompilerContext = { opts: opts || {}, router, deps: undefined };
  const compiled = `(m,p)=>{${compileRouteMatch(ctx)}}`;
  return functionName ? `const ${functionName}=${compiled};` : compiled;
}

// ------- internal functions -------

interface CompilerContext {
  opts: RouterCompilerOptions;
  router: RouterContext<any>;
  deps: string[] | undefined;
}

function compileRouteMatch(ctx: CompilerContext): string {
  let code = "";
  const staticNodes = new Set<Node>();

  for (const key in ctx.router.static) {
    const node = ctx.router.static[key];
    if (node?.methods) {
      staticNodes.add(node);
      code += `if(p===${JSON.stringify(key.replace(/\/$/, "") || "/")}){${compileMethodMatch(ctx, node.methods, [], -1)}}`;
    }
  }

  const match = compileNode(ctx, ctx.router.root, [], 0, staticNodes);
  if (match) {
    code += `let s=p.split("/"),l=s.length-1;${match}`;
  }

  if (!code) {
    return ctx.opts?.matchAll ? `return [];` : "";
  }

  return `${ctx.opts?.matchAll ? `let r=[];` : ""}if(p.charCodeAt(p.length-1)===47)p=p.slice(0,-1)||"/";${code}${ctx.opts?.matchAll ? "return r;" : ""}`;
}

function compileMethodMatch(
  ctx: CompilerContext,
  methods: Record<string, MethodData<any>[] | undefined>,
  params: string[],
  currentIdx: number, // Set to -1 for non-param node
): string {
  let code = "";
  for (const key in methods) {
    const data = methods[key];
    if (data && data?.length > 0) {
      // Don't check for matchAll method handler
      if (key !== "") code += `if(m==="${key}")`;
      code += compileFinalMatch(ctx, data[0], currentIdx, params);
    }
  }
  return code;
}

function compileFinalMatch(
  ctx: CompilerContext,
  data: MethodData<any>,
  currentIdx: number,
  params: string[],
): string {
  let code = "";
  let ret = `{data:${serializeData(ctx, data.data)}`;

  // Add param properties
  const { paramsMap } = data;
  if (paramsMap && paramsMap.length > 0) {
    // Check for optional end parameters
    const required = !paramsMap[paramsMap.length - 1][2] && currentIdx !== -1;
    if (required) code += `if(l>=${currentIdx})`;
    // Create the param object based on previous parameters
    ret += ",params:{";
    for (let i = 0; i < paramsMap.length; i++) {
      const map = paramsMap[i];
      ret +=
        typeof map[1] === "string"
          ? `${JSON.stringify(map[1])}:${params[i]},`
          : `...(${map[1].toString()}.exec(${params[i]}))?.groups,`;
    }
    ret += "}";
  }
  return (
    code + (ctx.opts?.matchAll ? `r.unshift(${ret}});` : `return ${ret}};`)
  );
}

function compileNode(
  ctx: CompilerContext,
  node: Node<any>,
  params: string[],
  startIdx: number,
  staticNodes: Set<Node>,
): string {
  let code = "";

  if (node.methods && !staticNodes.has(node)) {
    const match = compileMethodMatch(
      ctx,
      node.methods,
      params,
      node.key === "*" ? startIdx : -1,
    );
    if (match) {
      const hasLastOptionalParam = node.key === "*";
      code += `if(l===${startIdx}${hasLastOptionalParam ? `||l===${startIdx - 1}` : ""}){${match}}`;
    }
  }

  if (node.static) {
    for (const key in node.static) {
      const match = compileNode(
        ctx,
        node.static[key],
        params,
        startIdx + 1,
        staticNodes,
      );
      if (match) {
        code += `if(s[${startIdx + 1}]===${JSON.stringify(key)}){${match}}`;
      }
    }
  }

  if (node.param) {
    const match = compileNode(
      ctx,
      node.param,
      [...params, `s[${startIdx + 1}]`],
      startIdx + 1,
      staticNodes,
    );
    if (match) {
      code += match;
    }
  }

  if (node.wildcard) {
    const { wildcard } = node;
    if (wildcard.static || wildcard.param || wildcard.wildcard) {
      throw new Error("Compiler mode does not support patterns after wildcard");
    }

    if (wildcard.methods) {
      const match = compileMethodMatch(
        ctx,
        wildcard.methods,
        [...params, `s.slice(${startIdx + 1}).join('/')`],
        startIdx,
      );
      if (match) {
        code += match;
      }
    }
  }

  return code;
}

function serializeData(ctx: CompilerContext, value: any): string {
  if (ctx.deps) {
    return `d${ctx.deps.push(value)}`;
  }
  if (ctx.opts?.serialize) {
    return ctx.opts.serialize(value);
  }
  if (typeof value?.toJSON === "function") {
    return value.toJSON();
  }
  return JSON.stringify(value);
}
