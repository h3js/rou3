import { ESCAPED_GROUP_PREFIX, fromGroupName, UNNAMED_GROUP_PREFIX } from "./_group-names.ts";
import { NullProtoObj } from "./object.ts";
import type { MatchedRoute, MethodData, Node, RouterContext } from "./types.ts";

/** A compiled single-match lookup (`compileRouter(router)`), like `findRoute`. */
export type CompiledMatch<T = unknown> = (
  method: string,
  path: string,
) => MatchedRoute<T> | undefined;

/** A compiled multi-match lookup (`matchAll: true`), like `findAllRoutes`. */
export type CompiledMatchAll<T = unknown> = (method: string, path: string) => MatchedRoute<T>[];

/** Options of {@link compileRouter}. */
export interface CompileRouterOptions<T = any> {
  /** Return every matching route (least to most specific) instead of the best one. */
  matchAll?: boolean;
  /** Resolve `.` and `..` segments of the path before matching. */
  normalize?: boolean;
  /**
   * Render one route's data as a JavaScript expression (raw code, emitted
   * as is). Defaults to `JSON.stringify`. Only used by
   * {@link compileRouterToString}: `compileRouter` keeps data by reference.
   */
  serialize?: (data: T) => string;
}

/** Options of {@link compileRouterToString}. */
export interface CompileRouterToStringOptions<T = any> extends CompileRouterOptions<T> {
  /**
   * Emit `const <functionName>=<matcher>;` instead of a bare expression.
   */
  functionName?: string;
}

/**
 * @deprecated Use {@link CompileRouterToStringOptions} (or
 * {@link CompileRouterOptions} for `compileRouter`).
 */
export type RouterCompilerOptions<T = any> = CompileRouterToStringOptions<T>;

/**
 * Compiles the router instance into a faster route-matching function.
 *
 * **IMPORTANT:** `compileRouter` requires eval support with `new Function()` in the runtime for JIT compilation (not allowed under a CSP without `unsafe-eval`: use `compileRouterToString` at build time there).
 *
 * The compiled function is a **snapshot** of the router: routes added or removed afterwards are not seen, compile again after changing it. Route data is kept by reference. It returns what `findRoute` returns (with `matchAll: true`, what `findAllRoutes` returns), except that `params` is a plain object where `findRoute`'s has a null prototype.
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
export function compileRouter<T>(
  router: RouterContext<T>,
  opts: CompileRouterOptions<T> & { matchAll: true },
): CompiledMatchAll<T>;
export function compileRouter<T>(
  router: RouterContext<T>,
  opts?: CompileRouterOptions<T> & { matchAll?: false },
): CompiledMatch<T>;
export function compileRouter<T>(
  router: RouterContext<T>,
  opts?: CompileRouterOptions<T>,
): CompiledMatch<T> | CompiledMatchAll<T>;
/**
 * Compiles the router instance into a faster route-matching function.
 *
 * **IMPORTANT:** `compileRouter` requires eval support with `new Function()` in the runtime for JIT compilation (not allowed under a CSP without `unsafe-eval`: use `compileRouterToString` at build time there).
 *
 * The compiled function is a **snapshot** of the router: routes added or removed afterwards are not seen, compile again after changing it. Route data is kept by reference. It returns what `findRoute` returns (with `matchAll: true`, what `findAllRoutes` returns), except that `params` is a plain object where `findRoute`'s has a null prototype.
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
export function compileRouter<T>(
  router: RouterContext<T>,
  opts?: CompileRouterOptions<T>,
): CompiledMatch<T> | CompiledMatchAll<T> {
  const ctx: CompilerContext = { opts: opts || {}, router, data: [] };
  const compiled = compileRouteMatch(ctx);
  if (ctx.data.length < DATA_ARGS_MAX) {
    return new Function(...ctx.data.map((_, i) => `$${i}`), `return(m,p)=>{${compiled}}`)(
      ...ctx.data,
    );
  }
  // Huge routers overflow the engine's formal-parameter/spread-call limits
  // (65535 in V8) — recompile with data refs reading a single array argument
  // instead (`$[N]`, measured ~10% slower per data access, so only when needed).
  const arrayCtx: CompilerContext = { opts: opts || {}, router, data: [], dataArray: true };
  return new Function("$", `return(m,p)=>{${compileRouteMatch(arrayCtx)}}`)(arrayCtx.data);
}

/**
 * Compile the router instance into a compact runnable code (ahead of time, e.g. into a build output).
 *
 * The output is a self-contained JavaScript expression (or a `const <functionName>=…;` statement): no imports, no runtime dependency on rou3, and no `eval` / `new Function()`, so it runs under a strict CSP. It needs ES2018 (named capture groups, object spread). Like `compileRouter`, it is a **snapshot** of the router at compile time.
 *
 * **IMPORTANT:** The exact generated code is **not** stable across rou3 versions: generate it at build time with the installed rou3, don't commit, patch or parse it.
 *
 * **IMPORTANT:** Route data is emitted with `JSON.stringify` (`toJSON()` applies at every depth, as in JSON). Data containing a function, symbol or bigint throws: pass `opts.serialize` to emit each route's data as a JavaScript expression of your own instead.
 *
 * @example
 * import { createRouter, addRoute } from "rou3";
 * import { compileRouterToString } from "rou3/compiler";
 * const router = createRouter();
 * // [add some routes with serializable data]
 * const compilerCode = compileRouterToString(router, { functionName: "findRoute" });
 * // "const findRoute=(m, p) => {}"
 *
 * // Route data as code (e.g. handler imports)
 * compileRouterToString(router, { serialize: (data) => `{handler:${data.importName}}` });
 */
