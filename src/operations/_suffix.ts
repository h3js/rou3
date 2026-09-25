import type { MethodData, Node } from "../types.ts";

/**
 * Collect the routes of a wildcard's `suffix` trie that match `segments`,
 * least -> most specific (shallower suffixes first, then param, then static
 * children). The trie holds the segments after `**` last segment first, so it
 * is walked from the end of the path: `pos` is the next segment to match and
 * `start` the first one the `**` may take.
 *
 * Same-node siblings are ordered by weight (one point per passing regex, one
 * for a `**:name`, which must take a segment), ties in insertion order, or
 * reversed with `reverse` (findRoute takes the last match, and ties go to the
 * first-registered there).
 */
export function collectSuffix<T>(
  node: Node<T>,
  method: string,
  segments: string[],
  start: number,
  pos: number,
  matches: MethodData<T>[],
  reverse?: boolean,
): void {
  const match = node.methods && (node.methods[method] || node.methods[""]);
  if (match) {
    const end = pos + 1;
    const weighted: [MethodData<T>, number][] = [];
    for (const m of reverse ? match.slice().reverse() : match) {
      const w = m.suffix![0];
      let weight = 0;
      for (const [index, , optional] of m.paramsMap!) {
        if (index < 0 && !optional) {
          weight = end > start ? 1 : -1;
        }
      }
      const regexps = m.paramsRegexp;
      for (let i = 0; i < regexps.length && weight >= 0; i++) {
        if (regexps[i]) {
          weight = regexps[i].test(segments[i > w ? i - w - 1 + end : i]) ? weight + 1 : -1;
        }
      }
      if (weight >= 0) {
        weighted.push([m, weight]);
      }
    }
    for (const [m] of weighted.sort((a, b) => a[1] - b[1])) {
      matches.push(m);
    }
  }
  if (pos >= start) {
    if (node.param) {
      collectSuffix(node.param, method, segments, start, pos - 1, matches, reverse);
    }
    const staticChild = node.static?.[segments[pos]];
    if (staticChild) {
      collectSuffix(staticChild, method, segments, start, pos - 1, matches, reverse);
    }
  }
}

/**
 * Whether a route with segments after `**` matches `segments` (only subtrees
 * flagged `hasSuffix` are visited).
 */
export function hasSuffixMatch<T>(
  node: Node<T>,
  method: string,
  segments: string[],
  index: number,
): boolean {
  const trie = node.wildcard?.suffix;
  // Most paths miss on the last segment already
  if (trie && (trie.param || trie.static?.[segments[segments.length - 1]])) {
    const matches: MethodData<T>[] = [];
    collectSuffix(trie, method, segments, index, segments.length - 1, matches);
    if (matches.length > 0) {
      return true;
    }
  }
  if (index < segments.length) {
    const staticChild = node.static?.[segments[index]];
    if (staticChild?.hasSuffix && hasSuffixMatch(staticChild, method, segments, index + 1)) {
      return true;
    }
    if (node.param?.hasSuffix && hasSuffixMatch(node.param, method, segments, index + 1)) {
      return true;
    }
  }
  return false;
}

/**
 * Sort `matches` least -> most specific by comparing them from the last
 * segment of the path backwards: a literal segment beats a regex-constrained
 * param, which beats a plain param or a segment taken by `**`. Ties keep
 * their order (stable sort).
 *
 * Used instead of the tree order on paths a route with segments after `**`
 * matches: such a route is anchored at the end of the path, so the tree
 * order (which decides at the first segment) would let `/blog/**` or
 * `/blog/:slug` beat `/**\/_payload.json`, and a broader route beat a
 * narrower one (`/a/:p/**` over `/a/**\/x`).
 */
export function rankFromEnd<T>(matches: MethodData<T>[], segments: string[]): MethodData<T>[] {
  const n = segments.length;
  return matches.sort((a, b) => {
    for (let p = n - 1; p >= 0; p--) {
      const d = kindAt(a, n, p) - kindAt(b, n, p);
      if (d !== 0) {
        return d;
      }
    }
    return 0;
  });
}

/** 3 literal, 2 regex param, 0 plain param or `**` at path segment `p`. */
function kindAt(m: MethodData<unknown>, n: number, p: number): number {
  const suffix = m.suffix;
  const end = suffix ? n - suffix[1] : n;
  for (const [index, name] of m.paramsMap || []) {
    if (index < 0) {
      if (p >= -(index + 1) && p < end) {
        return 0;
      }
    } else if ((suffix && index > suffix[0] ? index - suffix[0] - 1 + end : index) === p) {
      return typeof name === "string" ? 0 : 2;
    }
  }
  return 3;
}
