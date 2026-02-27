import { expandGroupDelimiters } from "../_group-delimiters.ts";
import type { RouterContext, Node } from "../types.ts";
import { splitPath } from "./_utils.ts";

/**
 * Remove a route from the router context.
 */
export function removeRoute<T>(
  ctx: RouterContext<T>,
  method: string,
  path: string,
): void {
  const groupExpanded = expandGroupDelimiters(path);
  if (groupExpanded) {
    for (const expandedPath of groupExpanded) {
      removeRoute(ctx, method, expandedPath);
    }
    return;
  }

  const segments = splitPath(path);
  return _remove(ctx.root, method || "", segments, 0);
}

function _remove(
  node: Node,
  method: string,
  segments: string[],
  index: number,
): void /* should delete */ {
  if (index === segments.length) {
    if (node.methods && method in node.methods) {
      delete node.methods[method];
      if (Object.keys(node.methods).length === 0) {
        node.methods = undefined;
      }
    }
    return;
  }

  const segment = segments[index];

  // Param
  if (segment === "*") {
    if (node.param) {
      _remove(node.param, method, segments, index + 1);
      if (_isEmptyNode(node.param)) {
        node.param = undefined;
      }
    }
    return;
  }

  // Wildcard
  if (segment.startsWith("**")) {
    if (node.wildcard) {
      _remove(node.wildcard, method, segments, index + 1);
      if (_isEmptyNode(node.wildcard)) {
        node.wildcard = undefined;
      }
    }
    return;
  }

  // Static
  const childNode = node.static?.[segment];
  if (childNode) {
    _remove(childNode, method, segments, index + 1);
    if (_isEmptyNode(childNode)) {
      delete node.static![segment];
      if (Object.keys(node.static!).length === 0) {
        node.static = undefined;
      }
    }
  }
}

function _isEmptyNode(node: Node) {
  return (
    node.methods === undefined &&
    node.static === undefined &&
    node.param === undefined &&
    node.wildcard === undefined
  );
}