export function compileRouterToString<T>(
  router: RouterContext<T>,
  opts?: CompileRouterToStringOptions<T>,
): string;
/**
 * @deprecated Pass the function name as an option instead:
 * `compileRouterToString(router, { functionName, ...opts })`.
 */
export function compileRouterToString<T>(
  router: RouterContext<T>,
  functionName: string | undefined,
  opts?: CompileRouterToStringOptions<T>,
): string;
/**
 * Compile the router instance into a compact runnable code (ahead of time, e.g. into a build output).
 *
 * The output is a self-contained JavaScript expression (or a `const <functionName>=…;` statement): no imports, no runtime dependency on rou3, and no `eval` / `new Function()`, so it runs under a strict CSP. It needs ES2018 (named capture groups, object spread). Like `compileRouter`, it is a **snapshot** of the router at compile time.
 *
 * **IMPORTANT:** The exact generated code is **not** stable across rou3 versions: generate it at build time with the installed rou3, don't commit, patch or parse it.
 *
 * **IMPORTANT:** Route data is emitted with `JSON.stringify` (`toJSON()` applies at every depth, as in JSON). Data containing a function, symbol or bigint throws: pass `opts.serialize` to emit each route's data as a JavaScript expression of your own instead.
 *
 * @example
 * import { createRouter, addRoute } from "rou3";
 * import { compileRouterToString } from "rou3/compiler";
 * const router = createRouter();
 * // [add some routes with serializable data]
 * const compilerCode = compileRouterToString(router, { functionName: "findRoute" });
 * // "const findRoute=(m, p) => {}"
 *
 * // Route data as code (e.g. handler imports)
 * compileRouterToString(router, { serialize: (data) => `{handler:${data.importName}}` });
 */
export function compileRouterToString<T>(
  router: RouterContext<T>,
  opts?: CompileRouterToStringOptions<T> | string,
  legacyOpts?: CompileRouterToStringOptions<T>,
): string {
  const functionName = typeof opts === "string" ? opts : opts?.functionName;
  if (typeof opts !== "object" || !opts) {
    opts = legacyOpts || {};
  }
  const ctx: CompilerContext = {
    opts,
    router,
    data: [],
    compileToString: true,
  };
  let compiled = `(m,p)=>{${compileRouteMatch(ctx)}}`;
  if (ctx.data.length > 0) {
    const dataCode = `const ${ctx.data.map((v, i) => `$${i}=${v}`).join(",")};`;
    compiled = `/* @__PURE__ */ (() => { ${dataCode} return ${compiled}})()`;
  }
  return functionName ? `const ${functionName}=${compiled};` : compiled;
}

// ------- internal functions -------

// Stay well below the engine's formal-parameter and spread-call limits
// (65535 in V8) — above this, JIT data slots move into a single array arg.
const DATA_ARGS_MAX = 32_000;

interface CompilerContext {
  opts: RouterCompilerOptions;
  router: RouterContext<any>;
  compileToString?: boolean;
  data: string[];
  dataArray?: boolean;
  dataMap?: Map<any, number>;
  regexpMap?: Map<string, number>;
  regexTemps?: number;
  // Some matcher reads a bare `**`'s tail into `_w` (it is also `_`)
  starStarTemp?: boolean;
  // The router has routes with segments after `**`: matches are collected
  // with a rank descriptor each (`k`) and ranked from the end of the path
  rank?: boolean;
  rankMap?: Map<string, number>;
  // Compiling the collector of a single-match router with `rank`: same-node
  // ties keep the order that puts the tree order's pick last
  collector?: boolean;
  // Some matcher reads `t`, whether the path had a trailing slash (a `*`
  // over zero segments, see `matchesZero`)
  slash?: boolean;
}

