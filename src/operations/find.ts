import type { RouterContext, MatchedRoute, Node, MethodData } from "../types.ts";
import { getMatchParams, normalizePath, splitPath } from "./_utils.ts";

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
  if (path.charCodeAt(path.length - 1) === 47 /* '/' */) {
    path = path.slice(0, -1);
  }

  // Static
  const staticNode = ctx.static[path];
  if (staticNode && staticNode.methods) {
    const staticMatch = staticNode.methods[method] || staticNode.methods[""];
    if (staticMatch !== undefined) {
      return staticMatch[0];
    }
  }

  // Lookup tree
  const segments = splitPath(path);

  const match = _lookupTree<T>(ctx.root, method, segments, 0);

  if (match === undefined) {
    return;
  }

  if (opts?.params === false) {
    return match;
  }

  return {
    data: match.data,
    params: match.paramsMap ? getMatchParams(segments, match.paramsMap) : undefined,
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
      const match = _selectMatcher(node.methods, method, segments, node.key === "*", false);
      if (match) {
        return match;
      }
    }
    // Fallback to dynamic for last child (/test and /test/ matches /test/*)
    return (
      (node.param?.methods && _selectMatcher(node.param.methods, method, segments, true, true)) ||
      (node.wildcard?.methods &&
        _selectMatcher(node.wildcard.methods, method, segments, true, true)) ||
      undefined
    );
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
    return _selectMatcher(node.wildcard.methods, method, segments, true, false);
  }

  // No match
  return;
}

/**
 * Select the winning entry among same-node siblings: the highest specificity
 * weight among fully-matching entries wins, ties resolve to the
 * first-registered (so duplicate registrations return the first). Weight is
 * the same model as `pushSorted` in find-all.ts and the compiled matcher: one
 * point per passing regex-constrained param, plus one for a required last
 * param on a `dynamicTerminal` (param/wildcard node). An entry whose regex
 * fails is skipped entirely, so lookup falls through to less specific
 * siblings or other node kinds instead of aborting.
 *
 * `optionalOnly` implements the end-of-path fallback: one param/wildcard node
 * can hold both required (`:id`, `**:name`) and optional (`*`, `**`) routes,
 * in any insertion order — only the optional ones match zero segments.
 */
function _selectMatcher<T>(
  methods: Record<string, MethodData<T>[] | undefined>,
  method: string,
  segments: string[],
  dynamicTerminal: boolean,
  optionalOnly: boolean,
): MethodData<T> | undefined {
  const match = methods[method] || methods[""];
  if (!match) {
    return;
  }
  // Fast path: a single sibling with no regex constraints (the common case)
  const first = match[0];
  if (match.length === 1 && first.paramsRegexp.length === 0) {
    if (!optionalOnly) {
      return first;
    }
    const pMap = first.paramsMap;
    return pMap?.[pMap.length - 1]?.[2] /* optional */ ? first : undefined;
  }
  let best: MethodData<T> | undefined;
  let bestWeight = -1;
  for (const m of match) {
    const pMap = m.paramsMap;
    const lastOptional = pMap?.[pMap.length - 1]?.[2];
    if (optionalOnly && !lastOptional) {
      continue;
    }
    // Required last param on a dynamic terminal weighs one point; a failed
    // regex drops the entry below any candidate (bestWeight starts at -1)
    let weight = dynamicTerminal && pMap && !lastOptional ? 1 : 0;
    const regexps = m.paramsRegexp;
    for (let i = 0; i < regexps.length; i++) {
      if (regexps[i]) {
        if (!regexps[i].test(segments[i])) {
          weight = -1;
          break;
        }
        weight++;
      }
    }
    if (weight > bestWeight) {
      best = m;
      bestWeight = weight;
    }
  }
  return best;
}
