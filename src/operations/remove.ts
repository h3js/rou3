import { expandGroupDelimiters } from "../_group-delimiters.ts";
import { hasSegmentWildcard } from "../_segment-wildcards.ts";
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

  path = path
    .replace(/\\:/g, "%3A")
    .replace(/\\\(/g, "%28")
    .replace(/\\\)/g, "%29")
    .replace(/\\\{/g, "%7B")
    .replace(/\\\}/g, "%7D");

  const segments = splitPath(path);

  const modExpanded = _expandModifiers(segments);
  if (modExpanded) {
    for (const expandedPath of modExpanded) {
      removeRoute(ctx, method, expandedPath);
    }
    return;
  }

  _remove(ctx.root, method || "", segments, 0);
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

  // Param
  if (_isParamSegment(segment)) {
    if (node.param) {
      _remove(node.param, method, segments, index + 1);
      if (_isEmptyNode(node.param)) {
        node.param = undefined;
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

function _isParamSegment(segment: string): boolean {
  return (
    segment === "*" ||
    segment.includes(":") ||
    segment.includes("(") ||
    hasSegmentWildcard(segment)
  );
}

function _isEmptyNode(node: Node) {
  return (
    node.methods === undefined &&
    node.static === undefined &&
    node.param === undefined &&
    node.wildcard === undefined
  );
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
    const wc = "/" + [...pre, `**:${name}`, ...suf].join("/");
    const without = "/" + [...pre, ...suf].join("/");
    return m[2] === "+" ? [wc] : [wc, without];
  }
}
