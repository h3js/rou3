import type { RouterContext, Node, MatchedRoute, MethodData } from "../types.ts";
import { getMatchParams, normalizePath, splitPath } from "./_utils.ts";

/**
 * Find all route patterns that match the given path.
 */
export function findAllRoutes<T>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  opts?: { params?: boolean; routes?: boolean; normalize?: boolean },
): MatchedRoute<T>[] {
  if (opts?.normalize) {
    path = normalizePath(path);
  }
  if (path.charCodeAt(path.length - 1) === 47 /* '/' */) {
    path = path.slice(0, -1);
  }
  const segments = splitPath(path);
  const matches = _findAll(ctx.root, method, segments, 0);

  const withParams = opts?.params !== false;
  if (!withParams && !opts?.routes) {
    return matches;
  }

  return matches.map((m) => {
    const match: MatchedRoute<T> = {
      data: m.data,
      params: withParams && m.paramsMap ? getMatchParams(segments, m.paramsMap) : undefined,
    };
    if (opts?.routes) {
      match.route = m.route;
      match.method = m.method;
    }
    return match;
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
        pushSorted(matches, match, true);
      } else {
        // Zero segments remain: only optional (`**`) wildcards match (mirrors findRoute)
        const optional: MethodData<T>[] = [];
        for (const m of match) {
          const pMap = m.paramsMap;
          if (pMap?.[pMap.length - 1]?.[2] /* optional */) {
            optional.push(m);
          }
        }
        pushSorted(matches, optional, true);
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
        const optional: MethodData<T>[] = [];
        for (const m of match) {
          const pMap = m.paramsMap;
          if (pMap?.[pMap.length - 1]?.[2] /* optional */) {
            optional.push(m);
          }
        }
        pushSorted(matches, optional, true);
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
      // A param node (`key === "*"`) is a dynamic terminal, so a required last
      // param (`:id`) outweighs an optional one (`*`); static terminals don't
      // distinguish them (mirrors the compiler's `hasLastOptionalParam`).
      pushSorted(matches, match, node.key === "*");
    }
  }

  return matches;
}

/**
 * Push same-node sibling matches ordered least->most specific (ascending match
 * weight), preserving insertion order on ties (stable sort). This mirrors the
 * weight-based ordering the compiler emits for `matchAll`, so `findAllRoutes`
 * and compiled `matchAll` agree regardless of route insertion order (#187).
 *
 * Weight matches the compiler's model: one point per regex-constrained param,
 * plus one for a required last param on a `dynamicTerminal` (param/wildcard
 * node) — static terminals don't distinguish required from optional there.
 */
function pushSorted<T>(
  matches: MethodData<T>[],
  match: MethodData<T>[],
  dynamicTerminal: boolean,
): void {
  if (match.length > 1) {
    match = match
      .map((m): [MethodData<T>, number] => {
        let w = 0;
        const { paramsRegexp: rx, paramsMap: pm } = m;
        for (let i = 0; i < rx.length; i++) {
          if (rx[i]) w++;
        }
        if (dynamicTerminal && pm && !pm[pm.length - 1][2] /* required */) w++;
        return [m, w];
      })
      .sort((a, b) => a[1] - b[1])
      .map((e) => e[0]);
  }
  for (const m of match) {
    matches.push(m);
  }
}