function compileRouteMatch(ctx: CompilerContext): string {
  const matchAll = ctx.opts?.matchAll;
  ctx.rank = hasSuffixTrie(ctx.router.root);
  let code = compileStaticMatch(ctx);

  let match = compileNode(ctx, ctx.router.root, [], 1, 1);
  if (ctx.rank && !matchAll) {
    // Mirrors findRoute: when a route with segments after `**` may match
    // (a cheap check of the suffix tries), collect every match and rank them
    // from the end of the path. Without a suffix route among them the last
    // match is the tree order's pick, so the check may over-approximate.
    const opts = ctx.opts;
    ctx.opts = { ...opts, matchAll: true };
    ctx.collector = true;
    const all = compileNode(ctx, ctx.router.root, [], 1, 1);
    ctx.opts = opts;
    ctx.collector = false;
    const probe = compileSuffixProbe(ctx, ctx.router.root, 1);
    if (probe !== "false") {
      match = `if(${probe}){let r=[],k=[];${all}r=${rankRef(ctx)}(r.reverse(),k.reverse(),l-1);return r[r.length-1]}${match}`;
    }
  }
  // Empty root node emit an empty bound check
  if (match) {
    // Mirror splitPath(): empty segments are kept, so "/a//" (stripped once
    // to "/a/") has a real empty last segment (#209).
    const tempNames = Array.from({ length: ctx.regexTemps || 0 }, (_, i) => `_m${i}`);
    if (ctx.starStarTemp) tempNames.push("_w");
    const temps = tempNames.length > 0 ? `let ${tempNames.join(",")};` : "";
    code += `let s=p.split("/");let l=s.length;${temps}${match}`;
  }

  if (!code) {
    return ctx.opts?.matchAll ? `return [];` : "";
  }

  // Mirrors `fromGroupName()`: strip the unnamed prefix, or decode an escaped
  // param name (`__` -> `_`, `_h` -> `-`) back to its original form.
  const normalizeHelper = code.includes("_normalizeGroups(")
    ? `const _u=${JSON.stringify(UNNAMED_GROUP_PREFIX)},_e=${JSON.stringify(ESCAPED_GROUP_PREFIX)};const _normalizeGroups=(g)=>{if(!g)return g;for(const k in g){const n=k.startsWith(_u)?k.slice(_u.length):(k.startsWith(_e)?k.slice(_e.length).replace(/__|_h/g,(c)=>c==="__"?"_":"-"):k);if(n!==k){g[n]=g[k];delete g[k]}}return g;};`
    : "";

  const normalizePathHelper = ctx.opts?.normalize
    ? `if(p.includes("/.")){let _r=[];for(let _v of p.split("/")){if(_v===".")continue;if(_v==="..")_r.length>1&&_r.pop();else _r.push(_v)}p=_r.join("/")||"/"}`
    : "";

  // One trailing slash is stripped (#209); root "/" collapses to "" (0
  // segments) so required root wildcards/params (`/**:name`, `/:x`) don't
  // match "/" — matching findRoute/findAllRoutes. A trailing `*` reads
  // whether there was one (`t`).
  const collect = ctx.rank ? `let r=[],k=[];` : `let r=[];`;
  const done = ctx.rank
    ? `return ${rankRef(ctx)}(r.reverse(),k.reverse(),l-1);`
    : "return r.reverse();";
  const strip = ctx.slash
    ? `let t=p.charCodeAt(p.length-1)===47;if(t)p=p.slice(0,-1);`
    : `if(p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);`;
  return `${matchAll ? collect : ""}${normalizeHelper}${normalizePathHelper}${strip}${code}${matchAll ? done : ""}`;
}

// Below this many static paths an `else if` chain of `p === "..."` compares
// beats a map lookup (repeated/interned path strings compare near
// pointer-speed, and dynamic requests miss the whole chain via cheap length
// checks); above it the chain's O(N) scan loses to one hashed lookup — by
// ~2-3x at 20-50 routes with fresh (per-request parsed) path strings.
const STATIC_CHAIN_MAX = 8;

// Same trade-off for a tree node's static children (one segment, not the
// whole path): below this an `else if(s[i]==="...")` chain wins (~10% at 24
// siblings), above it the O(N) scan loses to a null-proto `{segment: index}`
// map + integer switch — measured crossover ~40, switch ~1.4x faster at 64
// siblings and ~2x at 200 (where the chain degrades to interpreter speed,
// and huge chain functions also tier up much more slowly).
const SEGMENT_CHAIN_MAX = 32;

// Static routes (no params) dispatch either through that small chain or a
// single null-prototype map lookup — `{path: {method: data}}` (matchAll:
// `{path: {method: data[]}}`) — kept O(1) in the number of static routes
// (mirrors the interpreter's `ctx.static` fast path). The map lives in a `$N`
// data slot; on method miss the code falls through to the tree lookup like
// the interpreter.
function compileStaticMatch(ctx: CompilerContext): string {
  const matchAll = ctx.opts?.matchAll;

  const entries: [nk: string, node: Node<any>][] = [];
  // Some path has both method-agnostic ("") and method-scoped routes: matchAll
  // must collect both (static entries all weigh the same, the "" ones first)
  let mixed = false;
  for (const key in ctx.router.static) {
    const node = ctx.router.static[key];
    if (node?.methods) {
      // Keys are already in the stripped lookup form (root is ""), mirroring
      // the interpreter's `ctx.static` fast path
      entries.push([key, node]);
      if (node.methods[""]?.length && Object.keys(node.methods).length > 1) {
        mixed = true;
      }
    }
  }

  if (entries.length <= STATIC_CHAIN_MAX) {
    let code = "";
    for (const [nk, node] of entries) {
      const body = compileMethodMatch(ctx, node.methods!, [], -1);
      code += `${code ? "else " : ""}if(p===${JSON.stringify(nk)}){${body}}`;
    }
    return code;
  }

  // JIT mode passes a prebuilt object; AOT mode emits its literal source.
  const jitMap = ctx.compileToString ? undefined : new NullProtoObj();
  let mapCode = "";
  for (const [nk, node] of entries) {
    const jitMethods = jitMap ? new NullProtoObj() : undefined;
    let methodsCode = "";
    for (const method in node.methods) {
      const matchers = node.methods[method];
      if (matchers && matchers.length > 0) {
        if (jitMethods) {
          // findRoute resolves duplicates to the first-registered entry
          jitMethods[method] = matchAll ? matchers.map((m) => m.data) : matchers[0].data;
        } else {
          const refs = matchers.map((m) => serializeData(ctx, m));
          methodsCode += `${JSON.stringify(method)}:${matchAll ? `[${refs.join(",")}]` : refs[0]},`;
        }
      }
    }
    if (jitMethods ? Object.keys(jitMethods).length === 0 : !methodsCode) {
      continue;
    }
    if (jitMap) {
      jitMap[nk] = jitMethods;
    } else {
      mapCode += `${JSON.stringify(nk)}:{__proto__:null,${methodsCode}},`;
    }
  }
  if (jitMap ? Object.keys(jitMap).length === 0 : !mapCode) {
    return "";
  }
  const ref = pushDataSlot(ctx, jitMap ? (jitMap as any) : `{__proto__:null,${mapCode}}`);
  const lookup = `let _n=${ref}[p];`;
  if (!matchAll) {
    return `${lookup}if(_n!==void 0){let _d=_n[m];if(_d===void 0)_d=_n[""];if(_d!==void 0)return {data:_d};}`;
  }
  const push = ctx.rank
    ? `{r.push({data:_a[_i]});k.push(${rankDescriptor(ctx)})}`
    : `r.push({data:_a[_i]});`;
  if (mixed) {
    // Emit order is reversed at the end: the method's entries, then the "" ones
    const loop = `if(_a!==void 0)for(let _i=_a.length-1;_i>=0;_i--)${push}`;
    return `${lookup}if(_n!==void 0){let _a=_n[m];${loop}if(m!==""){_a=_n[""];${loop}}}`;
  }
  return `${lookup}if(_n!==void 0){let _a=_n[m];if(_a===void 0)_a=_n[""];if(_a!==void 0)for(let _i=_a.length-1;_i>=0;_i--)${push}}`;
}

