import type {
  RadixRouterContext,
  RadixNode,
  MatchedRoute,
  RadixRouter,
  RadixNodeData,
  RadixRouterOptions,
} from "./types";
import { NODE_TYPES } from "./types";

export function createRouter<T extends RadixNodeData = RadixNodeData>(
  options: RadixRouterOptions = {},
): RadixRouter<T> {
  const ctx: RadixRouterContext = {
    options,
    rootNode: createRadixNode(),
    staticRoutesMap: {},
  };

  const normalizeTrailingSlash = (p: string) =>
    options.strictTrailingSlash ? p : p.replace(/\/$/, "") || "/";

  if (options.routes) {
    for (const path in options.routes) {
      insert(ctx, normalizeTrailingSlash(path), options.routes[path]);
    }
  }

  return {
    ctx,
    lookup: (path: string) => lookup(ctx, normalizeTrailingSlash(path)),
    insert: (path: string, data: any) =>
      insert(ctx, normalizeTrailingSlash(path), data),
    remove: (path: string) => remove(ctx, normalizeTrailingSlash(path)),
  };
}

function lookup<T extends RadixNodeData = RadixNodeData>(
  ctx: RadixRouterContext,
  path: string,
): MatchedRoute<T> | null {
  const staticPathNode = ctx.staticRoutesMap[path];
  if (staticPathNode) {
    return staticPathNode.data as MatchedRoute<T>;
  }

  const sections = path.split("/");

  const params: MatchedRoute["params"] = {};
  let paramsFound = false;
  let wildcardNode = null;
  let node: RadixNode | null = ctx.rootNode;
  let wildCardParam = null;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    if (node.wildcardChildNode !== null) {
      wildcardNode = node.wildcardChildNode;
      wildCardParam = sections.slice(i).join("/");
    }

    // Exact matches take precedence over placeholders
    const nextNode = node.children.get(section);
    if (nextNode === undefined) {
      if (node && node.placeholderChildren.length > 1) {
        // https://github.com/unjs/radix3/issues/95
        const remaining = sections.length - i;
        node =
          node.placeholderChildren.find((c) => c.maxDepth === remaining) ||
          null;
      } else {
        node = node.placeholderChildren[0] || null;
        if(node && node.paramPrefix && section.startsWith(node.paramPrefix) == false)
	  node = null;
      }
      if (!node) {
        break;
      }
      if (node.paramName) {
        params[node.paramName] = 
          node.paramPrefix ? section.slice(node.paramPrefix.length) : section;
      }
      paramsFound = true;
    } else {
      node = nextNode;
    }
  }

  if ((node === null || node.data === null) && wildcardNode !== null) {
    node = wildcardNode;
    params[node.paramName || "_"] = wildCardParam;
    paramsFound = true;
  }

  if (!node) {
    return null;
  }

  if (paramsFound) {
    return {
      ...node.data,
      params: paramsFound ? params : undefined,
    } as MatchedRoute<T>;
  }

  return node.data as MatchedRoute<T>;
}

function insert(ctx: RadixRouterContext, path: string, data: any) {
  let isStaticRoute = true;

  const sections = path.split("/");

  let node = ctx.rootNode;

  let _unnamedPlaceholderCtr = 0;

  const matchedNodes = [node];

  for (const section of sections) {
    let childNode: RadixNode<RadixNodeData> | undefined;

    if ((childNode = node.children.get(section))) {
      node = childNode;
    } else {
      const type = getNodeType(section);

      // Create new node to represent the next part of the path
      childNode = createRadixNode({ type, parent: node });

      node.children.set(section, childNode);

      if (type === NODE_TYPES.PLACEHOLDER) {
        if(section === "*")
          childNode.paramName = `_${_unnamedPlaceholderCtr++}`
	else
	{
          //allow parameter to have a prefix "path/prefix-:name"
	  let ix = section.indexOf(':');
          childNode.paramPrefix = section.slice(0, ix); 
	  childNode.paramName = section.slice(ix + 1);
	}
        node.placeholderChildren.push(childNode);
        isStaticRoute = false;
      } else if (type === NODE_TYPES.WILDCARD) {
        node.wildcardChildNode = childNode;
        childNode.paramName = section.slice(3 /* "**:" */) || "_";
        isStaticRoute = false;
      }

      matchedNodes.push(childNode);
      node = childNode;
    }
  }

  for (const [depth, node] of matchedNodes.entries()) {
    node.maxDepth = Math.max(matchedNodes.length - depth, node.maxDepth || 0);
  }

  // Store whatever data was provided into the node
  node.data = data;

  // Optimization, if a route is static and does not have any
  // variable sections, we can store it into a map for faster retrievals
  if (isStaticRoute === true) {
    ctx.staticRoutesMap[path] = node;
  }

  return node;
}

function remove(ctx: RadixRouterContext, path: string) {
  let success = false;
  const sections = path.split("/");
  let node: RadixNode | undefined = ctx.rootNode;

  for (const section of sections) {
    node = node.children.get(section);
    if (!node) {
      return success;
    }
  }

  if (node.data) {
    const lastSection = sections.at(-1) || "";
    node.data = null;
    if (Object.keys(node.children).length === 0 && node.parent) {
      node.parent.children.delete(lastSection);
      node.parent.wildcardChildNode = null;
      node.parent.placeholderChildren = [];
    }
    success = true;
  }

  return success;
}

function createRadixNode(options: Partial<RadixNode> = {}): RadixNode {
  return {
    type: options.type || NODE_TYPES.NORMAL,
    maxDepth: 0,
    parent: options.parent || null,
    children: new Map(),
    data: options.data || null,
    paramName: options.paramName || null,
    paramPrefix: null,
    wildcardChildNode: null,
    placeholderChildren: [],
  };
}

function getNodeType(str: string) {
  if (str.startsWith("**")) {
    return NODE_TYPES.WILDCARD;
  }
  if (str.includes(":") || str === "*") {
    return NODE_TYPES.PLACEHOLDER;
  }
  return NODE_TYPES.NORMAL;
}
