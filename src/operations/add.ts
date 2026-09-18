import { expandGroupDelimiters } from "../_group-delimiters.ts";
import { toGroupName, toUnnamedGroupKey } from "../_group-names.ts";
import { replaceSegmentWildcards } from "../_segment-wildcards.ts";
import { NullProtoObj } from "../object.ts";
import type { RouterContext, ParamsIndexMap } from "../types.ts";
import { encodeEscapes, expandModifiers, segmentKey, splitRoute } from "./_utils.ts";

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
 * pattern that expands (groups, `?`/`+`/`*` modifiers) stamps its
 * *pre-expansion* text on every entry, so the `/admin` entry of `/admin/:page?`
 * is never confused with a separately registered `/admin` on the same node. A
 * plain pattern's identity is its rewritten segment join — the string the loop
 * below builds anyway (and `ctx.static` is keyed by), so the hot path pays no
 * extra pass, and spellings the tree cannot tell apart (`\)` vs `)`, `/a/` vs
 * `/a`, segments after a terminal `**`) share one identity.
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
    route ??= path;
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
    route ??= path;
    for (const p of expanded) {
      _add(ctx, method, p, data, route);
    }
    return;
  }

  let node = ctx.root;

  let _unnamedParamIndex = 0;

  const paramsMap: ParamsIndexMap = [];
  const paramsRegexp: RegExp[] = [];

  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i];
    const key = segmentKey(segment);

    // Wildcard
    if (key === 2) {
      if (!node.wildcard) {
        node.wildcard = { key: "**" };
      }
      node = node.wildcard;
      paramsMap.push([-(i + 1), segment.split(":")[1] || "_", segment.length === 2 /* no id */]);
      segments.length = i + 1; // terminal: trailing segments are not part of the identity
      break;
    }

    // Param
    if (key === 1) {
      if (!node.param) {
        node.param = { key: "*" };
      }
      node = node.param;
      if (segment === "*") {
        paramsMap.push([i, String(_unnamedParamIndex++), true /* optional */]);
      } else if (segment.includes("(") || segment.includes(":", 1) || !/^:[\w-]+$/.test(segment)) {
        const [regexp, nextIndex] = getParamRegexp(segment, _unnamedParamIndex);
        _unnamedParamIndex = nextIndex;
        paramsRegexp[i] = regexp;
        node.hasRegexParam = true;
        paramsMap.push([i, regexp, false]);
      } else {
        paramsMap.push([i, segment.slice(1), false]);
      }
      continue;
    }

    // Static
    segment = segments[i] = key;
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

  // Assign index, params and data to the node
  const hasParams = paramsMap.length > 0;
  const key = "/" + segments.join("/");
  const methods = (node.methods ??= new NullProtoObj());
  (methods[method] ??= []).push({
    data: data || (null as T),
    paramsRegexp,
    paramsMap: hasParams ? paramsMap : undefined,
    route: route ?? key,
  });

  // Static
  if (!hasParams) {
    ctx.static[key] = node;
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
