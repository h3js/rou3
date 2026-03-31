# Performance Optimization Research

Analysis based on realistic benchmark results (Apple M3 Max, Node 24).

**Current numbers:**
- Static lookup (compiled): **98 ns**
- Param lookup (compiled): **528 ns** (5.4x slower than static)
- Wildcard lookup (compiled): **253 ns**
- Miss (compiled): **93 ns**
- Compiled vs interpreter: **2.5–5.5x** faster
- Memory: **~650 bytes/route**

---

## Priority 1 — Compiler: Static Routes Use if-else Chain Instead of Map

**File:** `src/compiler.ts` lines 84–93

The compiled static fast-path emits an `if/else if` chain comparing `p ===` against every static path. With 40+ statics in a real app, this is O(N) linear scan. Meanwhile the **interpreter** already does O(1) via `ctx.static[path]` hash lookup.

**Fix:** Emit a compiled-in `Object.create(null)` map for static routes:

```js
// Generated code instead of if/else chain:
const _sm = Object.create(null);
_sm["/health"] = (m) => { if(m==="GET") return {data:$0}; };
// ...
const _sr = _sm[p]; if (_sr) { const _r = _sr(m); if (_r) return _r; }
```

**Impact:** Static routes from ~98 ns to ~60–70 ns. Eliminates O(N) worst case.

---

## Priority 2 — Compiler: Static Children Use if-else Instead of switch

**File:** `src/compiler.ts` lines 207–219 (`compileNode`)

For nodes with many static children (e.g., root has `auth`, `users`, `products`, `categories`, `cart`, `orders`, `payments`, `inventory`, `shipping`, `admin`, `webhooks` — 11+ branches), the generated code is:

```js
if(s[1]==="auth"){...} else if(s[1]==="users"){...} else if(s[1]==="products"){...} // ...
```

V8 compiles `switch` on strings to hash-based dispatch (O(1)), while if-else is O(N/2) average.

**Fix:** When `Object.keys(node.static).length >= 4`, emit `switch(s[N])`:

```js
switch(s[1]) {
  case "auth": ...
  case "users": ...
  case "products": ...
}
```

**Impact:** Significant for large route sets. Directly improves param route lookup (which traverses static children at each level).

---

## Priority 3 — Interpreter: `splitPath` Allocates 2–3 Arrays

**File:** `src/operations/_utils.ts` lines 48–51

```ts
const [_, ...s] = path.split("/");          // 2 arrays: split result + rest spread
return s[s.length - 1] === "" ? s.slice(0, -1) : s;  // potential 3rd array
```

The compiled code does `p.split("/")` — one array, direct index access. The interpreter creates 2–3 arrays before even starting the tree walk.

**Fix:** Manual indexed loop:

```ts
export function splitPath(path: string): string[] {
  const end = path.charCodeAt(path.length - 1) === 47 ? path.length - 1 : path.length;
  const result: string[] = [];
  let start = 1;
  for (let i = 1; i <= end; i++) {
    if (i === end || path.charCodeAt(i) === 47) {
      result.push(path.slice(start, i));
      start = i + 1;
    }
  }
  return result;
}
```

**Impact:** ~50–80 ns/call saved. Affects every non-static interpreter lookup.

---

## Priority 4 — Interpreter: Inline Single-Param Fast Path

**File:** `src/operations/find.ts` lines 38–45

Currently every dynamic match goes through `getMatchParams()` which allocates `NullProtoObj` + iterates paramsMap with destructuring. The vast majority of real routes have a single param (`:id`).

**Fix:** Add a fast path before `getMatchParams`:

```ts
if (match.paramsMap?.length === 1) {
  const entry = match.paramsMap[0];
  if (typeof entry[1] === "string" && entry[0] >= 0) {
    return { data: match.data, params: { [entry[1]]: segments[entry[0]] } };
  }
}
return { data: match.data, params: getMatchParams(segments, match.paramsMap) };
```

**Impact:** Eliminates `NullProtoObj` allocation + `for...of` destructuring for the most common case.

---

## Priority 5 — addRoute: `encodeEscapes` Runs 5 Regex Passes on Every Route

**File:** `src/operations/_utils.ts` lines 5–12

```ts
export function encodeEscapes(path: string): string {
  return path
    .replace(/\\:/g, "\uFFFDA")
    .replace(/\\\(/g, "\uFFFDB")
    .replace(/\\\)/g, "\uFFFDC")
    .replace(/\\\{/g, "\uFFFDD")
    .replace(/\\\}/g, "\uFFFDE");
}
```

Five chained `.replace()` calls — each allocates a new string. Runs on every `addRoute`, `removeRoute`, and `routeToRegExp` call. The vast majority of routes have **zero** backslash escapes.

**Fix:** Fast-path guard:

```ts
export function encodeEscapes(path: string): string {
  if (!path.includes("\\")) return path;
  return path
    .replace(/\\:/g, "\uFFFDA")
    // ...
}
```

**Impact:** Eliminates 5 string allocations for ~99% of routes. Biggest addRoute CPU win.

---

## Priority 6 — Memory: `node.key` Never Read During Lookup

**File:** `src/types.ts` line 14, set in `src/operations/add.ts`

