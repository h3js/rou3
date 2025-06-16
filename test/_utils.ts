import type { Node, RouterContext } from "../src/types.ts";
import { createRouter as _createRouter, addRoute } from "../src/index.ts";

export function createRouter<
  T extends Record<string, string> = Record<string, string>,
>(routes: string[] | Record<string, T>): RouterContext<T> {
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

export function formatTree(
  node: Node<{ path?: string }>,
  depth = 0,
  result = [] as string[],
  prefix = "",
): string | string[] {
  result.push(
    // prettier-ignore
    `${prefix}${depth === 0 ? "" : "├── "}${node.key ? `/${node.key}` : (depth === 0 ? "<root>" : "<empty>")}${_formatMethods(node)}`,
  );

  const childrenArray = [
    ...Object.values(node.static || []),
    node.param,
    node.wildcard,
  ].filter(Boolean) as Node<{ path?: string }>[];
  for (const [index, child] of childrenArray.entries()) {
    const lastChild = index === childrenArray.length - 1;
    formatTree(
      child,
      depth + 1,
      result,
      (depth === 0 ? "" : prefix + (depth > 0 ? "│   " : "    ")) +
        (lastChild ? "    " : "    "),
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
      const val =
        arr?.map((d) => d?.data?.path || JSON.stringify(d?.data)).join(" + ") ||
        "";
      return `[${method || "*"}] ${val}`;
    })
    .join(", ")}`;
}
