import type { RouterContext, Node, MatchedRoute, MethodData } from "../types.ts";
import { collectSuffix, rankFromEnd } from "./_suffix.ts";
import { getMatchParams, methodEntries, normalizePath, splitPath } from "./_utils.ts";

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
  // Routes with segments after `**` match from the end of the path, and so
  // does the order of the results once one of them matches
  if (ctx.root.hasSuffix && matches.some((m) => m.suffix)) {
    rankFromEnd(matches, segments);
  }

  // Fresh objects (the entries are internal); static routes and
  // `params: false` carry no `params` key, as in `findRoute` and compiled
  const params = opts?.params !== false;
  return matches.map((m) =>
    params && m.paramsMap
      ? { data: m.data, params: getMatchParams(segments, m.paramsMap, m.suffix) }
      : { data: m.data },
  );
}

/**
 * Every route matching `segments`, least -> most specific in tree order.
 * A node's method-agnostic (`""`) entries and its `method` entries are
 * siblings (see `methodEntries`). `reverse` flips same-node ties so that the
 * last match is the one `findRoute` would pick (it takes the first-registered
 * on ties).
 */
export function _findAll<T>(
  node: Node<T>,
  method: string,
  segments: string[],
  index: number,
  matches: MethodData<T>[] = [],
  reverse?: boolean,
): MethodData<T>[] {
  const segment = segments[index];

  // 1. Wildcard
  if (node.wildcard) {
    const match = node.wildcard.methods && methodEntries(node.wildcard.methods, method, reverse);
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
    // Routes with segments after the `**` (narrower than a bare one)
    if (node.wildcard.suffix) {
      collectSuffix(
        node.wildcard.suffix,
        method,
        segments,
        index,
        segments.length - 1,
        matches,
        reverse,
      );
    }
  }

  // 2. Param
  if (node.param) {
    if (index < segments.length) {
      // Consume this segment as the param, then validate regex constraints on
      // the newly collected matches (mirrors `_lookupTree` in find.ts).
      const start = matches.length;
      _findAll(node.param, method, segments, index + 1, matches, reverse);
      if (node.param.hasRegexParam) {
        for (let r = matches.length - 1; r >= start; r--) {
          if (matches[r].paramsRegexp[index]?.test(segment) === false) matches.splice(r, 1);
        }
      }
    } else if (node.param.methods) {
      // End of path: only optional trailing params match (e.g. `/*` matches `/`).
      // Filter per entry — one param node can hold both optional (`*`) and
      // required (`:id`, `:id(\d+)`) routes (mirrors the wildcard branch above).
      const match = methodEntries(node.param.methods, method, reverse);
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

  // 3. Static (only while segments remain: at end of path `segment` is
  // `undefined`, which an object lookup would coerce to a literal "undefined"
  // segment key)
  if (index < segments.length) {
    const staticChild = node.static?.[segment];
    if (staticChild) {
      _findAll(staticChild, method, segments, index + 1, matches, reverse);
    }
  }

  // 4. End of path
  if (index === segments.length && node.methods) {
    const match = methodEntries(node.methods, method, reverse);
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
 * `match` comes from `methodEntries`, so on ties a node's `""` entries stay
 * before the method's own.
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