function compileMethodMatch(
  ctx: CompilerContext,
  methods: Record<string, MethodData<any>[] | undefined>,
  params: string[],
  currentIdx: number, // Set to -1 for non-param node
  // Suffix trie node: `l>…` when the `**` still has a segment (for `**:name`)
  suffixGuard?: string,
): string {
  // Emit order: the most specific matcher first. matchAll emits via `r.push`
  // + one final `r.reverse()` (final array least->most specific); the reverse
  // flips emit order, so pre-reverse to keep equal-weight siblings in
  // insertion order (issue #187). Single-match returns on the first hit, so
  // ties stay in insertion order (mirrors findRoute).
  const compile = (matchers: MethodData<any>[]) => {
    const compiled = matchers.map((m) =>
      compileFinalMatch(ctx, m, currentIdx, params, suffixGuard),
    );
    return ctx.opts?.matchAll && !ctx.collector ? compiled.reverse() : compiled;
  };
  const emit = (compiled: { code: string; weight: number }[]) =>
    compiled
      .sort((a, b) => b.weight - a.weight)
      .map((m) => m.code)
      .join("");
  // Method-agnostic ("") entries are siblings of each method's entries (a
  // method-scoped entry never hides them): emitted after them, so on equal
  // weight the method-scoped one is tried first (single-match) and comes last
  // (matchAll), mirroring `methodEntries` / `_selectMatcher`.
  const any = methods[""]?.length ? compile(methods[""]) : undefined;
  let code = "";
  for (const key in methods) {
    const matchers = methods[key];
    if (key !== "" && matchers && matchers.length > 0) {
      const own = compile(matchers);
      const body = emit(any ? own.concat(any) : own);
      code += `${code ? "else " : ""}if(m===${JSON.stringify(key)}){${body}}`;
    }
  }
  const fallback = any ? emit(any) : "";
  return fallback ? (code ? `${code}else{${fallback}}` : fallback) : code;
}

