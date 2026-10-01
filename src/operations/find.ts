import type { RouterContext, MatchedRoute, Node, MethodData } from "../types.ts";
import { _findRanked } from "./find-all.ts";
import { hasSuffixMatch } from "./_suffix.ts";
import { getMatchParams, matchesZero, normalizePath, splitPath } from "./_utils.ts";

/**
 * Find a route by path.
 */
export function findRoute<T = unknown>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  opts?: { params?: boolean; normalize?: boolean },
): MatchedRoute<T> | undefined {
  if (opts?.normalize) {
    path = normalizePath(path);
  }
  // One trailing slash is ignored, except by a trailing `*` over zero
  // segments, which it gives an empty capture (see `getMatchParams`)
  const slash = path.charCodeAt(path.length - 1) === 47; /* '/' */
  if (slash) {
    path = path.slice(0, -1);
  }

  // Static
  const staticNode = ctx.static[path];
  if (staticNode && staticNode.methods) {
    const staticMatch = staticNode.methods[method] || staticNode.methods[""];
    if (staticMatch !== undefined) {
      // A fresh object: the stored entry is internal (and shared)
      return { data: staticMatch[0].data };
    }
  }

  // Lookup tree
  const segments = splitPath(path);

  // A route with segments after `**` matches from the end of the path: when
  // one does, every match is ranked from the end (see `rankFromEnd`). A
  // `:name` can't take an empty segment: paths with one (rare) take this
  // path too, so the tree walk never checks for it.
  let match: MethodData<T> | undefined;
  if (
    segments.includes("") ||
    (ctx.root.hasSuffix && hasSuffixMatch(ctx.root, method, segments, 0))
  ) {
    const matches = _findRanked(ctx, method, segments, true);
    match = matches[matches.length - 1];
  } else {
    match = _lookupTree<T>(ctx.root, method, segments, 0);
  }

  if (match === undefined) {
    return;
  }

  if (opts?.params === false) {
    return { data: match.data };
  }

  return {
    data: match.data,
    params: match.paramsMap
      ? getMatchParams(segments, match.paramsMap, match.suffix, slash)
      : undefined,
  };
}

function _lookupTree<T>(
  node: Node<T>,
  method: string,
  segments: string[],
  index: number,
): MethodData<T> | undefined {
  // 0. End of path
  if (index === segments.length) {
    if (node.methods) {
      const match = _selectMatcher(node.methods, method, segments);
      if (match) {
        return match;
      }
    }
    // A catch-all over zero segments (`/test` matches `/test/**`, `/test/`
    // also `/test/*`)
    return node.wildcard?.methods
      ? _selectMatcher(node.wildcard.methods, method, segments, true)
      : undefined;
  }

  const segment = segments[index];

  // 1. Static
  if (node.static) {
    const staticChild = node.static[segment];
    if (staticChild) {
      const match = _lookupTree(staticChild, method, segments, index + 1);
      if (match) {
        return match;
      }
    }
  }

  // 2. Param
  if (node.param) {
    const match = _lookupTree(node.param, method, segments, index + 1);
    if (match) {
      return match;
    }
  }

  // 3. Wildcard
  if (node.wildcard && node.wildcard.methods) {
    return _selectMatcher(node.wildcard.methods, method, segments);
  }

  // No match
  return;
}

/**
 * Select the winning entry among same-node siblings: the highest specificity
 * weight among fully-matching entries wins, ties resolve to the
 * first-registered (so duplicate registrations return the first). Weight is
 * the same model as `pushSorted` in find-all.ts and the compiled matcher: one
 * point per passing regex-constrained param, plus one or two for a required
 * last param (see `pushSorted`). An entry whose regex fails is skipped
 * entirely, so lookup falls through to less specific siblings or other node
 * kinds instead of aborting.
 *
 * The method's entries and the method-agnostic (`""`) ones are siblings: a
 * `""` entry is chosen when it is strictly more specific, or when no entry of
 * the method fully matches (a method-scoped entry never hides it). On equal
 * weight the method-scoped entry wins.
 *
 * `optionalOnly` implements the end-of-path fallback: one wildcard node can
 * hold routes that need a segment (`**:name`) and ones that don't (`**`, a
 * trailing `*`) in any insertion order — only those match zero segments
 * (see `matchesZero`).
 */
function _selectMatcher<T>(
  methods: Record<string, MethodData<T>[] | undefined>,
  method: string,
  segments: string[],
  optionalOnly?: boolean,
): MethodData<T> | undefined {
  let any = methods[""];
  const match = methods[method] || any;
  if (!match) {
    return;
  }
  // The `""` entries when they are not `match` already
  if (match === any) {
    any = undefined;
  }
  // Fast path: a single sibling with no regex constraints (the common case)
  const first = match[0];
  if (!any && match.length === 1 && first.paramsRegexp.length === 0) {
    return !optionalOnly || matchesZero(first) ? first : undefined;
  }
  let best: MethodData<T> | undefined;
  let bestWeight = -1;
  // `""` entries after the method's, so they only win on a higher weight (two
  // passes instead of a concat: no allocation per lookup)
  let list: MethodData<T>[] | undefined = match;
  for (; list; list = list === any ? undefined : any) {
    for (const m of list) {
      const last = m.paramsMap?.[m.paramsMap.length - 1];
      if (optionalOnly && !matchesZero(m)) {
        continue;
      }
      // A regex param weighs two points, a required last param two (only a
      // wildcard node's differ: a `**:name` two, a `**` none, a trailing `*`,
      // which matches the same paths, one to break the tie below any regex);
      // a failed regex drops the entry below any candidate (bestWeight starts
      // at -1)
      let weight = last && !last[2] ? (last[0] < 0 && last[3] ? 1 : 2) : 0;
      const regexps = m.paramsRegexp;
      for (let i = 0; i < regexps.length; i++) {
        if (regexps[i]) {
          if (!regexps[i].test(segments[i])) {
            weight = -1;
            break;
          }
          weight += 2;
        }
      }
      if (weight > bestWeight) {
        best = m;
        bestWeight = weight;
      }
    }
  }
  return best;
}
