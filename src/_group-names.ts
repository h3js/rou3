// Route param names accept `[\w-]+`, but a named capture group must be a valid
// identifier — no `-`, no leading digit — in JS and in PCRE alike. Names that
// can't be emitted verbatim are escaped into a reserved form so `(?<name>...)`
// stays compilable, and decoded back when groups are read: params always surface
// under the original route name (`:test-id` -> `params["test-id"]`).
//
// The escape is a prefix code (every `_` in the output opens a two-char escape),
// so it is injective: distinct names can never collide (`:a-b`, `:a_b`, `:a--b`
// stay distinct, unlike a plain `-` -> `_` sanitize) and decoding is exact. It
// stays inside `[A-Za-z0-9_]`, so the output is a legal PCRE group name too.

export const UNNAMED_GROUP_PREFIX = "__rou3_unnamed_";

export const ESCAPED_GROUP_PREFIX = "__rou3_esc_";

export function toUnnamedGroupKey(index: number): string {
  return `${UNNAMED_GROUP_PREFIX}${index}`;
}

/**
 * Encode a param name as a capture-group name. Valid identifiers pass through
 * unchanged (the common case); the rest are escaped (`_` -> `__`, `-` -> `_h`)
 * behind {@link ESCAPED_GROUP_PREFIX}. Names in the reserved `__rou3_` space, and
 * `_N`-shaped ones (the unnamed-capture form `routeToRegExp` emits), are escaped
 * too, so a group name maps back to exactly one param name.
 */
export function toGroupName(name: string): string {
  return /^(?!__rou3_|_\d)[A-Za-z_]\w*$/.test(name)
    ? name
    : ESCAPED_GROUP_PREFIX + name.replace(/[_-]/g, (c) => (c === "_" ? "__" : "_h"));
}

/** Decode a capture-group name into its param name (inverse of {@link toGroupName}). */
export function fromGroupName(key: string): string {
  if (key.charCodeAt(0) !== 95 /* `_` */) {
    return key; // fast path: not in the reserved space
  }
  if (key.startsWith(ESCAPED_GROUP_PREFIX)) {
    return key
      .slice(ESCAPED_GROUP_PREFIX.length)
      .replace(/__|_h/g, (c) => (c === "__" ? "_" : "-"));
  }
  return key.startsWith(UNNAMED_GROUP_PREFIX) ? key.slice(UNNAMED_GROUP_PREFIX.length) : key;
}