function compileFinalMatch(
  ctx: CompilerContext,
  data: MethodData<any>,
  currentIdx: number,
  params: string[],
  suffixGuard?: string,
): { code: string; weight: number } {
  let ret = `{data:${serializeData(ctx, data)}`;

  const conditions: string[] = [];
  // A `**:name` before the suffix must take a segment (weighs one point, as
  // in `collectSuffix`)
  if (suffixGuard && data.paramsMap!.some(([index, , optional]) => index < 0 && !optional)) {
    conditions.push(suffixGuard);
  }
  // Presence guards (segment-count checks) are not specificity constraints, so
  // they must not raise `weight` — otherwise an optional `**` tail ties with a
  // required `**:name` and the weight-sorted emit order flips (#186).
  let guardConditions = 0;

  // Add param properties
  const { paramsMap } = data;
  if (paramsMap && paramsMap.length > 0) {
    // A catch-all ending the route (`currentIdx` is where it starts)
    const lastParam = paramsMap[paramsMap.length - 1];
    if (currentIdx !== -1) {
      if (!lastParam[2]) {
        // It needs a segment (a `**:name`), or, a `*`, takes none after a
        // trailing slash (see `matchesZero`)
        if ((lastParam[1] as string) < ":") {
          ctx.slash = true;
          conditions.push(`(l>${currentIdx}||t&&l===${currentIdx})`);
        } else {
          conditions.push(`l>${currentIdx}`);
        }
      } else if (lastParam[0] < 0 && paramsMap.length > 1) {
        // Optional `**` tail, but the required leading param(s) must be present
        conditions.push(`l>${currentIdx - 1}`);
        guardConditions++;
      }
    }

    // Regex params run each regex once: group names are resolved from the
    // regex source at compile time (including the `__rou3_unnamed_N` -> "N"
    // renaming), so params read `.groups.<name>` directly instead of spreading
    // `.groups` through a runtime normalization helper. For a whole-segment
    // group (`^(?<name>...)$`) the group always equals the tested segment, so
    // `.test()` suffices and no `exec()` is emitted at all. Regexes live in
    // `$N` data slots — an inline literal would allocate a fresh RegExp on
    // every evaluation (ES2015+ semantics), measured ~2-6% per match.
    let paramsCode = "";
    // Where a bare `**`'s properties are in `paramsCode`: they are unset over
    // zero segments (see `getMatchParams`)
    let starStar: [start: number, end: number] | undefined;
    // A `*` inside a segment is split around a `**` (see `splitStar`): its
    // pieces' values, joined by `/` into one property where the first one is
    // (`\0`), the `**`'s only where it has a segment
    const join = paramsMap.find((map) => map[4] && map[0] < 0)?.[1];
    const pieces: [value: string, nonEmpty?: string][] = [];
    const prop = (key: string, value: string, nonEmpty?: string) => {
      if (key !== join) return `${propKey(key)}:${value},`;
      pieces.push([value, nonEmpty]);
      return pieces.length > 1 ? "" : `${propKey(key)}:\0,`;
    };
    let tmpCount = 0;
    for (let i = 0; i < paramsMap.length; i++) {
      const map = paramsMap[i];
      if (typeof map[1] === "string") {
        let code = prop(map[1], params[i], map[4] ? suffixGuard || `l>${currentIdx}` : undefined);
        if (map[0] < 0 && map[2] && !map[4]) {
          // Also `_` (deprecated alias): the tail is computed once, into `_w`
          code = `${propKey(map[1])}:_w=${params[i]},_:_w,`;
          ctx.starStarTemp = true;
          starStar = [paramsCode.length, paramsCode.length + code.length];
        }
        paramsCode += code;
        // A `:name` / `**:name` needs a value (see `emptyParam`)
        const guard = nonEmptyGuard(map, params[i], data.suffix);
        if (guard) {
          conditions.push(guard);
          // A catch-all's weighs a point (a `**:name` outweighs a `*`)
          if (map[0] >= 0) guardConditions++;
        }
        continue;
      }
      // `params[i]` is the same `s[<idx>]` expression the regex condition must
      // test (regex params are always single-segment param nodes).
      const regexp = serializeRegExp(ctx, map[1]);
      const groups = scanRegExpGroups(map[1].source);
      if (!groups) {
        // Unrecognized group name — fall back to runtime normalization
        const tmp = `_m${tmpCount++}`;
        conditions.push(`(${tmp}=${regexp}.exec(${params[i]}))!==null`);
        paramsCode += `..._normalizeGroups(${tmp}.groups),`;
      } else if (groups.names.length === 0) {
        conditions.push(`${regexp}.test(${params[i]})`);
      } else if (groups.whole) {
        conditions.push(`${regexp}.test(${params[i]})`);
        paramsCode += prop(fromGroupName(groups.names[0]), params[i]);
      } else {
        const tmp = `_m${tmpCount++}`;
        conditions.push(`(${tmp}=${regexp}.exec(${params[i]}))!==null`);
        // An optional param ending the segment (`*-:x?` is `…(?:(?<x>…))?$`)
        // gets no key when absent, as in the interpreter
        const optional = map[1].source.endsWith("))?$") && groups.names[groups.names.length - 1];
        for (const name of groups.names) {
          const key = fromGroupName(name);
          paramsCode +=
            name === optional
              ? `...(${tmp}.groups.${name}!==void 0&&{${propKey(key)}:${tmp}.groups.${name}}),`
              : prop(key, `${tmp}.groups.${name}`);
        }
      }
    }
    if (tmpCount > (ctx.regexTemps || 0)) {
      ctx.regexTemps = tmpCount;
    }
    if (pieces.length > 0) {
      // `pre` + `/**` + `/post` (`**/post`: no `/` after an empty `**`)
      let value = "";
      for (let k = 0; k < pieces.length; k++) {
        const [piece, nonEmpty] = pieces[k];
        value += nonEmpty
          ? k
            ? `+(${nonEmpty}?"/"+${piece}:"")`
            : `(${nonEmpty}?${piece}+"/":"")`
          : k === 0
            ? piece
            : k === 1 && pieces[0][1]
              ? `+${piece}`
              : `+"/"+${piece}`;
      }
      paramsCode = paramsCode.replace("\0", value);
    }

    // The `**` has a segment where it starts before the end of the path (of
    // its prefix, before a suffix: `suffixGuard`)
    ret = starStar
      ? `${suffixGuard || `l>${currentIdx}`}?${ret},params:{${paramsCode}}}:${ret},params:{${paramsCode.slice(0, starStar[0])}${paramsCode.slice(starStar[1])}}`
      : `${ret},params:{${paramsCode}}`;
  }
  ret += "}";

  const push = ctx.rank
    ? `{r.push(${ret});k.push(${rankDescriptor(ctx, data)})}`
    : `r.push(${ret});`;
  const code =
    (conditions.length > 0 ? `if(${conditions.join("&&")})` : "") +
    (ctx.opts?.matchAll ? push : `return ${ret};`);

  return { code, weight: conditions.length - guardConditions };
}

