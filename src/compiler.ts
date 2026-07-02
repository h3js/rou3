import { UNNAMED_GROUP_PREFIX } from "./_segment-wildcards.ts";
import type { MatchedRoute, MethodData, Node, RouterContext } from "./types.ts";

export interface RouterCompilerOptions<T = any> {
  matchAll?: boolean;
  normalize?: boolean;
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
export function compileRouter<T, O extends RouterCompilerOptions<T> = RouterCompilerOptions<T>>(
  router: RouterContext<T>,
  opts?: O,
): (
  method: string,
  path: string,
) => O["matchAll"] extends true ? MatchedRoute<T>[] : MatchedRoute<T> | undefined {
  const ctx: CompilerContext = { opts: opts || {}, router, data: [] };
  const compiled = compileRouteMatch(ctx);
  return new Function(...ctx.data!.map((_, i) => `$${i}`), `return(m,p)=>{${compiled}}`)(
    ...ctx.data!,
  );
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
        // Root "/" collapses to "" after the trailing-slash strip, but the once-
        // stripped doubled slash "//" reaches here as "/", so root matches both
        // (mirrors the interpreter's `ctx.static` fast path).
        const nk = key.replace(/\/$/, "");
        const cond = nk === "" ? `(p===""||p==="/")` : `p===${JSON.stringify(nk)}`;
        code += `${hasIf ? "else " : ""}if(${cond}){${compileMethodMatch(ctx, node.methods, [], -1)}}`;
        hasIf = true;
      }
    }
  }

  const match = compileNode(ctx, ctx.router.root, [], 1);
  // Empty root node emit an empty bound check
  if (match) {
    // Mirror splitPath(): drop a trailing empty segment so "//", "/a//" etc.
    // count segments like the interpreter (the raw-stripped `p` still feeds the
    // ctx.static fast path above, which matches on the un-split string).
    code += `let s=p.split("/");if(s.length>1&&s[s.length-1]==="")s.pop();let l=s.length;${match}`;
  }

  if (!code) {
    return ctx.opts?.matchAll ? `return [];` : "";
  }

  const normalizeHelper = code.includes("_normalizeGroups(")
    ? `const _prefix=${JSON.stringify(UNNAMED_GROUP_PREFIX)},_prefixLen=${UNNAMED_GROUP_PREFIX.length};const _normalizeGroups=(g)=>{if(!g)return g;for(const k in g){if(k.startsWith(_prefix)){g[k.slice(_prefixLen)]=g[k];delete g[k]}}return g;};`
    : "";

  const normalizePathHelper = ctx.opts?.normalize
    ? `if(p.includes("/.")){let _r=[];for(let _v of p.split("/")){if(_v===".")continue;_v===".."&&_r.length>1?_r.pop():_r.push(_v)}p=_r.join("/")||"/"}`
    : "";

  // Trailing slash is stripped; root "/" collapses to "" (0 segments) so its
  // split has no phantom trailing segment and required root wildcards/params
  // (`/**:name`, `/:x`) don't match "/" — matching findRoute/findAllRoutes.
  return `${ctx.opts?.matchAll ? `let r=[];` : ""}${normalizeHelper}${normalizePathHelper}if(p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);${code}${ctx.opts?.matchAll ? "return r;" : ""}`;
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
      if (key !== "") code += `if(m==="${key}")${matchers.length > 1 ? "{" : ""}`;
      // Sort descending by weight and emit via `r.unshift`, so the final array
      // is least->most specific. `unshift` reverses emit order, so reverse
      // first to keep equal-weight siblings in insertion order (issue #187).
      const _matchers = matchers
        .map((m) => compileFinalMatch(ctx, m, currentIdx, params))
        .reverse()
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
  // Presence guards (segment-count checks) are not specificity constraints, so
  // they must not raise `weight` — otherwise an optional `**` tail ties with a
  // required `**:name` and the weight-sort/`unshift` ordering flips (#186).
  let guardConditions = 0;

  // Add param properties
  const { paramsMap, paramsRegexp } = data;
  if (paramsMap && paramsMap.length > 0) {
    // Check for optional end parameters
    const lastParam = paramsMap[paramsMap.length - 1];
    if (currentIdx !== -1) {
      if (!lastParam[2]) {
        // Last segment is required (a param or a `**:name` wildcard)
        conditions.push(`l>${currentIdx}`);
      } else if (lastParam[0] < 0 && paramsMap.length > 1) {
        // Optional `**` tail, but the required leading param(s) must be present
        conditions.push(`l>${currentIdx - 1}`);
        guardConditions++;
      }
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
          : `..._normalizeGroups((${map[1].toString()}.exec(${params[i]}))?.groups),`;
    }
    ret += "}";
  }

  const code =
    (conditions.length > 0 ? `if(${conditions.join("&&")})` : "") +
    (ctx.opts?.matchAll ? `r.unshift(${ret}});` : `return ${ret}};`);

  return { code, weight: conditions.length - guardConditions };
}

function compileNode(
  ctx: CompilerContext,
  node: Node<any>,
  params: string[],
  currentIdx: number,
): string {
  const hasLastOptionalParam = node.key === "*";
  let code = "",
    hasIf = false;

  if (node.methods && params.length > 0) {
    const match = compileMethodMatch(
      ctx,
      node.methods,
      params,
      hasLastOptionalParam ? currentIdx - 1 : -1,
    );
    if (match) {
      code += `if(l===${currentIdx}${hasLastOptionalParam ? `||l===${currentIdx - 1}` : ""}){${match}}`;
      hasIf = true;
    }
  }

  if (node.static) {
    let staticCode = "";
    const notNeedBoundCheck = hasIf;

    for (const key in node.static) {
      const match = compileNode(ctx, node.static[key], params, currentIdx + 1);
      if (match) {
        staticCode += `${hasIf ? "else " : ""}if(s[${currentIdx}]===${JSON.stringify(key)}){${match}}`;
        hasIf = true;
      }
    }

    if (staticCode) code += notNeedBoundCheck ? staticCode : `if(l>${currentIdx}){${staticCode}}`;
  }

  if (node.param) {
    code += compileNode(
      ctx,
      node.param,
      // Prevent deopt
      params.concat(`s[${currentIdx}]`),
      currentIdx + 1,
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
        params.concat(`s.slice(${currentIdx}).join('/')`),
        currentIdx,
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
