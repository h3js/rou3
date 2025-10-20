import type {
  RouterContext,
  MatchedRoute,
  Node,
  MethodData,
} from "../types.ts";
import { getMatchParams, splitPath } from "./_utils.ts";

/**
 * Find a route by path.
 */
export function findRoute<T = unknown>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  opts?: { params?: boolean },
): MatchedRoute<T> | undefined {
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

  const match = _lookupTree<T>(ctx, ctx.root, method, segments, 0)?.[0];

  if (match === undefined) {
    return;
  }

  if (opts?.params === false) {
    return match;
  }

  return {
    data: match.data,
    params: match.paramsMap
      ? getMatchParams(segments, match.paramsMap)
      : undefined,
  };
}

function _lookupTree<T>(
  ctx: RouterContext<T>,
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
    if (node.param && node.param.methods) {
      const match = node.param.methods[method] || node.param.methods[""];
      if (match) {
        const pMap = match[0].paramsMap;
        if (pMap?.[pMap?.length - 1]?.[2] /* optional */) {
          return match;
        }
      }
    }
    if (node.wildcard && node.wildcard.methods) {
      const match = node.wildcard.methods[method] || node.wildcard.methods[""];
      if (match) {
        const pMap = match[0].paramsMap;
        if (pMap?.[pMap?.length - 1]?.[2] /* optional */) {
          return match;
        }
      }
    }
    return undefined;
  }

  const segment = segments[index];

  // 1. Static
  if (node.static) {
    const staticChild = node.static[segment];
    if (staticChild) {
      const match = _lookupTree(ctx, staticChild, method, segments, index + 1);
      if (match) {
        return match;
      }
    }
  }

  // 2. Param
  if (node.param) {
    const match = _lookupTree(ctx, node.param, method, segments, index + 1);
    if (match) {
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
