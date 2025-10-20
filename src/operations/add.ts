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

  const segments = splitPath(path);

  let node = ctx.root;

  let _unnamedParamIndex = 0;

  const paramsMap: ParamsIndexMap = [];
  const paramsRegexp: RegExp[] = [];

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
      if (segment === "*") {
        paramsMap.push([i, `_${_unnamedParamIndex++}`, true /* optional */]);
      } else {
        if (segment.includes(":", 1)) {
          const regexp = getParamRegexp(segment);
          paramsRegexp[i] = regexp;
          node.hasRegexParam = true;
          paramsMap.push([i, regexp, false]);
        } else {
          paramsMap.push([i, segment.slice(1), false]);
        }
      }
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
    paramsRegexp,
    paramsMap: hasParams ? paramsMap : undefined,
  });

  // Static
  if (!hasParams) {
    ctx.static[path] = node;
  }
}

function getParamRegexp(segment: string): RegExp {
  const regex = segment
    .replace(/:(\w+)/g, (_, id) => `(?<${id}>[^/]+)`)
    .replace(/\./g, "\\.");
  return new RegExp(`^${regex}$`);
}