function compileNode(
  ctx: CompilerContext,
  node: Node<any>,
  params: string[],
  currentIdx: number,
  // Byte length of the static prefix (including its trailing "/"), or -1 once
  // a param segment makes the offset unknown at compile time.
  staticPrefixLen: number,
): string {
  let code = "",
    hasIf = false;

  // A route ending in a param (a catch-all ending one is on a wildcard node)
  if (node.methods && params.length > 0) {
    const match = compileMethodMatch(ctx, node.methods, params, -1);
    if (match) {
      code += `if(l===${currentIdx}){${match}}`;
      hasIf = true;
    }
  }

  if (node.static) {
    const children: [key: string, match: string][] = [];
    for (const key in node.static) {
      const match = compileNode(
        ctx,
        node.static[key],
        params,
        currentIdx + 1,
        staticPrefixLen < 0 ? -1 : staticPrefixLen + key.length + 1,
      );
      if (match) {
        children.push([key, match]);
      }
    }
    if (children.length > SEGMENT_CHAIN_MAX) {
      // Wide fan-outs dispatch through a hoisted null-proto `{segment: index}`
      // map + dense integer switch — O(1) vs the chain's O(N) scan (see
      // SEGMENT_CHAIN_MAX). The `l>` bound check is mandatory here: an
      // out-of-bounds `s[i]` is `undefined`, which the map lookup would
      // coerce to the key "undefined" (the chain's `===` compare was immune).
      const jitMap = ctx.compileToString ? undefined : new NullProtoObj();
      let mapCode = "";
      let cases = "";
      for (const [i, [key, match]] of children.entries()) {
        if (jitMap) {
          jitMap[key] = i;
        } else {
          mapCode += `${propKey(key)}:${i},`;
        }
        cases += `case ${i}:{${match}}break;`;
      }
      const ref = pushDataSlot(ctx, jitMap ? (jitMap as any) : `{__proto__:null,${mapCode}}`);
      code += `${hasIf ? "else " : ""}if(l>${currentIdx}){switch(${ref}[s[${currentIdx}]]){${cases}}}`;
      hasIf = true;
    } else if (children.length > 0) {
      let staticCode = "";
      const notNeedBoundCheck = hasIf;
      for (const [key, match] of children) {
        staticCode += `${hasIf ? "else " : ""}if(s[${currentIdx}]===${JSON.stringify(key)}){${match}}`;
        hasIf = true;
      }
      code += notNeedBoundCheck ? staticCode : `if(l>${currentIdx}){${staticCode}}`;
    }
  }

  if (node.param) {
    code += compileNode(
      ctx,
      node.param,
      // Prevent deopt
      params.concat(`s[${currentIdx}]`),
      currentIdx + 1,
      -1,
    );
  }

  if (node.wildcard) {
    const { wildcard } = node;
    // Routes with segments after `**` are only collected (matchAll, or the
    // ranked single-match path, see compileRouteMatch)
    if (wildcard.suffix && ctx.opts?.matchAll) {
      code += compileSuffix(ctx, wildcard.suffix, params, currentIdx, staticPrefixLen, 0, [], 0);
    }

    if (wildcard.methods) {
      // With an all-static prefix the tail is `p.slice(K)` at a constant byte
      // offset (an O(1) substring view) instead of allocating a segment slice
      // plus a join. Valid because the split prologue keeps every segment of
      // `p`, so both forms read the same characters.
      const tail =
        staticPrefixLen < 0 ? `s.slice(${currentIdx}).join('/')` : `p.slice(${staticPrefixLen})`;
      code += compileMethodMatch(ctx, wildcard.methods, params.concat(tail), currentIdx);
    }
  }

  return code;
}

/**
 * A wildcard's `suffix` trie (the segments after `**`, last segment first),
 * matched from the end of the path: at depth `j` the next segment is
 * `s[l-j-1]`, and it must come after the `**` start `c` (`l>c+j`). Emits
 * static children, then the param child, then the node's own routes, so the
 * final (reversed) order is `collectSuffix`'s. With an all-static suffix and
 * prefix the `**` tail is a constant-offset `p.slice`.
 */
function compileSuffix(
  ctx: CompilerContext,
  node: Node<any>,
  params: string[],
  c: number,
  staticPrefixLen: number,
  j: number,
  suffixParams: string[],
  suffixLen: number,
): string {
  let code = "";
  const guard = `l>${c + j}`;
  if (node.static) {
    let chain = "";
    for (const key in node.static) {
      const match = compileSuffix(
        ctx,
        node.static[key],
        params,
        c,
        staticPrefixLen,
        j + 1,
        suffixParams,
        suffixLen < 0 ? -1 : suffixLen + key.length + 1,
      );
      if (match) {
        chain += `${chain ? "else " : ""}if(s[l-${j + 1}]===${JSON.stringify(key)}){${match}}`;
      }
    }
    if (chain) {
      code += `if(${guard}){${chain}}`;
    }
  }
  if (node.param) {
    const match = compileSuffix(
      ctx,
      node.param,
      params,
      c,
      staticPrefixLen,
      j + 1,
      [`s[l-${j + 1}]`, ...suffixParams],
      -1,
    );
    if (match) {
      code += `if(${guard}){${match}}`;
    }
  }
  if (node.methods) {
    const tail =
      staticPrefixLen < 0 || suffixLen < 0
        ? `s.slice(${c},l-${j}).join('/')`
        : `p.slice(${staticPrefixLen},p.length-${suffixLen})`;
    code += compileMethodMatch(ctx, node.methods, params.concat(tail, suffixParams), -1, guard);
  }
  return code;
}

/**
 * A cheap check that some route with segments after `**` may match: the
 * static/param structure of the tree down to each suffix trie, and of the
 * trie down to a node with routes for the method, whose regex params after
 * the `**` pass (no `**:name` or prefix regex checks).
 */
function compileSuffixProbe(ctx: CompilerContext, node: Node<any>, c: number): string {
  const terms: string[] = [];
  if (node.wildcard?.suffix) {
    terms.push(compileTrieProbe(ctx, node.wildcard.suffix, c, 0));
  }
  for (const key in node.static) {
    if (node.static[key].hasSuffix) {
      const probe = compileSuffixProbe(ctx, node.static[key], c + 1);
      terms.push(`l>${c}&&s[${c}]===${JSON.stringify(key)}&&(${probe})`);
    }
  }
  if (node.param?.hasSuffix) {
    terms.push(`l>${c}&&(${compileSuffixProbe(ctx, node.param, c + 1)})`);
  }
  return terms.filter((term) => !term.endsWith("(false)")).join("||") || "false";
}

