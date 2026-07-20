import {
  RadixNode,
  RadixRouter,
  RadixNodeData,
  NODE_TYPES,
  MatcherExport,
} from "./types";

export interface RouteTable {
  static: Map<string, RadixNodeData | null>;
  wildcard: Map<string, RadixNodeData | null>;
  dynamic: Map<string, RouteTable>;
}

export interface RouteMatcher {
  ctx: { table: RouteTable };
  matchAll: (path: string) => RadixNodeData[];
}

export function toRouteMatcher(router: RadixRouter): RouteMatcher {
  const table = _routerNodeToTable("", router.ctx.rootNode);
  return _createMatcher(table, router.ctx.options.strictTrailingSlash);
}

function _createMatcher(
  table: RouteTable,
  strictTrailingSlash?: boolean,
): RouteMatcher {
  return {
    ctx: { table },
    matchAll: (path: string) => _matchRoutes(path, table, strictTrailingSlash),
  } satisfies RouteMatcher;
}

function _createRouteTable(): RouteTable {
  return <RouteTable>{
    static: new Map(),
    wildcard: new Map(),
    dynamic: new Map(),
  };
}

function _exportMatcherFromTable(table: RouteTable): MatcherExport {
  const obj = Object.create(null);

  for (const property in table) {
    obj[property] =
      property === "dynamic"
        ? Object.fromEntries(
            [...table[property].entries()].map(([key, value]) => [
              key,
              _exportMatcherFromTable(value),
            ]),
          )
        : Object.fromEntries(table[property as keyof typeof table].entries());
  }

  return obj;
}

export function exportMatcher(matcher: RouteMatcher): MatcherExport {
  return _exportMatcherFromTable(matcher.ctx.table);
}

function _createTableFromExport(matcherExport: MatcherExport): RouteTable {
  const table: Partial<RouteTable> = {};
  for (const property in matcherExport) {
    table[property as keyof MatcherExport] =
      property === "dynamic"
        ? new Map(
            Object.entries(matcherExport[property]).map(([key, value]) => [
              key,
              _createTableFromExport(value as any),
            ]),
          )
        : new Map(
            Object.entries(matcherExport[property as keyof MatcherExport]),
          );
  }
  return table as RouteTable;
}

export function createMatcherFromExport(
  matcherExport: MatcherExport,
): RouteMatcher {
  return _createMatcher(_createTableFromExport(matcherExport));
}

function _matchRoutes(
  path: string,
  table: RouteTable,
  strictTrailingSlash?: boolean,
): RadixNodeData[] {
  // By default trailing slashes are not strict
  if (strictTrailingSlash !== true && path.endsWith("/")) {
    path = path.slice(0, -1) || "/";
  }

  // Order should be from less specific to most specific
  const matches = [];

  // Wildcard
  for (const [key, value] of _sortRoutesMap(table.wildcard)) {
    if (path === key || path.startsWith(key + "/")) {
      matches.push(value);
    }
  }

  // Dynamic
  for (const [key, value] of _sortRoutesMap(table.dynamic)) {
    if (path.startsWith(key + "/")) {
      const subPath =
        "/" + path.slice(key.length).split("/").splice(2).join("/");
      matches.push(..._matchRoutes(subPath, value));
    }
  }

  // Static
  const staticMatch = table.static.get(path);
  if (staticMatch) {
    matches.push(staticMatch);
  }

  return matches.filter(Boolean);
}

function _sortRoutesMap(m: Map<string, any>) {
  return [...m.entries()].sort((a, b) => a[0].length - b[0].length);
}

function _mergeRouteTables(a: RouteTable, b: RouteTable): RouteTable {
  const merged = _createRouteTable();
  for (const [key, value] of a.static) {
    merged.static.set(key, value);
  }
  for (const [key, value] of b.static) {
    merged.static.set(key, value);
  }
  for (const [key, value] of a.wildcard) {
    merged.wildcard.set(key, value);
  }
  for (const [key, value] of b.wildcard) {
    merged.wildcard.set(key, value);
  }
  for (const [key, value] of a.dynamic) {
    merged.dynamic.set(key, value);
  }
  for (const [key, value] of b.dynamic) {
    const existing = merged.dynamic.get(key);
    merged.dynamic.set(
      key,
      existing ? _mergeRouteTables(existing, value) : value,
    );
  }
  return merged;
}

function _routerNodeToTable(
  initialPath: string,
  initialNode: RadixNode,
): RouteTable {
  const table: RouteTable = _createRouteTable();
  function _addNode(path: string, node: RadixNode) {
    if (path) {
      if (
        node.type === NODE_TYPES.NORMAL &&
        !(path.includes("*") || path.includes(":"))
      ) {
        if (node.data) {
          table.static.set(path, node.data);
        }
      } else if (node.type === NODE_TYPES.WILDCARD) {
        table.wildcard.set(path.replace("/**", ""), node.data);
      } else if (node.type === NODE_TYPES.PLACEHOLDER) {
        const subTable = _routerNodeToTable("", node);
        if (node.data) {
          subTable.static.set("/", node.data);
        }
        // Sibling placeholders share the same dynamic key so we need
        // to merge them for shorter patterns to remain matchable.
        const key = path.replace(/\/\*|\/:\w+/, "");
        const existing = table.dynamic.get(key);
        table.dynamic.set(
          key,
          existing ? _mergeRouteTables(existing, subTable) : subTable,
        );
        return;
      }
    }
    for (const [childPath, child] of node.children.entries()) {
      _addNode(`${path}/${childPath}`.replace("//", "/"), child);
    }
  }
  _addNode(initialPath, initialNode);
  return table;
}
