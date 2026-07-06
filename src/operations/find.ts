import type { RouterContext, MatchedRoute, Node, MethodData } from "../types.ts";
import { getMatchParams, normalizePath, splitPath } from "./_utils.ts";

/**
 * Find a route by path.
 */
export function findRoute<T = unknown>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  opts?: { params?: boolean; routes?: boolean; normalize?: boolean },
): MatchedRoute<T> | undefined {
  if (opts?.normalize) {
    path = normalizePath(path);
  }
  if (path.charCodeAt(path.length - 1) === 47 /* '/' */) {
    path = path.slice(0, -1);
  }

  // Static
  let match: MethodData<T> | undefined;
  const staticNode = ctx.static[path];
  if (staticNode && staticNode.methods) {
    const staticMatch = staticNode.methods[method] || staticNode.methods[""];
    if (staticMatch !== undefined) {
      match = staticMatch[0];
    }
  }

  // Lookup tree
  let segments: string[] | undefined;
  if (match === undefined) {
    segments = splitPath(path);
    match = _lookupTree<T>(ctx.root, method, segments, 0)?.[0];
    if (match === undefined) {
      return;
    }
  }

  if (opts?.params === false) {
    // Raw entry — already carries `route`/`method` alongside `data`.
    return match;
  }

  // Attribution is opt-in and pays for itself: a fresh object per match.
  if (opts?.routes) {
    return {
      data: match.data,
      params: match.paramsMap ? getMatchParams(segments!, match.paramsMap) : undefined,
      route: match.route,
      method: match.method,
    };
  }

  // Default hot path — mirrors pre-attribution rou3: a fresh `{ data, params }`
  // per param match (`segments` is always set when `paramsMap` is); param-less
  // matches return the entry's precomputed object (zero allocation, and unlike
  // a raw entry it keeps `route`/`method` off default results).
  return match.paramsMap
    ? { data: match.data, params: getMatchParams(segments!, match.paramsMap) }
    : match.res!;
}

function _lookupTree<T>(
  node: Node<T>,
  method: string,
  segments: string[],
  index: number,
): MethodData<T>[] | undefined {
  // 0. End of path
  if (index === segments.length) {
    if (node.methods) {
      const match = node.methods[method] || node.methods[""];
      if (match) {
        return match;
      }
    }
    // Fallback to dynamic for last child (/test and /test/ matches /test/*)
    return (
      (node.param && _optionalMatches(node.param.methods, method)) ||
      (node.wildcard && _optionalMatches(node.wildcard.methods, method)) ||
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
      if (node.param.hasRegexParam) {
        const exactMatch =
          match.find((m) => m.paramsRegexp[index]?.test(segment)) ||
          match.find((m) => !m.paramsRegexp[index]);
        return exactMatch ? [exactMatch] : undefined;
      }
      return match;
    }
  }

  // 3. Wildcard
  if (node.wildcard && node.wildcard.methods) {
    return node.wildcard.methods[method] || node.wildcard.methods[""];
  }

  // No match
  return;
}

/**
 * Resolve a node's entries for the method and filter to those whose last param
 * is optional (`*`, `**`) — one param/wildcard node can hold both required
 * (`:id`, `**:name`) and optional routes, in any insertion order (mirrors
 * findAllRoutes' per-entry filtering and the compiler's per-matcher guards).
 */
function _optionalMatches<T>(
  methods: Record<string, MethodData<T>[] | undefined> | undefined,
  method: string,
): MethodData<T>[] | undefined {
  const match = methods && (methods[method] || methods[""]);
  if (!match) {
    return;
  }
  let optional: MethodData<T>[] | undefined;
  for (const m of match) {
    const pMap = m.paramsMap;
    if (pMap?.[pMap.length - 1]?.[2] /* optional */) {
      // Single sibling needs no filtered copy (zero allocation)
      if (match.length === 1) {
        return match;
      }
      (optional ||= []).push(m);
    }
  }
  return optional;
}
