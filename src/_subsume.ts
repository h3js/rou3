import type { RouteShape } from "./_overlap.ts";

/**
 * Whether shape `a` certainly matches a superset of the paths shape `b`
 * matches (subset containment of match-sets, `a` ⊇ `b`).
 *
 * Sound but not complete: `true` is a proof, `false` means "not provable"
 * rather than "certainly not a superset". Containment between two regex
 * constraints is only decided by source equality (with named groups
 * normalized, so param names don't matter), and a regex is only proven to
 * cover a static literal via an anchored `test()` (regex intersection is
 * undecidable in general).
 */
export function shapeSubsumes(a: RouteShape, b: RouteShape): boolean {
  const fa = a.fixed.length;
  const fb = b.fixed.length;
  // `b`'s total-length range must sit inside `a`'s.
  if (fa + a.tailMin > fb + b.tailMin || fa + a.tailMax < fb + b.tailMax) {
    return false;
  }
  const common = fa < fb ? fa : fb;
  for (let k = 0; k < common; k++) {
    if (!_segmentSubsumes(a.fixed[k], b.fixed[k])) return false;
  }
  // Positions covered by `b`'s any-value tail but fixed in `a` must be
  // unconstrained. (Length containment already guarantees every `b` path is
  // long enough to reach all of `a`'s fixed positions.)
  for (let k = fb; k < fa; k++) {
    if (a.fixed[k] !== undefined) return false;
  }
  return true;
}

/**
 * Collapse shapes that differ only in tail length into one shape per fixed
 * prefix (union of contiguous total-length ranges). An optional-syntax pattern
 * expands into several entries (`/a/:x?` -> `/a` + `/a/:x`) whose canonical
 * shapes are `["a"] [0,0]` and `["a"] [1,1]`; merging yields `["a"] [0,1]` —
 * the same shape as `/a/*` — so containment checks see through the expansion.
 */
export function mergeShapes(shapes: RouteShape[]): RouteShape[] {
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i];
      const b = shapes[j];
      // Ranges must be equal fixed-wise and union into one contiguous range.
      if (
        _sameFixed(a.fixed, b.fixed) &&
        a.tailMin <= b.tailMax + 1 &&
        b.tailMin <= a.tailMax + 1
      ) {
        a.tailMin = Math.min(a.tailMin, b.tailMin);
        a.tailMax = Math.max(a.tailMax, b.tailMax);
        shapes.splice(j, 1);
        j = i; // Restart: the widened range may absorb earlier-skipped shapes.
      }
    }
  }
  return shapes;
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
      _regExpKey(x) === _regExpKey(y))
  );
}

/**
 * Whether single-segment matcher `x` certainly matches every value `y`
 * matches. `any` covers everything; literals must be equal; an (anchored)
 * regex provably covers a literal it tests true on, and another regex only
 * when their sources are identical (modulo named-group names).
 */
function _segmentSubsumes(x: string | RegExp | undefined, y: string | RegExp | undefined): boolean {
  if (x === undefined) return true;
  if (typeof x === "string") return x === y;
  if (typeof y === "string") return x.test(y);
  return y instanceof RegExp && x.flags === y.flags && _regExpKey(x) === _regExpKey(y);
}

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
function _regExpKey(r: RegExp): string {
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
