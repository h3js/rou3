import type { Node, RouterContext } from "../src/types.ts";
import { createRouter as _createRouter, addRoute } from "../src/index.ts";

export function createRouter<T extends Record<string, string> = Record<string, string>>(
  routes: string[] | Record<string, T>,
): RouterContext<T> {
  const router = _createRouter<T>();
  if (Array.isArray(routes)) {
    for (const route of routes) {
      addRoute(router, "GET", route, { path: route } as unknown as T);
    }
  } else {
    for (const [route, data] of Object.entries(routes)) {
      addRoute(router, "GET", route, data);
    }
  }
  return router;
}

/**
 * A wildcard's suffix trie (the segments after `**`, last one first) prints
 * as a `<suffix>` child of the `**` node.
 */
export function formatTree(
  node: Node<{ path?: string }>,
  depth = 0,
  result = [] as string[],
  prefix = "",
  suffix = false,
): string | string[] {
  result.push(
    // prettier-ignore
    `${prefix}${depth === 0 ? "" : "├── "}${suffix ? "<suffix>" : node.key ? `/${node.key}` : (depth === 0 ? "<root>" : "<empty>")}${_formatMethods(node)}`,
  );

  const childrenArray = [
    ...Object.values(node.static || []),
    node.param,
    node.wildcard,
    node.suffix,
  ].filter(Boolean) as Node<{ path?: string }>[];
  for (const [index, child] of childrenArray.entries()) {
    const lastChild = index === childrenArray.length - 1;
    formatTree(
      child,
      depth + 1,
      result,
      (depth === 0 ? "" : prefix + (depth > 0 ? "│   " : "    ")) + (lastChild ? "    " : "    "),
      child === node.suffix,
    );
  }

  return depth === 0 ? result.join("\n") : result;
}

function _formatMethods(node: Node<{ path?: string }>) {
  if (!node.methods) {
    return "";
  }
  return ` ┈> ${Object.entries(node.methods)
    .map(([method, arr]) => {
      const val = arr?.map((d) => d?.data?.path || JSON.stringify(d?.data)).join(" + ") || "";
      return `[${method || "*"}] ${val}`;
    })
    .join(", ")}`;
}

/** The keys of the bare `**` captures (unnamed, numbered) under `node`. */
export function bareCatchAllKeys(node: Node<unknown> | undefined): string[] {
  if (!node) return [];
  const keys: string[] = [];
  for (const entries of Object.values(node.methods || {})) {
    for (const [index, name, optional] of entries?.flatMap((m) => m.paramsMap || []) || []) {
      if (index < 0 && optional) keys.push(name as string);
    }
  }
  return keys.concat(
    ...Object.values(node.static || {}).map((child) => bareCatchAllKeys(child)),
    bareCatchAllKeys(node.param),
    bareCatchAllKeys(node.wildcard),
    bareCatchAllKeys(node.suffix),
  );
}

/**
 * A copy of `router`'s `params` without the deprecated `_` alias of a bare
 * `**` (URLPattern and `routeToRegExp` only have its numbered key). Throws
 * unless `_` is there exactly when the `**`'s numbered key is, with its value.
 */
export function withoutAlias<T extends Record<string, string | undefined>>(
  router: RouterContext<any>,
  params: T = {} as T,
): T {
  const { _: alias, ...rest } = params;
  const keys = bareCatchAllKeys(router.root);
  if (keys.length === 0) return { ...params };
  const key = keys.find((k) => k in rest);
  if (key === undefined ? "_" in params : alias !== rest[key]) {
    throw new Error(`test: \`_\` is no alias of the \`**\` key in ${JSON.stringify(params)}`);
  }
  return rest as T;
}
