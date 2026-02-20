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
  const ctx: CompilerContext = { opts: opts || {}, router, data: [] };
  const compiled = compileRouteMatch(ctx);
  return new Function(
    ...ctx.data!.map((_, i) => `$${i}`),
    `return(m,p)=>{${compiled}}`,
  )(...ctx.data!);
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
  const ctx: CompilerContext = {
    opts: opts || {},
    router,
    data: [],
    compileToString: true,
  };
  let compiled = `(m,p)=>{${compileRouteMatch(ctx)}}`;
  if (ctx.data.length > 0) {
    const dataCode = `const ${ctx.data.map((v, i) => `$${i}=${v}`).join(",")};`;
    compiled = `/* @__PURE__ */ (() => { ${dataCode}; return ${compiled}})()`;
  }
  return functionName ? `const ${functionName}=${compiled};` : compiled;
}

// ------- internal functions -------

interface CompilerContext {
  opts: RouterCompilerOptions;
  router: RouterContext<any>;
  compileToString?: boolean;
  data: string[];
}

function compileRouteMatch(ctx: CompilerContext): string {
  let code = "";

  {
    let hasIf = false;
    for (const key in ctx.router.static) {
      const node = ctx.router.static[key];
      if (node?.methods) {
        code += `${hasIf ? "else " : ""}if(p===${JSON.stringify(key.replace(/\/$/, "") || "/")}){${compileMethodMatch(ctx, node.methods, [], -1)}}`;
        hasIf = true;
      }
    }
  }

  const match = compileNode(ctx, ctx.router.root, [], 0);
  // Empty root node emit an empty bound check
  if (match) {
    code += `let s=p.split("/"),l=s.length;${match}`;
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
    const matchers = methods[key];
    if (matchers && matchers.length > 0) {
      if (key !== "")
        code += `if(m==="${key}")${matchers.length > 1 ? "{" : ""}`;
      const _matchers = matchers
        .map((m) => compileFinalMatch(ctx, m, currentIdx, params))
        .sort((a, b) => b.weight - a.weight);
      for (const matcher of _matchers) {
        code += matcher.code;
      }
      if (key !== "") code += matchers.length > 1 ? "}" : "";
    }
  }
  return code;
}

function compileFinalMatch(
  ctx: CompilerContext,
  data: MethodData<any>,
  currentIdx: number,
  params: string[],
): { code: string; weight: number } {
  let ret = `{data:${serializeData(ctx, data.data)}`;

  const conditions: string[] = [];

  // Add param properties
  const { paramsMap, paramsRegexp } = data;
  if (paramsMap && paramsMap.length > 0) {
    // Check for optional end parameters
    const required = !paramsMap[paramsMap.length - 1][2] && currentIdx !== -1;
    if (required) {
      conditions.push(`l>${currentIdx}`);
    }
    for (let i = 0; i < paramsRegexp.length; i++) {
      const regexp = paramsRegexp[i];
      if (!regexp) {
        continue;
      }
      conditions.push(`${regexp.toString()}.test(s[${i + 1}])`);
    }

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

  const code =
    (conditions.length > 0 ? `if(${conditions.join("&&")})` : "") +
    (ctx.opts?.matchAll ? `r.unshift(${ret}});` : `return ${ret}};`);

  return { code, weight: conditions.length };
}

function compileNode(
  ctx: CompilerContext,
  node: Node<any>,
  params: string[],
  startIdx: number,
): string {
  const hasLastOptionalParam = node.key === "*";
  let code = "",
    hasIf = false;

  if (node.methods && params.length > 0) {
    const match = compileMethodMatch(
      ctx,
      node.methods,
      params,
      hasLastOptionalParam ? startIdx : -1,
    );
    if (match) {
      code += `if(l===${startIdx + 1}${hasLastOptionalParam ? `||l===${startIdx}` : ""}){${match}}`;
      hasIf = true;
    }
  }

  if (node.static) {
    let staticCode = "";
    const notNeedBoundCheck = hasIf;

    for (const key in node.static) {
      const match = compileNode(ctx, node.static[key], params, startIdx + 1);
      if (match) {
        staticCode += `${hasIf ? "else " : ""}if(s[${startIdx + 1}]===${JSON.stringify(key)}){${match}}`;
        hasIf = true;
      }
    }

    if (staticCode)
      code += notNeedBoundCheck
        ? staticCode
        : `if(l>${startIdx + 1}){${staticCode}}`;
  }

  if (node.param) {
    code += compileNode(
      ctx,
      node.param,
      params.concat(`s[${startIdx + 1}]`),
      startIdx + 1,
    );
  }

  if (node.wildcard) {
    const { wildcard } = node;
    if (wildcard.static || wildcard.param || wildcard.wildcard) {
      throw new Error("Compiler mode does not support patterns after wildcard");
    }

    if (wildcard.methods) {
      code += compileMethodMatch(
        ctx,
        wildcard.methods,
        params.concat(`s.slice(${startIdx + 1}).join('/')`),
        startIdx,
      );
    }
  }

  return code;
}

function serializeData(ctx: CompilerContext, value: any): string {
  if (ctx.compileToString) {
    if (ctx.opts?.serialize) {
      value = ctx.opts.serialize(value);
    } else if (typeof value?.toJSON === "function") {
      value = value.toJSON();
    } else {
      value = JSON.stringify(value);
    }
  }
  let index = ctx.data.indexOf(value);
  if (index === -1) {
    ctx.data.push(value);
    index = ctx.data.length - 1;
  }
  return `$${index}`;
}
