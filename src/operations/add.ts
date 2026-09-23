import { expandGroupDelimiters } from "../_group-delimiters.ts";
import { toGroupName, toUnnamedGroupKey } from "../_group-names.ts";
import { replaceSegmentWildcards } from "../_segment-wildcards.ts";
import { NullProtoObj } from "../object.ts";
import { routePatternError } from "../_pattern-error.ts";
import type { RouterContext, ParamsIndexMap } from "../types.ts";
import { encodeEscapes, expandModifiers, segmentKey, splitRoute } from "./_utils.ts";

/**
 * Add a route to the router context.
 *
 * Throws a `SyntaxError` naming `path` when a dynamic segment does not compile
 * to a `RegExp` (unbalanced `(`, a `/` inside a constraint, ...).
 */
export function addRoute<T>(
  ctx: RouterContext<T>,
  method: string = "",
  path: string,
  data?: T,
): void {
  try {
    _addRoute(ctx, method.toUpperCase(), path, data);
  } catch (err) {
    // Only `new RegExp` throws a SyntaxError here. Wrap it once, at the outer
    // entry: the recursive expansions below rewrite `path`, so this is the only
    // frame that still holds the caller's original route.
    throw routePatternError(path, err);
  }
}

function _addRoute<T>(ctx: RouterContext<T>, method: string, path: string, data?: T): void {
  if (path.charCodeAt(0) !== 47 /* '/' */) {
    path = `/${path}`;
  }

  const groupExpanded = expandGroupDelimiters(path);
  if (groupExpanded) {
    for (const expandedPath of groupExpanded) {
      _addRoute(ctx, method, expandedPath, data);
    }
    return;
  }

  path = encodeEscapes(path);

  const segments = splitRoute(path);

  // Expand modifiers (:name?, :name+, :name*) into multiple route entries
  const expanded = expandModifiers(segments);
  if (expanded) {
    for (const p of expanded) {
      _addRoute(ctx, method, p, data);
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
  const methods = (node.methods ??= new NullProtoObj());
  (methods[method] ??= []).push({
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
    else if (c === 0xff_fd) {
      // `\:` `\(` `\)` `\{` `\}` were encoded by `encodeEscapes()` before the
      // path was split (so they never act as route syntax); re-emit the literal
      // behind the regex placeholder so the resolve step below escapes it.
      _s += "\uFFFE" + ":(){}"["ABCDE".indexOf(segment[++j])];
      continue;
    } else if (c === 92 && _d === 0 && j + 1 < segment.length) {
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

  // A placeholder-escaped `:` / `(` is a literal, not a param or group opener,
  // and a placeholder-escaped `)` inside a constraint body must not close it.
  const regex = _s
    .replace(
      /(?<!\uFFFE):([\w-]+)(?:\(((?:[^)\uFFFE]|\uFFFE.)*)\))?/g,
      (_, id, p) => `(?<${toGroupName(id)}>${p || "[^/]+"})`,
    )
    .replace(/(?<!\uFFFE)\((?![?<])/g, () => `(?<${toUnnamedGroupKey(_i++)}>`)
    .replace(/\uFFFE(.)/g, (_, c) => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c));

  return [new RegExp(`^${regex}$`), _i];
}
