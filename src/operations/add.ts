import { NullProtoObj } from "../object.ts";
import type { RouterContext, ParamsIndexMap } from "../types.ts";
import { splitPath } from "./_utils.ts";

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

  path = path.replace(/\\:/g, "%3A").replace(/\\\(/g, "%28").replace(/\\\)/g, "%29");

  const segments = splitPath(path);

  // Expand modifiers (:name?, :name+, :name*) into multiple route entries
  const expanded = _expandModifiers(segments);
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
      paramsMap.push([
        -(i + 1),
        segment.split(":")[1] || "_",
        segment.length === 2 /* no id */,
      ]);
      break;
    }

    // Param
    if (segment === "*" || segment.includes(":") || segment.includes("(")) {
      if (!node.param) {
        node.param = { key: "*" };
      }
      node = node.param;
      if (segment === "*") {
        paramsMap.push([i, `_${_unnamedParamIndex++}`, true /* optional */]);
      } else if (segment.includes(":", 1) || segment.includes("(")) {
        const regexp = getParamRegexp(segment);
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

function _expandModifiers(segments: string[]): string[] | undefined {
  for (let i = 0; i < segments.length; i++) {
    const m = segments[i].match(/^(.*:\w+(?:\([^)]*\))?)([?+*])$/);
    if (!m) continue;
    const pre = segments.slice(0, i);
    const suf = segments.slice(i + 1);
    if (m[2] === "?") {
      return [
        "/" + pre.concat(m[1]).concat(suf).join("/"),
        "/" + pre.concat(suf).join("/"),
      ];
    }
    const name = m[1].match(/:(\w+)/)?.[1] || "_";
    const wc = "/" + pre.concat(`**:${name}`).join("/");
    return m[2] === "+" ? [wc] : [wc, "/" + pre.join("/")];
  }
}

function getParamRegexp(segment: string): RegExp {
  let _i = 0;
  const regex = segment
    .replace(/:(\w+)(?:\(([^)]*)\))?/g, (_, id, pattern) =>
      `(?<${id}>${pattern || "[^/]+"})`,
    )
    .replace(/\((?![?<])/g, () => `(?<_${_i++}>`)
    .replace(/\./g, "\\.");
  return new RegExp(`^${regex}$`);
}
