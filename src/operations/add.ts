import { expandGroupDelimiters } from "../_group-delimiters.ts";
import { toGroupName, toUnnamedGroupKey } from "../_group-names.ts";
import { replaceSegmentWildcards } from "../_segment-wildcards.ts";
import { NullProtoObj } from "../object.ts";
import type { Node, RouterContext, ParamsIndexMap } from "../types.ts";
import {
  encodeEscapes,
  expandedRouteId,
  expandModifiers,
  segmentKey,
  splitRoute,
} from "./_utils.ts";

/**
 * Add a route to the router context.
 */
export function addRoute<T>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  data?: T,
): void {
  method = method.toUpperCase();
  if (path.charCodeAt(0) !== 47 /* '/' */) {
    path = `/${path}`;
  }
  _add(ctx, method, path, data);
}

/**
 * `route` is the registration identity `removeRoute` splices entries by. A
 * pattern that expands (groups, `?`/`+`/`*` modifiers) stamps its normalized
 * *pre-expansion* text (`expandedRouteId`) on every entry, so the `/admin`
 * entry of `/admin/:page?` is never confused with a separately registered
 * `/admin` on the same node. A plain pattern's identity is its rewritten
 * segment join — the string `ctx.static` is keyed by (one `join` per entry,
 * no extra parsing) — so spellings the tree cannot tell apart (`\)` vs `)`,
 * `/a/` vs `/a`) share one identity.
 */
function _add<T>(
  ctx: RouterContext<T>,
  method: string,
  path: string,
  data: T | undefined,
  route?: string,
): void {
  const groupExpanded = expandGroupDelimiters(path);
  if (groupExpanded) {
    route ??= expandedRouteId(path);
    for (const expandedPath of groupExpanded) {
      _add(ctx, method, expandedPath, data, route);
    }
    return;
  }

  path = encodeEscapes(path);

  const segments = splitRoute(path);

  // Expand modifiers (:name?, :name+, :name*) into multiple route entries
  const expanded = expandModifiers(segments);
  if (expanded) {
    route ??= expandedRouteId(path);
    for (const p of expanded) {
      _add(ctx, method, p, data, route);
    }
    return;
  }

  let node = ctx.root;

  let _unnamedParamIndex = 0;

  const paramsMap: ParamsIndexMap = [];
  const paramsRegexp: RegExp[] = [];

  // Segments after a `**` (static key, or `1` for a param) are inserted into
  // the wildcard's `suffix` trie last segment first, once the params are read
  let suffix: (string | 1)[] | undefined;
  let wildcardIndex = -1;
  // Nodes on the way to the `**`, flagged `hasSuffix` for a suffix route
  const trail: Node<T>[] | undefined = path.includes("**") ? [] : undefined;

  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i];
    const key = segmentKey(segment);

    // Wildcard
    if (key === 2) {
      if (suffix) {
        throw new Error(`rou3: a route can have only one \`**\` (${path})`);
      }
      trail?.push(node);
      if (!node.wildcard) {
        node.wildcard = { key: "**" };
      }
      node = node.wildcard;
      paramsMap.push([-(i + 1), segment.split(":")[1] || "_", segment.length === 2 /* no id */]);
      if (i === segments.length - 1) {
        break;
      }
      suffix = [];
      wildcardIndex = i;
      continue;
    }

    // Param
    if (key === 1) {
      if (suffix) {
        suffix.push(1);
      } else {
        trail?.push(node);
        if (!node.param) {
          node.param = { key: "*" };
        }
        node = node.param;
      }
      if (segment === "*") {
        // A trailing `*` may match no segment, but not after a `**`
        paramsMap.push([i, String(_unnamedParamIndex++), !suffix /* optional */]);
      } else if (segment.includes("(") || segment.includes(":", 1) || !/^:[\w-]+$/.test(segment)) {
        const [regexp, nextIndex] = getParamRegexp(segment, _unnamedParamIndex);
        _unnamedParamIndex = nextIndex;
        paramsRegexp[i] = regexp;
        if (!suffix) {
          node.hasRegexParam = true;
        }
        paramsMap.push([i, regexp, false]);
      } else {
        paramsMap.push([i, segment.slice(1), false]);
      }
      continue;
    }

    // Static
    segment = segments[i] = key;
    if (suffix) {
      suffix.push(segment);
      continue;
    }
    trail?.push(node);
    const child = node.static?.[segment];
    if (child) {
      node = child;
    } else {
      const staticNode = { key: segment };
      if (!node.static) {
        node.static = new NullProtoObj();
      }
      node.static![segment] = staticNode;
      node = staticNode;
    }
  }

  if (suffix) {
    for (const n of trail!) {
      n.hasSuffix = true;
    }
    node = node.suffix ??= { key: "" };
    for (let j = suffix.length - 1; j >= 0; j--) {
      const edge = suffix[j];
      if (edge === 1) {
        node = node.param ??= { key: "*" };
      } else {
        node = (node.static ??= new NullProtoObj())[edge] ??= { key: edge };
      }
    }
  }

  // Assign index, params and data to the node
  const hasParams = paramsMap.length > 0;
  const key = "/" + segments.join("/");
  const methods = (node.methods ??= new NullProtoObj());
  (methods[method] ??= []).push({
    data: data || (null as T),
    paramsRegexp,
    paramsMap: hasParams ? paramsMap : undefined,
    route: route ?? key,
    suffix: suffix && [wildcardIndex, suffix.length],
  });

  // Static (keyed by the lookup form after its one trailing-slash strip, so
  // root "/" is "" and a stripped "//" -> "/" can't reach it, #209)
  if (!hasParams) {
    ctx.static[segments.length > 0 ? key : ""] = node;
  }
}

function getParamRegexp(segment: string, unnamedStart = 0): [RegExp, number] {
  let _i = unnamedStart;
  // Replace URLPattern \x escapes outside (...) with \uFFFE placeholder
  let _s = "",
    _d = 0;
  for (let j = 0; j < segment.length; j++) {
    const c = segment.charCodeAt(j);
    if (c === 40) _d++;
    else if (c === 41 && _d > 0) _d--;
    else if (c === 92 && _d === 0 && j + 1 < segment.length) {
      const n = segment[j + 1];
      if (n !== ":" && n !== "(" && n !== "*" && n !== "\\") {
        _s += "\uFFFE" + n;
        j++;
        continue;
      }
    }
    // A literal `.` outside a (...) group is a route separator -> escape it;
    // a `.` inside a group is opaque regex and stays verbatim (`:id(\d+\.\d+)`).
    else if (c === 46 && _d === 0) {
      _s += "\\.";
      continue;
    }
    _s += segment[j];
  }
  [_s, _i] = replaceSegmentWildcards(_s, _i);

  const regex = _s
    .replace(/:([\w-]+)(?:\(([^)]*)\))?/g, (_, id, p) => `(?<${toGroupName(id)}>${p || "[^/]+"})`)
    .replace(/\((?![?<])/g, () => `(?<${toUnnamedGroupKey(_i++)}>`)
    .replace(/\uFFFE(.)/g, (_, c) => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c));

  return [new RegExp(`^${regex}$`), _i];
}
