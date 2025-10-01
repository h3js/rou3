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
  if (path[0] !== "/") {
    path = `/${path}`;
  }

  const segments = splitPath(path);

  let node = ctx.root;

  let _unnamedParamIndex = 0;

  const paramsMap: ParamsIndexMap = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // Wildcard
    if (segment.startsWith("**")) {
      if (!node.wildcard) {
        node.wildcard = { key: "**" };
      }
      node = node.wildcard;
      paramsMap.push([
        -i,
        segment.split(":")[1] || "_",
        segment.length === 2 /* no id */,
      ]);
      break;
    }

    // Param
    if (segment === "*" || segment.includes(":")) {
      if (!node.param) {
        node.param = { key: "*" };
      }
      node = node.param;
      const isOptional = segment === "*";
      paramsMap.push([
        i,
        isOptional
          ? `_${_unnamedParamIndex++}`
          : (_getParamMatcher(segment) as string),
        isOptional,
      ]);
      continue;
    }

    // Static
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
    paramsMap: hasParams ? paramsMap : undefined,
  });

  // Static
  if (!hasParams) {
    ctx.static[path] = node;
  }
}

function _getParamMatcher(segment: string): string | RegExp {
  if (!segment.includes(":", 1)) {
    // Single param
    return segment.slice(1);
  }
  const regex = segment
    .replace(/:(\w+)/g, (_, id) => `(?<${id}>[^/]+)`)
    .replace(/\./g, "\\.");
  return new RegExp(`^${regex}$`);
}
