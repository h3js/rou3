import { createRouter } from "../context.ts";
import { addRoute } from "../operations/add.ts";
import type { MethodData, Node } from "../types.ts";

// The model `routesOverlap`, `compareRoutes` and `findOverlappingRoutes`
// reason on: a route as fixed segment matchers around a variable-length tail
// (`RouteShape`), read from the tree `addRoute` builds.

/**
 * A canonical (fully expanded) route shape: fixed single-segment matchers
 * (`string` literal | `RegExp` constraint, `NON_EMPTY` for a `:name` |
 * `undefined` = any) followed by a variable-length tail. The tail (a
 * catch-all: `*`, `**`, `**:name`) matches any segment values, so it only
 * constrains the total number of segments: `**` -> `[0, Infinity]`, `*` and
 * `**:name` -> `[1, Infinity]`, no variable tail -> `[0, 0]`. A `**:name`
 * needs a value in each segment (`some`): no tail segment can be `""`, as in
 * URLPattern's `:name+`. A trailing `*` is optional (see `matchesZero`): its
 * tail is a `**`'s, `[0, Infinity]`.
 *
 * Segments after a catch-all form the `suffix`: fixed matchers aligned to the
 * end of the path, after the tail (`/**\/_payload.json` -> `[] [0, Infinity]
 * ["_payload.json"]`). Never empty when set.
 */
export interface RouteShape {
  fixed: (string | RegExp | undefined)[];
  tailMin: number;
  tailMax: number;
  suffix?: (string | RegExp | undefined)[];
  some?: true;
}

/**
 * A tree edge on the path from the root to a node: a static key (already
 * decoded, so it may be a literal `*`/`**`), or a param (`0`) / wildcard (`1`)
 * branch. Carrying the node kind keeps escaped-literal static keys
 * distinguishable from dynamic segments.
 */
export type Edge = string | 0 | 1;

/**
 * Expand a route pattern into its canonical shapes by inserting it into a
 * throwaway router with the real `addRoute` pipeline (group delimiters, escape
 * encoding, modifiers) and reading the resulting tree entries. Both query
 * patterns and registered routes are therefore classified by the exact same
 * code, so overlap stays consistent with route matching by construction.
 *
 * Results are memoized per pattern string (typical consumers compare N
 * patterns pairwise — N parses instead of N²) and must be treated as
 * immutable by callers.
 */
export function routeToShapes(pattern: string): RouteShape[] {
  let shapes = _patternShapes.get(pattern);
  if (shapes === undefined) {
    const ctx = createRouter();
    addRoute(ctx, "", pattern);
    shapes = [];
    _collectShapes(ctx.root, [], shapes);
    shapes = mergeShapes(shapes);
    // Keep the memo bounded; pattern vocabularies are small in practice, so a
    // full reset on overflow is simpler than recency tracking.
    if (_patternShapes.size >= 1024) _patternShapes.clear();
    _patternShapes.set(pattern, shapes);
  }
  return shapes;
}

/**
 * Build the {@link RouteShape} of a registered route entry from its tree
 * position (kind-tagged edges) and its own `paramsMap` classification.
 *
 * A registered entry is stable once inserted, so its shape is cached across
 * queries. (Query patterns go through {@link routeToShapes}, whose throwaway
 * entries are transient and never benefit from the cache — they call
 * `_computeShape` directly.)
 */
export function shapeOf(edges: Edge[], entry: MethodData): RouteShape {
  let shape = _shapeCache.get(entry);
  if (!shape) _shapeCache.set(entry, (shape = _computeShape(edges, entry)));
  return shape;
}

/**
 * Visit the nodes with routes of a wildcard's `suffix` trie (the segments
 * after `**`, last one first), with their edges after the `**` in route
 * order: least -> most specific (shallower first, then param, then static).
 */
export function visitSuffixTrie<T>(
  node: Node<T>,
  after: Edge[],
  visit: (node: Node<T>, after: Edge[]) => void,
): void {
  if (node.methods) visit(node, after);
  if (node.param) visitSuffixTrie(node.param, [0, ...after], visit);
  if (node.static) {
    for (const key in node.static) visitSuffixTrie(node.static[key], [key, ...after], visit);
  }
}