function compileTrieProbe(ctx: CompilerContext, node: Node<any>, c: number, j: number): string {
  const terms: string[] = [];
  for (const key in node.methods) {
    const entries = node.methods[key];
    if (!entries?.length) continue;
    // A route passes where its regex params after the `**` do: suffix
    // position `q` (route index `w + 1 + q`) is `s[l-j+q]` at depth `j`.
    const routes = entries.map((m) => {
      const w = m.suffix![0];
      const tests: string[] = [];
      for (let i = w + 1; i < m.paramsRegexp.length; i++) {
        if (m.paramsRegexp[i]) {
          tests.push(`${serializeRegExp(ctx, m.paramsRegexp[i])}.test(s[l-${j + w + 1 - i}])`);
        }
      }
      return tests.join("&&");
    });
    const any = routes.includes("") ? "" : routes.join("||");
    terms.push(key ? `m===${JSON.stringify(key)}${any ? `&&(${any})` : ""}` : any || "true");
  }
  const children: string[] = [];
  for (const key in node.static) {
    const probe = compileTrieProbe(ctx, node.static[key], c, j + 1);
    if (probe !== "false") {
      children.push(`s[l-${j + 1}]===${JSON.stringify(key)}&&(${probe})`);
    }
  }
  if (node.param) {
    const probe = compileTrieProbe(ctx, node.param, c, j + 1);
    if (probe !== "false") {
      children.push(probe);
    }
  }
  if (children.length > 0) {
    terms.push(`l>${c + j}&&(${children.join("||")})`);
  }
  return terms.join("||") || "false";
}

function hasSuffixTrie(node: Node<any>): boolean {
  if (!node.hasSuffix) {
    return false;
  }
  if (node.wildcard?.suffix) {
    return true;
  }
  for (const key in node.static) {
    if (hasSuffixTrie(node.static[key])) {
      return true;
    }
  }
  return !!node.param && hasSuffixTrie(node.param);
}

// Ranks collected matches from the end of the path (mirrors `rankFromEnd` in
// operations/_suffix.ts), only when a route with segments after `**` is among
// them. `k` holds one `[** index or -1, suffix length, ...(param index,
// kind)]` descriptor per match; a kind is 3 literal, 2 regex, 0 param or `**`.
// Positions both `**` cover (`o` up to `h`) compare equal and are skipped.
const RANK = `(r,k,n)=>{if(!k.some((d)=>d[1]>0))return r;const K=(d,p)=>{const e=n-d[1];if(d[0]>=0&&p>=d[0]&&p<e)return 0;for(let i=2;i<d.length;i+=2)if((d[1]&&d[i]>d[0]?d[i]-d[0]-1+e:d[i])===p)return d[i+1];return 3};return r.map((_,i)=>i).sort((a,b)=>{const A=k[a],B=k[b],o=Math.max(A[0]<0?n:A[0],B[0]<0?n:B[0]),h=n-Math.max(A[1],B[1]);for(let p=n-1;p>=0;p--){if(p<h&&p>=o){p=o;continue}const x=K(A,p)-K(B,p);if(x!==0)return x}return 0}).map((i)=>r[i])}`;

function rankRef(ctx: CompilerContext): string {
  const rankMap = (ctx.rankMap ??= new Map());
  let index = rankMap.get(RANK);
  if (index === undefined) {
    index = ctx.data.push(ctx.compileToString ? RANK : new Function(`return ${RANK}`)()) - 1;
    rankMap.set(RANK, index);
  }
  return dataRef(ctx, index);
}

function rankDescriptor(ctx: CompilerContext, data?: MethodData<any>): string {
  const descriptor = [-1, data?.suffix ? data.suffix[1] : 0];
  for (const [index, name] of data?.paramsMap || []) {
    if (index < 0) {
      descriptor[0] = -(index + 1);
    } else {
      descriptor.push(index, typeof name === "string" ? 0 : 2);
    }
  }
  const key = JSON.stringify(descriptor);
  const rankMap = (ctx.rankMap ??= new Map());
  let slot = rankMap.get(key);
  if (slot === undefined) {
    slot = ctx.data.push(ctx.compileToString ? key : (descriptor as any)) - 1;
    rankMap.set(key, slot);
  }
  return dataRef(ctx, slot);
}

/**
 * Statically resolve the named capture groups of a param regexp source so the
 * compiled matcher can read `.groups.<name>` directly. Constraint bodies are
 * opaque user regex, so the scan is escape- and character-class-aware and may
 * find user-defined named groups nested inside them.
 *
 * Returns `undefined` when a group name can't safely be emitted as a `.name`
 * property access (the caller falls back to the exec+spread path). `whole` is
 * set when the source is exactly `^(?<name>...)$` — the group then always
 * equals the matched segment, so no `exec()` is needed at all.
 */
