import { expandGroupDelimiters } from "../_group-delimiters.ts";
import {
  hasSegmentWildcard,
  replaceSegmentWildcards,
  toUnnamedGroupKey,
} from "../_segment-wildcards.ts";
import { NullProtoObj } from "../object.ts";
import type { RouterContext, ParamsIndexMap } from "../types.ts";
import { decodeEscaped, encodeEscapes, expandModifiers, splitPath } from "./_utils.ts";

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

  if (path.includes("{")) {
    const groupExpanded = expandGroupDelimiters(path);
    if (groupExpanded) {
      for (const expandedPath of groupExpanded) {
        addRoute(ctx, method, expandedPath, data);
      }
      return;
    }
  }

  path = encodeEscapes(path);

  const segments = splitPath(path);

  // Expand modifiers (:name?, :name+, :name*) into multiple route entries
  const expanded = expandModifiers(segments);
  if (expanded) {
    for (const p of expanded) {
      addRoute(ctx, method, p, data);
    }
    return;
  }

  let node = ctx.root;

  let _unnamedParamIndex = 0;

  const paramsMap: ParamsIndexMap = [];
  const paramsRegexp: RegExp[] = [];

  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i];

    // Wildcard
    if (segment.startsWith("**")) {
      if (!node.wildcard) {
        node.wildcard = { key: "**" };
      }
      node = node.wildcard;
      paramsMap.push([-(i + 1), segment.split(":")[1] || "_", segment.length === 2 /* no id */]);
      break;
    }

    // Param
    const isWildcardSeg = hasSegmentWildcard(segment);
    if (
      segment === "*" ||
      segment.includes(":") ||
      segment.includes("(") ||
      isWildcardSeg
    ) {
      if (!node.param) {
        node.param = { key: "*" };
      }
      node = node.param;
      if (segment === "*") {
        paramsMap.push([i, String(_unnamedParamIndex++), true /* optional */]);
      } else if (
        segment.includes(":", 1) ||
        segment.includes("(") ||
        isWildcardSeg ||
        !/^:[\w-]+$/.test(segment)
      ) {
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
    if (segment === "\\*") {
      segment = segments[i] = "*";
    } else if (segment === "\\*\\*") {
      segment = segments[i] = "**";
    }
    segment = segments[i] = decodeEscaped(segment);
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
  if (!node.methods) {
    node.methods = new NullProtoObj();
  }
  node.methods![method] ??= [];
  node.methods![method]!.push({
    data: data || (null as T),
    paramsRegexp,
    paramsMap: hasParams ? paramsMap : undefined,
  });

  // Static
  if (!hasParams) {
    ctx.static["/" + segments.join("/")] = node;
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
    _s += segment[j];
  }
  [_s, _i] = replaceSegmentWildcards(_s, _i);

  const regex = _s
    .replace(/:([\w-]+)(?:\(([^)]*)\))?/g, (_, id, p) => `(?<${id}>${p || "[^/]+"})`)
    .replace(/\((?![?<])/g, () => `(?<${toUnnamedGroupKey(_i++)}>`)
    .replace(/\./g, "\\.")
    .replace(/\uFFFE(.)/g, (_, c) => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c));

  return [new RegExp(`^${regex}$`), _i];
}
