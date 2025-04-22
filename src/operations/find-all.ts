import type {
  RouterContext,
  Node,
  MatchedRoute,
  MethodData,
} from "../types.ts";
import { getMatchParams, splitPath } from "./_utils.ts";

/**
 * Find all route patterns that match the given path.
 */
export function findAllRoutes<T>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  opts?: { params?: boolean },
): MatchedRoute<T>[] {
  if (path[path.length - 1] === "/") {
    path = path.slice(0, -1);
  }
  const segments = splitPath(path);
  const matches = _findAll(ctx, ctx.root, method, segments, 0);

  if (opts?.params === false) {
    return matches;
  }

  return matches.map((m) => {
    return {
      data: m.data,
      params: m.paramsMap ? getMatchParams(segments, m.paramsMap) : undefined,
    };
  });
}

function _findAll<T>(
  ctx: RouterContext<T>,
  node: Node<T>,
  method: string,
  segments: string[],
  index: number,
  matches: MethodData<T>[] = [],
): MethodData<T>[] {
  const segment = segments[index];

  // 1. Wildcard
  if (node.wildcard && node.wildcard.methods) {
    const match = node.wildcard.methods[method] || node.wildcard.methods[""];
    if (match) {
      matches.push(...match);
    }
  }

  // 2. Param
  if (node.param) {
    _findAll(ctx, node.param, method, segments, index + 1, matches);
    if (index === segments.length && node.param.methods) {
      const match = node.param.methods[method] || node.param.methods[""];
      if (match) {
        const pMap = match[0].paramsMap;
        if (pMap?.[pMap?.length - 1]?.[2]) {
          matches.push(...match);
        }
      }
    }
  }

  // 3. Static
  const staticChild = node.static?.[segment];
  if (staticChild) {
    _findAll(ctx, staticChild, method, segments, index + 1, matches);
  }

  // 4. End of path
  if (index === segments.length && node.methods) {
    const match = node.methods[method] || node.methods[""];
    if (match) {
      matches.push(...match);
    }
  }

  return matches;
}