function scanRegExpGroups(source: string): { names: string[]; whole: boolean } | undefined {
  const names: string[] = [];
  const wholeCandidate = source.charCodeAt(0) === 94 /* `^` */ && source.startsWith("(?<", 1);
  let i = 0;
  let depth = 0;
  let firstGroupEnd = -1;
  while (i < source.length) {
    const c = source.charCodeAt(i);
    if (c === 92 /* `\` */) {
      i += 2;
    } else if (c === 91 /* `[` */) {
      // Character class: `(` / `)` inside are literals. The very first `]`
      // closes it, even immediately (`[]` is a valid empty class in JS).
      i++;
      while (i < source.length && source.charCodeAt(i) !== 93 /* `]` */) {
        i += source.charCodeAt(i) === 92 /* `\` */ ? 2 : 1;
      }
      i++;
    } else if (c === 40 /* `(` */) {
      depth++;
      // `(?<name>` — but not the look-behinds `(?<=` / `(?<!`
      if (source.startsWith("(?<", i) && source[i + 3] !== "=" && source[i + 3] !== "!") {
        const end = source.indexOf(">", i + 3);
        const name = end === -1 ? "" : source.slice(i + 3, end);
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
          return undefined; // e.g. unicode group name — not a safe `.name` access
        }
        if (!names.includes(name)) {
          names.push(name); // duplicate names (across alternatives) share one key
        }
        i = end + 1;
      } else {
        i++;
      }
    } else if (c === 41 /* `)` */) {
      depth--;
      if (depth === 0 && firstGroupEnd === -1) {
        firstGroupEnd = i;
      }
      i++;
    } else {
      i++;
    }
  }
  return {
    names,
    // The group opened at index 1 must close at `length - 2` (so it is not
    // quantified and has no siblings) with only the `$` anchor after it.
    whole:
      wholeCandidate &&
      names.length === 1 &&
      firstGroupEnd === source.length - 2 &&
      source.charCodeAt(source.length - 1) === 36 /* `$` */,
  };
}

function serializeData(ctx: CompilerContext, entry: MethodData<any>): string {
  let value = entry.data;
  if (ctx.compileToString) {
    value = ctx.opts.serialize ? ctx.opts.serialize(value) : toJSONCode(value, entry.route);
  }
  // Dedupe via a Map instead of `indexOf` (O(N²) across routes)
  const dataMap = (ctx.dataMap ??= new Map());
  let index = dataMap.get(value);
  if (index === undefined) {
    index = ctx.data.push(value) - 1;
    dataMap.set(value, index);
  }
  return dataRef(ctx, index);
}

/**
 * Default AOT data serializer: standard `JSON.stringify` (`toJSON()` applies
 * at every depth), which is also a valid JS expression. Throws instead of
 * emitting something that silently differs from the data: a function, symbol
 * or bigint anywhere (dropped, `undefined` or a raw `TypeError`). Other
 * objects follow JSON (a `Map` becomes `{}`). Compile time only.
 */
function toJSONCode(value: unknown, route: string): string {
  let code: string | undefined;
  try {
    code = JSON.stringify(value, assertJSONValue);
  } catch (error) {
    code = undefined;
    if (error !== NOT_JSON) {
      throw notJSONError(route, error); // e.g. a circular reference
    }
  }
  if (code === undefined) {
    throw notJSONError(route);
  }
  return code;
}

const NOT_JSON = /* @__PURE__ */ Symbol("rou3:not-json");

// `JSON.stringify` replacer: sees every value after its `toJSON()`
function assertJSONValue(_key: string, value: unknown): unknown {
  const type = typeof value;
  if (type === "function" || type === "symbol" || type === "bigint") {
    throw NOT_JSON;
  }
  return value;
}

function notJSONError(route: string, cause?: unknown): Error {
  return new Error(
    `rou3: route data for ${JSON.stringify(route)} is not JSON-serializable, pass opts.serialize to emit it as code`,
    cause === undefined ? undefined : { cause },
  );
}

// Data slots hold RegExp objects too (JIT: the object itself, AOT: its
// literal source), deduped by source+flags in a map separate from `dataMap`
// so a regex can never collide with an equal-looking string data value.
function serializeRegExp(ctx: CompilerContext, value: RegExp): string {
  const key = value.toString();
  const regexpMap = (ctx.regexpMap ??= new Map());
  let index = regexpMap.get(key);
  if (index === undefined) {
    index = ctx.data.push(ctx.compileToString ? key : (value as any)) - 1;
    regexpMap.set(key, index);
  }
  return dataRef(ctx, index);
}

function pushDataSlot(ctx: CompilerContext, value: any): string {
  return dataRef(ctx, ctx.data.push(value) - 1);
}

function dataRef(ctx: CompilerContext, index: number): string {
  return ctx.dataArray ? `$[${index}]` : `$${index}`;
}

// Object-literal property key. A literal `"__proto__":` property is the
// prototype setter, not a data property (the param/segment would silently
// vanish from the emitted object) — only that one name needs the computed
// form, so every other key stays byte-identical to the plain `JSON.stringify`.
function propKey(name: string): string {
  return name === "__proto__" ? '["__proto__"]' : JSON.stringify(name);
}

/**
 * The condition under which param `map` (read as `param`) has a value, where
 * it needs one (mirrors `emptyParam` in operations/_utils.ts): a `:name`'s
 * segment is not empty, and a `**:name` (`:name+`, `:name*`) takes two
 * segments or more, or one that is not empty (a `**` and a `*` may capture
 * `""`). Its `**` starts at `s[c]` and `n` segments follow it.
 */
function nonEmptyGuard(
  [index, name, optional, empty]: NonNullable<MethodData["paramsMap"]>[number],
  param: string,
  suffix: MethodData["suffix"],
): string | undefined {
  if (index >= 0) {
    return (name as string).charCodeAt(0) > 57 /* not a digit */ ? param : undefined;
  }
  if (optional || empty) {
    return;
  }
  const c = ~index + 1;
  return `(l>${c + (suffix ? suffix[1] : 0) + 1}||s[${c}])`;
}
