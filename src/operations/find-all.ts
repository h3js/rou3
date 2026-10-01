import type { RouterContext, Node, MatchedRoute, MethodData } from "../types.ts";
import { collectSuffix, rankFromEnd } from "./_suffix.ts";
import {
  emptyParam,
  getMatchParams,
  matchesZero,
  methodEntries,
  normalizePath,
  splitPath,
} from "./_utils.ts";

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
  // A trailing `*` over zero segments takes the one ignored trailing slash
  // (see `getMatchParams`)
  const slash = path.charCodeAt(path.length - 1) === 47; /* '/' */
  if (slash) {
    path = path.slice(0, -1);
  }
  const segments = splitPath(path);
  const matches = _findRanked(ctx, method, segments);

  // Fresh objects (the entries are internal); static routes and
  // `params: false` carry no `params` key, as in `findRoute` and compiled
  const params = opts?.params !== false;
  return matches.map((m) =>
    params && m.paramsMap
      ? { data: m.data, params: getMatchParams(segments, m.paramsMap, m.suffix, slash) }
      : { data: m.data },
  );
}

/**
 * Every route matching `segments`, least -> most specific: in tree order, or
 * ranked from the end of the path once a route with segments after `**` is
 * among them.
 * `reverse`: see `_findAll`; the last match is then the one `findRoute` picks.
 */
export function _findRanked<T>(
  ctx: RouterContext<T>,
  method: string,
  segments: string[],
  reverse?: boolean,
): MethodData<T>[] {
  let matches = _findAll(ctx.root, method, segments, 0, [], reverse);
  // A `:name` / `**:name` can't take an empty segment (see `emptyParam`)
  if (segments.includes("")) {
    matches = matches.filter((m) => !emptyParam(m, segments));
  }
  // Routes with segments after `**` match from the end of the path, and so
  // does the order of the results once one of them matches
  if (ctx.root.hasSuffix && matches.some((m) => m.suffix)) {
    rankFromEnd(matches, segments);
  }
  return matches;
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
      // Zero segments remain: a `**` or a `*` (mirrors findRoute)
      pushSorted(matches, index < segments.length ? match : match.filter((m) => matchesZero(m)));
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

  // 2. Param (a segment: at the end of the path, only catch-alls match)
  if (node.param && index < segments.length) {
    // Consume this segment as the param, then validate regex constraints on
    // the newly collected matches (mirrors `_lookupTree` in find.ts).
    const start = matches.length;
    _findAll(node.param, method, segments, index + 1, matches, reverse);
    if (node.param.hasRegexParam) {
      for (let r = matches.length - 1; r >= start; r--) {
        if (matches[r].paramsRegexp[index]?.test(segment) === false) matches.splice(r, 1);
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
      pushSorted(matches, match);
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
 * Weight matches the compiler's model: two points per regex-constrained
 * param, plus four for a required last param. Siblings differ there only on
 * a wildcard node (`**` none, a trailing `*`, which matches the same paths,
 * one: below any regex, `**:name` four);
 * elsewhere it adds the same to all, which the compiler leaves out.
 */
function pushSorted<T>(matches: MethodData<T>[], match: MethodData<T>[]): void {
  if (match.length > 1) {
    match = match
      .map((m): [MethodData<T>, number] => {
        let w = 0;
        const { paramsRegexp: rx, paramsMap: pm } = m;
        for (let i = 0; i < rx.length; i++) {
          if (rx[i]) w += 2;
        }
        // A required last param, a trailing `*` (it matches what a `**` does)
        // one point only
        const last = pm?.[pm.length - 1];
        if (last && !last[2]) w += last[3] ? 1 : 4;
        return [m, w];
      })
      .sort((a, b) => a[1] - b[1])
      .map((e) => e[0]);
  }
  for (const m of match) {
    matches.push(m);
  }
}