/**
 * Collapse shapes that differ only in tail length into one shape per fixed
 * prefix (union of contiguous total-length ranges). An optional-syntax pattern
 * expands into several entries (`/a/:x*` -> `/a` + `/a/**:x`) whose canonical
 * shapes are `["a"] [0,0]` and `["a"] [1,Infinity]` (each segment a value:
 * `some`); merging yields `["a"] [0,Infinity]` with `some` — `/a/**` without
 * the paths with an empty segment after `/a` (`/a//`, `/a//b`) — so
 * containment checks see through the expansion.
 */
export function mergeShapes(shapes: RouteShape[]): RouteShape[] {
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      // Ranges must be equal fixed-wise and union into one contiguous range.
      if (
        _sameFixed(a.fixed, b.fixed) &&
        _sameFixed(a.suffix || [], b.suffix || []) &&
        a.tailMin <= b.tailMax + 1 &&
        b.tailMin <= a.tailMax + 1
      ) {
        // Tail segments need a value if they do in both (or one has none)
        a.some = _someTail(a) && _someTail(b) ? true : undefined;
        a.tailMin = Math.min(a.tailMin, b.tailMin);
        a.tailMax = Math.max(a.tailMax, b.tailMax);
        shapes.splice(j, 1);
        j = i; // Restart: the widened range may absorb earlier-skipped shapes.
      }
    }
  }
  return shapes;
}

/** Shortest path (in segments) a shape matches. */
export function minLength(shape: RouteShape): number {
  return shape.fixed.length + (shape.suffix?.length || 0) + shape.tailMin;
}

/** Longest path (in segments) a shape matches (`Infinity` with a `**`). */
export function maxLength(shape: RouteShape): number {
  return shape.fixed.length + (shape.suffix?.length || 0) + shape.tailMax;
}

/**
 * The matcher of `shape` at segment `i` of a path with `n` segments: a tail
 * segment is any value, or any but `""` in a `**:name`'s (`some`).
 */
export function matcherAt(shape: RouteShape, n: number, i: number): RouteShape["fixed"][number] {
  const f = shape.fixed.length;
  if (i < f) return shape.fixed[i];
  const s = shape.suffix?.length || 0;
  if (i >= n - s) return shape.suffix![i - n + s];
  return shape.some ? NON_EMPTY : undefined;
}

/**
 * A path length from which on the matchers of `a` and `b` stop moving
 * relative to each other (their fixed prefixes aligned to the start, suffixes
 * to the end, tails in between: with a `**:name`'s, one segment that is in
 * both tails, as every longer length adds more of it), so it stands for every
 * longer length.
 */
export function stableLength(a: RouteShape, b: RouteShape): number {
  return (
    Math.max(a.fixed.length, b.fixed.length) +
    Math.max(a.suffix?.length || 0, b.suffix?.length || 0) +
    (a.some || b.some ? 1 : 0)
  );
}

/**
 * The matcher of a segment that needs a value (a `:name`, each segment of a
 * `**:name`): any but `""`. Compared by identity (see `_segmentSubsumes` in overlap.ts).
 */
export const NON_EMPTY: RegExp = /^[\s\S]/;

// Comparison keys are stable per RegExp instance; cache across pairwise calls.
const _regExpKeys = new WeakMap<RegExp, string>();

/**
 * Comparison key for a segment constraint: the source with named-group opens
 * (`(?<name>`) replaced by plain group opens. Param names are baked into the
 * compiled source (`getParamRegexp` emits `(?<id>...)`), but they don't affect
 * the match-set, so `/u/:id(\d+)` and `/u/:x(\d+)` must compare equal.
 * Backslash escapes and character classes are copied verbatim so a literal
 * `(?<` inside them is never mistaken for a group open.
 */
