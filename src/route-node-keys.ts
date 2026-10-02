import { createRouter } from "./context.ts";
import { addRoute } from "./operations/add.ts";
import type { Node } from "./types.ts";

/**
 * The route-tree nodes a pattern lands on, each named by a pattern.
 *
 * Routes on the same node compete: for a given path, `findRoute` returns at most
 * one of them. `/users/:id` and `/users/:name` share a node, and so do
 * `/users/*` and `/users/**:rest`. Key per-route metadata by these keys instead
 * of the pattern text to group it per node.
 *
 * - `routeNodeKeys(a)` and `routeNodeKeys(b)` share a key if and only if `a`
 *   and `b` share a node.
 * - A param segment is keyed `:_0`, `:_1`, …, and a catch-all `**`.
 * - A pattern with optional syntax (`:x?`, `:x*`, `{...}?`) lands on several
 *   nodes, so the result is an array (deduplicated, outermost first).
 * - Each key is a valid pattern for its own node: `routeNodeKeys(key)` is
 *   `[key]`.
 * - Invalid patterns throw like `addRoute`.
 *
 * Sharing a node doesn't mean matching the same paths: keys drop regex
 * constraints, so `/u/:id(\d+)` and `/u/:slug([a-z]+)` share `/u/:_0` but never
 * match the same path. Use {@link compareRoutes} to compare matched paths.
 *
 * @example
 * routeNodeKeys("/users/:id"); // ["/users/:_0"]
 * routeNodeKeys("/users/:name"); // ["/users/:_0"] (same node)
 * routeNodeKeys("/admin/*"); // ["/admin/**"] (the node of `/admin/**`)
 * routeNodeKeys("/**:path/_payload.json"); // ["/**\/_payload.json"]
 * routeNodeKeys("/a/:x?"); // ["/a", "/a/:_0"]
 */
export function routeNodeKeys(pattern: string): string[] {
  let keys = _patternKeys.get(pattern);
  if (keys === undefined) {
    // Reuse the real insertion pipeline (group delimiters, escape encoding,
    // modifier expansion, segment classification) instead of re-parsing the
    // pattern: a second parser could drift from `addRoute` and would then
    // report node identities the router does not actually use — recreating the
    // very collision this function exists to expose.
    const ctx = createRouter();
    addRoute(ctx, "", pattern);
    keys = [];
    _collectKeys(ctx.root, "", keys);
    // Keep the memo bounded; pattern vocabularies are small in practice, so a
    // full reset on overflow is simpler than recency tracking.
    if (_patternKeys.size >= 1024) _patternKeys.clear();
    _patternKeys.set(pattern, keys);
  }
  // Callers must not be able to mutate the memoized array.
  return keys.slice();
}

// Pattern -> node keys memo for `routeNodeKeys` (see its doc comment).
const _patternKeys = new Map<string, string[]>();

function _collectKeys(node: Node, prefix: string, keys: string[]): void {
  // A node carries `methods` iff some route was registered on it, so walking
  // the throwaway tree yields one key per distinct node — deduplication is free.
  if (node.methods) _pushKey(keys, prefix || "/");
  if (node.static) {
    for (const key in node.static) {
      _collectKeys(node.static[key], prefix + "/" + _escapeKey(key), keys);
    }
  }
  if (node.param) _collectKeys(node.param, prefix + PARAM, keys);
  if (node.wildcard) _collectKeys(node.wildcard, prefix + "/**", keys);
  // A wildcard's suffix trie holds the segments after `**`, last one first
  if (node.suffix) _collectSuffixKeys(node.suffix, prefix, "", keys);
}

function _collectSuffixKeys(node: Node, prefix: string, suffix: string, keys: string[]): void {
  if (node.methods) _pushKey(keys, prefix + suffix);
  if (node.static) {
    for (const key in node.static) {
      _collectSuffixKeys(node.static[key], prefix, "/" + _escapeKey(key) + suffix, keys);
    }
  }
  if (node.param) _collectSuffixKeys(node.param, prefix, PARAM + suffix, keys);
}

// A param segment, named `:_0`, `:_1`, … once its key is complete (`addRoute`
// rejects a U+FFFF, so no static key holds one)
const PARAM = "/\uFFFF";

function _pushKey(keys: string[], key: string): void {
  let n = 0;
  keys.push(key.replace(/\uFFFF/g, () => `:_${n++}`));
}

/**
 * Encode a decoded static key back into route syntax, so it can never be
 * confused with the `:_N` / `**` node markers and re-registers as the same
 * static key: route-syntax punctuation and `\` are backslash-escaped (a static
 * `*` is `\*`).
 */
function _escapeKey(key: string): string {
  return key.replace(/[\\:(){}*]/g, "\\$&");
}
