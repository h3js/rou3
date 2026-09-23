import { createRouter } from "./context.ts";
import { addRoute } from "./operations/add.ts";
import type { Node } from "./types.ts";

/**
 * The radix-tree node keys a route pattern registers on.
 *
 * rou3 buckets registrations by **tree node**, not by pattern text: every route
 * ending on one node shares that node's `methods[]` buckets, and lookup resolves
 * a node with `methods[method] || methods[""]`. Two textually distinct patterns
 * that land on the same node therefore compete for one bucket — a method-scoped
 * registration on that node hides the method-agnostic (`""`) one. Consumers that
 * key their own per-route metadata by pattern text cannot see this and silently
 * drop entries (see the README for the auth-gate shape this produces).
 *
 * The returned keys make node identity observable:
 *
 * > `routeNodeKeys(a)` and `routeNodeKeys(b)` intersect **iff** `a` and `b`
 * > share a radix node (hence one `methods[]` bucket).
 *
 * Sound in both directions *as a statement about nodes*. It is deliberately
 * **not** a statement about match-sets — the key erases regex constraints and
 * widens `**:name` to `**`, so `/u/:id(\d+)` and `/u/:slug([a-z]+)` share the
 * key `/u/*` while matching disjoint paths. Use {@link compareRoutes} for
 * match-set relations; the two properties are independent (node identity is
 * syntactic, match-set containment is semantic).
 *
 * Over-merging is the fail-closed direction here: a shared key means "these may
 * collide, keep them in one bucket", which is the safe default for the metadata
 * bucketing this is meant for.
 *
 * A pattern with optional syntax (`:x?`, `:x*`, `{...}?`) registers on several
 * nodes, so the result is a deduplicated **array**, ordered outermost-first.
 * Keys are themselves valid route patterns reaching exactly the node they name
 * (`routeNodeKeys(k)` is `[k]`), so they can be used directly as bucket ids.
 *
 * Invalid patterns throw exactly as `addRoute` does.
 *
 * @example
 * routeNodeKeys("/users/:id"); // ["/users/*"]
 * routeNodeKeys("/users/*"); // ["/users/*"]  (same node -> same bucket)
 * routeNodeKeys("/admin/**:rest"); // ["/admin/**"]
 * routeNodeKeys("/a/:x?"); // ["/a", "/a/*"]
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
  if (node.methods) keys.push(prefix || "/");
  if (node.static) {
    for (const key in node.static) {
      _collectKeys(node.static[key], prefix + "/" + _escapeKey(key), keys);
    }
  }
  if (node.param) _collectKeys(node.param, prefix + "/*", keys);
  if (node.wildcard) _collectKeys(node.wildcard, prefix + "/**", keys);
}

/**
 * Encode a decoded static key back into route syntax, so it can never be
 * confused with the `*` / `**` node markers and re-registers as the same static
 * key. Escaped literals (`\*` -> static `*`) round-trip through the marker
 * cases; route-syntax punctuation is backslash-escaped.
 */
function _escapeKey(key: string): string {
  if (key === "*") return "\\*";
  if (key === "**") return "\\*\\*";
  return key.replace(/[:(){}]/g, "\\$&");
}