Every `Node` object has a `key` property storing the segment string. It is **only** used in `formatTree()` (debug rendering) and **never** accessed in `findRoute`, `findAllRoutes`, or the compiler.

**Fix:** Remove `key` from the `Node` interface. Pass segment key separately in debug utility.

**Impact:** ~24–40 bytes per node, ~2–3 nodes per route = **50–120 bytes/route** saved. For 500 routes, ~25–60 KB reduction.

---

## Priority 7 — Memory: `paramsRegexp` Always Allocated as `[]`

**File:** `src/operations/add.ts` line 124, `src/types.ts` `MethodData`

`paramsRegexp: RegExp[]` is always initialized to `[]` even for routes with no regex params. Non-regex routes (the majority) carry an empty array.

**Fix:** Make `paramsRegexp` optional (`paramsRegexp?: RegExp[]`). Only allocate when regex constraints exist.

**Impact:** ~56 bytes per route for ~60% of routes = ~34 bytes/route average.

---

## Priority 8 — Compiler: Method Dispatch Uses if-chain

**File:** `src/compiler.ts` lines 116–137 (`compileMethodMatch`)

Nodes with 3+ methods (e.g., `/products/:id` handles GET/PUT/DELETE) generate:

```js
if(m==="GET"){...} if(m==="PUT"){...} if(m==="DELETE"){...}
```

**Fix:** Emit `switch(m)` when `Object.keys(methods).length >= 3`.

**Impact:** Method dispatch from O(N) to O(1). Moderate improvement for multi-method endpoints.

---

## Priority 9 — Compiler: Wildcard `s.slice(N).join("/")` Double Allocation

**File:** `src/compiler.ts` line 244

Every wildcard param match does `s.slice(N).join("/")` — allocates a sub-array + joins into string. Since `p` still exists, the original substring is available.

**Fix:** Find the Nth `/` in `p` with `indexOf` and use `p.slice(offset)`:

```js
// Instead of: s.slice(2).join("/")
// Emit:       p.slice(p.indexOf("/", p.indexOf("/", 1) + 1) + 1)
```

**Impact:** Eliminates 2 allocations per wildcard hit.

---

## Priority 10 — Interpreter: Double Method Lookup on Every Node

**File:** `src/operations/find.ts` lines 57, 64, 73, 103–104

```ts
const match = node.methods[method] || node.methods[""];
```

Two property lookups at every terminal node. The `""` fallback is uncommon.

**Fix:** Check the specific method first with early return; only fall back when explicitly needed.

**Impact:** Minor per-call, but multiplied by 3–5 levels of recursion per lookup.

---

## Priority 11 — Interpreter: `Array.find` Called Twice for Regex Params

**File:** `src/operations/find.ts` lines 101–106

```ts
const exactMatch =
  match.find((m) => m.paramsRegexp[index]?.test(segment)) ||
  match.find((m) => !m.paramsRegexp[index]);
```

Two array iterations + closure allocation per call.

**Fix:** Single-pass loop:

```ts
let fallback;
for (const m of match) {
  if (m.paramsRegexp[index]?.test(segment)) return [m];
  if (!m.paramsRegexp[index]) fallback ??= m;
}
return fallback ? [fallback] : undefined;
```

---

## Priority 12 — addRoute: `expandGroupDelimiters` Unconditional Full Scan

**File:** Called in `src/operations/add.ts` line 25

The `expandGroupDelimiters` function scans the entire path for `{...}` patterns on every route, even when no `{` exists.

**Fix:** Guard with `path.includes("{")` before calling.

**Impact:** ~30–60 ns/route saved for most routes.

---

## Lower Priority

| Issue | File | Description |
|---|---|---|
| `paramsMap = []` pre-allocated for static routes | `add.ts:50,122` | Lazy allocation saves ~56 bytes for static routes |
| `hasSegmentWildcard` called twice | `add.ts:71,82` | Hoist result to avoid double character scan |
| `method.toUpperCase()` unconditional | `add.ts:20` | Fast charcode guard before calling |
| `Object.keys().length === 0` in removeRoute | `remove.ts:42,80` | Use `for...in` empty check to avoid array allocation |
| `serializeData` linear indexOf | `compiler.ts:261` | Use `Map` for O(1) dedup (compile-time only) |
| Redundant length checks in compiler | `compiler.ts:194–205` | Track known depth to skip re-checks |
| `getMatchParams` for...of destructuring | `_utils.ts:58` | Use indexed for-loop to avoid tuple allocation |

---

## Why Compiled is 2.5–5.5x Faster (Root Cause)

The fundamental gap is **structural**: the compiler eliminates the tree walk entirely. The compiled code **is** the tree, unrolled into flat if/switch chains.

| Cost | Interpreter | Compiler |
|---|---|---|
| Path splitting | 2–3 array allocs | 1 array, direct index |
| Tree traversal | 5+ recursive calls | 0 function calls |
| Method check | 2 lookups per node | 1 `===` at exact site |
| Params object | `NullProtoObj` + dynamic props (megamorphic) | Inline `{key: s[N]}` literal (monomorphic) |
| Node property IC | Megamorphic (varying node shapes) | N/A — no generic node traversal |
| Regex match | `Array.find` x2 + closure | Inline `regexp.test(s[N])` |

The interpreter can never fully close this gap, but Priorities 3–4 can reduce it to ~1.5–2x.
