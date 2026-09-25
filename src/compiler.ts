import { ESCAPED_GROUP_PREFIX, fromGroupName, UNNAMED_GROUP_PREFIX } from "./_group-names.ts";
import { NullProtoObj } from "./object.ts";
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
  // The router has routes with segments after `**`: matches are collected
  // with a rank descriptor each (`k`) and ranked from the end of the path
  rank?: boolean;
  rankMap?: Map<string, number>;
  // Compiling the collector of a single-match router with `rank`: same-node
  // ties keep the order that puts the tree order's pick last
  collector?: boolean;
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
    match = `if(${compileSuffixProbe(ctx.router.root, 1)}){let r=[],k=[];${all}r=${rankRef(ctx)}(r.reverse(),k.reverse(),l-1);return r[r.length-1]}${match}`;
  }
  // Empty root node emit an empty bound check
  if (match) {
    // Mirror splitPath(): empty segments are kept, so "/a//" (stripped once
    // to "/a/") has a real empty last segment (#209).
    const temps = ctx.regexTemps
      ? `let ${Array.from({ length: ctx.regexTemps }, (_, i) => `_m${i}`).join(",")};`
      : "";
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
  // match "/" — matching findRoute/findAllRoutes.
  const collect = ctx.rank ? `let r=[],k=[];` : `let r=[];`;
  const done = ctx.rank
    ? `return ${rankRef(ctx)}(r.reverse(),k.reverse(),l-1);`
    : "return r.reverse();";
  return `${matchAll ? collect : ""}${normalizeHelper}${normalizePathHelper}if(p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);${code}${matchAll ? done : ""}`;
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
  for (const key in ctx.router.static) {
    const node = ctx.router.static[key];
    if (node?.methods) {
      // Keys are already in the stripped lookup form (root is ""), mirroring
      // the interpreter's `ctx.static` fast path
      entries.push([key, node]);
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
          const refs = matchers.map((m) => serializeData(ctx, m.data));
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
  const push = ctx.rank
    ? `{r.push({data:_a[_i]});k.push(${rankDescriptor(ctx)})}`
    : `r.push({data:_a[_i]});`;
  return matchAll
    ? `${lookup}if(_n!==void 0){let _a=_n[m];if(_a===void 0)_a=_n[""];if(_a!==void 0)for(let _i=_a.length-1;_i>=0;_i--)${push}}`
    : `${lookup}if(_n!==void 0){let _d=_n[m];if(_d===void 0)_d=_n[""];if(_d!==void 0)return {data:_d};}`;
}

function compileMethodMatch(
  ctx: CompilerContext,
  methods: Record<string, MethodData<any>[] | undefined>,
  params: string[],
  currentIdx: number, // Set to -1 for non-param node
  // Suffix trie node: `l>…` when the `**` still has a segment (for `**:name`)
  suffixGuard?: string,
): string {
  let code = "";
  let fallback = "";
  for (const key in methods) {
    const matchers = methods[key];
    if (matchers && matchers.length > 0) {
      // Sort descending by weight so the most specific matcher is tried first.
      // matchAll emits via `r.push` + one final `r.reverse()` (final array
      // least->most specific); the reverse flips emit order, so pre-reverse to
      // keep equal-weight siblings in insertion order (issue #187).
      // Single-match returns on the first hit, so ties stay in insertion
      // order (mirrors findRoute).
      const compiled = matchers.map((m) =>
        compileFinalMatch(ctx, m, currentIdx, params, suffixGuard),
      );
      if (ctx.opts?.matchAll && !ctx.collector) {
        compiled.reverse();
      }
      const body = compiled
        .sort((a, b) => b.weight - a.weight)
        .map((m) => m.code)
        .join("");
      if (key === "") {
        fallback = body;
      } else {
        code += `${code ? "else " : ""}if(m===${JSON.stringify(key)}){${body}}`;
      }
    }
  }
  // Method-agnostic ("") entries are a fallback only — runtime resolves
  // `methods[m] || methods[""]`, so a method-scoped entry shadows them even
  // when its own conditions fail. Emit behind `else`, not unconditionally.
  return fallback ? (code ? `${code}else{${fallback}}` : fallback) : code;
}

function compileFinalMatch(
  ctx: CompilerContext,
  data: MethodData<any>,
  currentIdx: number,
  params: string[],
  suffixGuard?: string,
): { code: string; weight: number } {
  let ret = `{data:${serializeData(ctx, data.data)}`;

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

    // Regex params run each regex once: group names are resolved from the
    // regex source at compile time (including the `__rou3_unnamed_N` -> "N"
    // renaming), so params read `.groups.<name>` directly instead of spreading
    // `.groups` through a runtime normalization helper. For a whole-segment
    // group (`^(?<name>...)$`) the group always equals the tested segment, so
    // `.test()` suffices and no `exec()` is emitted at all. Regexes live in
    // `$N` data slots — an inline literal would allocate a fresh RegExp on
    // every evaluation (ES2015+ semantics), measured ~2-6% per match.
    let paramsCode = "";
    let tmpCount = 0;
    for (let i = 0; i < paramsMap.length; i++) {
      const map = paramsMap[i];
      if (typeof map[1] === "string") {
        paramsCode += `${propKey(map[1])}:${params[i]},`;
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
        paramsCode += `${propKey(fromGroupName(groups.names[0]))}:${params[i]},`;
      } else {
        const tmp = `_m${tmpCount++}`;
        conditions.push(`(${tmp}=${regexp}.exec(${params[i]}))!==null`);
        for (const name of groups.names) {
          paramsCode += `${propKey(fromGroupName(name))}:${tmp}.groups.${name},`;
        }
      }
    }
    if (tmpCount > (ctx.regexTemps || 0)) {
      ctx.regexTemps = tmpCount;
    }

    ret += `,params:{${paramsCode}}`;
  }

  const push = ctx.rank
    ? `{r.push(${ret}});k.push(${rankDescriptor(ctx, data)})}`
    : `r.push(${ret}});`;
  const code =
    (conditions.length > 0 ? `if(${conditions.join("&&")})` : "") +
    (ctx.opts?.matchAll ? push : `return ${ret}};`);

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
  // Widen the end-of-path check to `l===c||l===c-1` (and emit the per-matcher
  // length guards) only when some matcher's last param is actually optional
  // (`/x` and `/x/` match `/x/*`) — for all-required nodes (plain `:id`, the
  // common case) a single `l===c` suffices. `node.key === "*"` alone would
  // also catch every required-only param node and static nodes for escaped
  // `\*` segments, emitting a dead widened branch.
  const hasLastOptionalParam = node.key === "*" && hasOptionalLastParam(node.methods);
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
 * trie down to a node with routes (no method, regex or `**:name` checks).
 */
function compileSuffixProbe(node: Node<any>, c: number): string {
  const terms: string[] = [];
  if (node.wildcard?.suffix) {
    terms.push(compileTrieProbe(node.wildcard.suffix, c, 0));
  }
  for (const key in node.static) {
    if (node.static[key].hasSuffix) {
      terms.push(
        `l>${c}&&s[${c}]===${JSON.stringify(key)}&&(${compileSuffixProbe(node.static[key], c + 1)})`,
      );
    }
  }
  if (node.param?.hasSuffix) {
    terms.push(`l>${c}&&(${compileSuffixProbe(node.param, c + 1)})`);
  }
  return terms.join("||") || "false";
}

function compileTrieProbe(node: Node<any>, c: number, j: number): string {
  if (node.methods) {
    return "true";
  }
  const terms: string[] = [];
  for (const key in node.static) {
    terms.push(
      `s[l-${j + 1}]===${JSON.stringify(key)}&&(${compileTrieProbe(node.static[key], c, j + 1)})`,
    );
  }
  if (node.param) {
    terms.push(compileTrieProbe(node.param, c, j + 1));
  }
  return `l>${c + j}&&(${terms.join("||") || "false"})`;
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
const RANK = `(r,k,n)=>{if(!k.some((d)=>d[1]>0))return r;const K=(d,p)=>{const e=n-d[1];if(d[0]>=0&&p>=d[0]&&p<e)return 0;for(let i=2;i<d.length;i+=2)if((d[1]&&d[i]>d[0]?d[i]-d[0]-1+e:d[i])===p)return d[i+1];return 3};return r.map((_,i)=>i).sort((a,b)=>{for(let p=n-1;p>=0;p--){const x=K(k[a],p)-K(k[b],p);if(x!==0)return x}return 0}).map((i)=>r[i])}`;

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
  // Dedupe via a Map instead of `indexOf` (O(N²) across routes)
  const dataMap = (ctx.dataMap ??= new Map());
  let index = dataMap.get(value);
  if (index === undefined) {
    index = ctx.data.push(value) - 1;
    dataMap.set(value, index);
  }
  return dataRef(ctx, index);
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

// One param node can hold both required (`:id`, `:id(\d+)`) and optional
// (`*`) routes for the same or different methods, in any insertion order.
function hasOptionalLastParam(
  methods: Record<string, MethodData<any>[] | undefined> | undefined,
): boolean {
  for (const key in methods) {
    for (const m of methods[key] || []) {
      const pMap = m.paramsMap;
      if (pMap?.[pMap.length - 1]?.[2] /* optional */) {
        return true;
      }
    }
  }
  return false;
}