export function regExpKey(r: RegExp): string {
  let key = _regExpKeys.get(r);
  if (key === undefined) {
    const s = r.source;
    key = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\") {
        key += c + s[++i];
      } else if (c === "[") {
        let j = i + 1;
        while (j < s.length && s[j] !== "]") j += s[j] === "\\" ? 2 : 1;
        key += s.slice(i, j + 1);
        i = j;
      } else if (
        c === "(" &&
        s[i + 1] === "?" &&
        s[i + 2] === "<" &&
        s[i + 3] !== "=" &&
        s[i + 3] !== "!"
      ) {
        const end = s.indexOf(">", i + 3);
        key += "(";
        i = end === -1 ? i : end;
      } else {
        key += c;
      }
    }
    _regExpKeys.set(r, key);
  }
  return key;
}

// A route entry's shape never changes once inserted; cache across queries.
const _shapeCache = new WeakMap<MethodData, RouteShape>();

// Pattern -> canonical shapes memo for `routeToShapes` (see its doc comment).
const _patternShapes = new Map<string, RouteShape[]>();

function _collectShapes(node: Node, edges: Edge[], shapes: RouteShape[]): void {
  if (node.methods) {
    for (const entry of node.methods[""] || []) {
      shapes.push(_computeShape(edges, entry));
    }
  }
  if (node.static) {
    for (const key in node.static) {
      edges.push(key);
      _collectShapes(node.static[key], edges, shapes);
      edges.pop();
    }
  }
  if (node.param) {
    edges.push(0);
    _collectShapes(node.param, edges, shapes);
    edges.pop();
  }
  if (node.wildcard) {
    edges.push(1);
    _collectShapes(node.wildcard, edges, shapes);
    edges.pop();
  }
  if (node.suffix) {
    visitSuffixTrie(node.suffix, [], (trieNode, after) => {
      for (const entry of trieNode.methods![""] || []) {
        shapes.push(_computeShape(edges.concat(after), entry));
      }
    });
  }
}

function _computeShape(edges: Edge[], entry: MethodData): RouteShape {
  const fixed: RouteShape["fixed"] = [];
  let suffix: RouteShape["fixed"] | undefined;
  let tailMin = 0;
  let tailMax = 0;
  let some: true | undefined;
  const pMap = entry.paramsMap;
  for (let d = 0; d < edges.length; d++) {
    const edge = edges[d];
    const into = suffix || fixed;
    if (typeof edge === "string") {
      into.push(edge);
    } else if (edge === 1) {
      // `**` is optional, `**:name` (`:name+`, `:name*`) requires one segment
      // or more, each with a value (see `emptyParam`), a `*` one segment, or
      // none where it ends the route (`empty`, also a `:name(.*)`, see
      // `matchesZero`). Segments after it are the suffix, aligned to the end
      // of the path.
      const [, , optional, empty, , join] = pMap!.find((e) => e[0] === -(d + 1))!;
      const last = d === edges.length - 1;
      tailMin = optional || (last && empty && !join) ? 0 : 1;
      tailMax = Number.POSITIVE_INFINITY;
      if (!optional && !empty) some = true;
      if (!last) suffix = [];
    } else if (pMap) {
      // Param: classified by this entry's paramsMap entry at this segment
      // index. A `:name` needs a value.
      const p = pMap.find((e) => e[0] === d)!;
      into.push(p[1] instanceof RegExp ? p[1] : NON_EMPTY);
    }
  }
  return suffix ? { fixed, tailMin, tailMax, suffix, some } : { fixed, tailMin, tailMax, some };
}

/** Whether each tail segment of `shape` needs a value, or it has none. */
function _someTail(shape: RouteShape): boolean {
  return !!shape.some || shape.tailMax < 1;
}

function _sameFixed(a: RouteShape["fixed"], b: RouteShape["fixed"]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    if (!_segmentEqual(a[k], b[k])) return false;
  }
  return true;
}

/**
 * Whether two single-segment matchers are *identical* (same match-set by
 * construction, not by mutual subsumption proofs — merging must never rely on
 * an over-approximation).
 */
function _segmentEqual(x: string | RegExp | undefined, y: string | RegExp | undefined): boolean {
  return (
    x === y ||
    (x instanceof RegExp &&
      y instanceof RegExp &&
      x.flags === y.flags &&
      regExpKey(x) === regExpKey(y))
  );
}
