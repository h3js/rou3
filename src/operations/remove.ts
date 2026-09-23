import { expandGroupDelimiters } from "../_group-delimiters.ts";
import type { RouterContext, Node } from "../types.ts";
import {
  encodeEscapes,
  expandedRouteId,
  expandModifiers,
  segmentKey,
  splitRoute,
} from "./_utils.ts";

/**
 * Remove a route from the router context.
 *
 * Removal is by registration: every entry that `addRoute(ctx, method, path)`
 * created (all optional/group expansions, duplicate registrations) is removed,
 * and same-node siblings registered under other patterns (`/a/:id` vs
 * `/a/:userId`) are left alone. The pattern must be the registered one — it
 * may differ in spelling only where the tree cannot tell the difference
 * (trailing slashes, escaped statics, segments after a terminal `**`).
 */
export function removeRoute<T>(ctx: RouterContext<T>, method: string = "", path: string): void {
  // Normalize exactly like `addRoute`, or removal targets a different route
  method = method.toUpperCase();
  if (path.charCodeAt(0) !== 47 /* '/' */) {
    path = `/${path}`;
  }
  _removeRoute(ctx, method, path);
}

/** Mirrors `_add` in add.ts, including how the `route` identity is derived. */
function _removeRoute(ctx: RouterContext, method: string, path: string, route?: string): void {
  const groupExpanded = expandGroupDelimiters(path);
  if (groupExpanded) {
    route ??= expandedRouteId(path);
    for (const expandedPath of groupExpanded) {
      _removeRoute(ctx, method, expandedPath, route);
    }
    return;
  }

  path = encodeEscapes(path);

  const segments = splitRoute(path);

  const modExpanded = expandModifiers(segments);
  if (modExpanded) {
    route ??= expandedRouteId(path);
    for (const expandedPath of modExpanded) {
      _removeRoute(ctx, method, expandedPath, route);
    }
    return;
  }

  _remove(ctx, ctx.root, method, segments, 0, route, "", true);
}

/**
 * `key` accumulates the rewritten segment join of the node being walked — the
 * identity `addRoute` stamps on a non-expanding pattern and, while `isStatic`,
 * the node's `ctx.static` key — so an emptied static node drops its entry in
 * O(1) instead of scanning the map.
 */
function _remove(
  ctx: RouterContext,
  node: Node,
  method: string,
  segments: string[],
  index: number,
  route: string | undefined,
  key: string,
  isStatic: boolean,
): void {
  if (index === segments.length) {
    const methods = node.methods;
    const entries = methods?.[method];
    if (!entries) return;
    route ??= key || "/";
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].route === route) entries.splice(i, 1);
    }
    if (entries.length === 0) {
      delete methods[method];
      if (Object.keys(methods).length === 0) {
        node.methods = undefined;
        if (isStatic) delete ctx.static[key || "/"];
      }
    }
    return;
  }

  const segment = segments[index];
  const segKey = segmentKey(segment);

  // Wildcard (terminal: `addRoute` stops at `**`, so skip any trailing segments)
  if (segKey === 2) {
    if (node.wildcard) {
      _remove(
        ctx,
        node.wildcard,
        method,
        segments,
        segments.length,
        route,
        key + "/" + segment,
        false,
      );
      if (_isEmptyNode(node.wildcard)) {
        node.wildcard = undefined;
      }
    }
    return;
  }

  // Param
  if (segKey === 1) {
    if (node.param) {
      _remove(ctx, node.param, method, segments, index + 1, route, key + "/" + segment, false);
      if (_isEmptyNode(node.param)) {
        node.param = undefined;
      }
    }
    return;
  }

  // Static
  const childNode = node.static?.[segKey];
  if (childNode) {
    _remove(ctx, childNode, method, segments, index + 1, route, key + "/" + segKey, isStatic);
    if (_isEmptyNode(childNode)) {
      delete node.static![segKey];
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
