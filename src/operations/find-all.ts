import type { RouterContext, Node, MatchedRoute, MethodData } from "../types.ts";
import { getMatchParams, normalizePath, splitPath } from "./_utils.ts";

/**
 * Find all route patterns that match the given path.
 */
export function findAllRoutes<T>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  opts?: { params?: boolean; normalize?: boolean },
): MatchedRoute<T>[] {
  if (opts?.normalize) {
    path = normalizePath(path);
  }
  if (path.charCodeAt(path.length - 1) === 47 /* '/' */) {
    path = path.slice(0, -1);
  }
  const segments = splitPath(path);
  const matches = _findAll(ctx.root, method, segments, 0);

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
      if (index < segments.length) {
        matches.push(...match);
      } else {
        // Zero segments remain: only optional (`**`) wildcards match (mirrors findRoute)
        for (const m of match) {
          const pMap = m.paramsMap;
          if (pMap?.[pMap.length - 1]?.[2] /* optional */) {
            matches.push(m);
          }
        }
      }
    }
  }

  // 2. Param
  if (node.param) {
    if (index < segments.length) {
      // Consume this segment as the param, then validate regex constraints on
      // the newly collected matches (mirrors `_lookupTree` in find.ts).
      const start = matches.length;
      _findAll(node.param, method, segments, index + 1, matches);
      if (node.param.hasRegexParam) {
        for (let r = matches.length - 1; r >= start; r--) {
          if (matches[r].paramsRegexp[index]?.test(segment) === false) matches.splice(r, 1);
        }
      }
    } else if (node.param.methods) {
      // End of path: only optional trailing params match (e.g. `/*` matches `/`).
      // Filter per entry — one param node can hold both optional (`*`) and
      // required (`:id`, `:id(\d+)`) routes (mirrors the wildcard branch above).
      const match = node.param.methods[method] || node.param.methods[""];
      if (match) {
        for (const m of match) {
          const pMap = m.paramsMap;
          if (pMap?.[pMap.length - 1]?.[2] /* optional */) {
            matches.push(m);
          }
        }
      }
    }
  }

  // 3. Static
  const staticChild = node.static?.[segment];
  if (staticChild) {
    _findAll(staticChild, method, segments, index + 1, matches);
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
