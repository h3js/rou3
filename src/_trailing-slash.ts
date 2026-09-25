// Trailing-slash suffix for `routeToRegExp()` bodies (raw `/`, before `RegExp`
// escaping).
//
// Lookup ignores at most one trailing slash (#209): a path matches iff the body
// matches it with one trailing `/` stripped. So `/a/b` and `/a/b/` reach
// `/a/b` but `/a/b//` does not, and when the body match itself ends in `/` (an
// empty last segment: `/a//` reaches `/a/:x` with `x: ""`) exactly one more
// must follow. The general encoding needs look-behinds, which RE2-family
// engines (Go, Rust `regex`, RE2) reject, so the common endings are rewritten
// look-behind free and only the rest fall back to `LOOKBEHIND_SUFFIX`.
const LOOKBEHIND_SUFFIX = "(?:(?<=/)/|(?<!/)/?)$";

/**
 * Append the trailing-slash rule to a route regex `body`, rewriting its ending
 * when that removes the need for look-behinds:
 *
 * - The body can never end in `/` (static or non-empty last segment, or
 *   trailing optional groups that cannot be empty): a plain `/?$`.
 * - Only the last optional group can be empty (`:x?`, trailing `*`, `:x*`,
 *   `**`): every match ending in `/` minus that `/` is still a match, so `/?$`
 *   is exact too; the group is made lazy so captures agree with the router
 *   (`/a/` leaves `x` unset, `/a//` gives `x: ""`).
 * - A required whole-segment `:x` / `**:x` ends the route: split into a
 *   non-empty branch with an optional slash and an empty branch with exactly
 *   one. That branch leaves the group unset where the router reports `""`.
 *
 * Anything else keeps the look-behind suffix. That includes a required
 * empty-capable segment followed by optional ones (`/a/:x/:y?`): the path must
 * not stop right after its separator, and without look-around saying so needs
 * the optional groups in two alternation branches, i.e. duplicate group names,
 * which RE2 rejects as well.
 */
export function withTrailingSlash(body: string): string {
  // Root catch-all (`/**`, `/:x*`): every path matches.
  const root = /^\/\?\(\?<(\w+)>\.\*\)$/.exec(body);
  if (root) {
    return `/?(?<${root[1]}>.*?)/?$`;
  }

  const tokens = tokenize(body);

  // Peel trailing whole-segment optional groups `(?:/…)?`.
  let end = tokens.length;
  while (end > 0 && /^\(\?:\/.*\)\?$/s.test(tokens[end - 1])) {
    end--;
  }
  // The last segment before them (none if the body is only optionals), then
  // each optional's inner regex. Only the last of these may match empty.
  const sep = tokens.slice(0, end).lastIndexOf("/");
  const parts = [
    end > 0 ? tokens.slice(sep + 1, end).join("") : "x",
    ...tokens.slice(end).map((group) => group.slice(4, -2)),
  ];
  const last = parts.length - 1;
  // An inline group can span segments (`{/bar/:id}?`): only its last one can
  // leave the match ending in `/`, and stripping that `/` is then no match.
  const tail = tokenize(parts[last]);
  const multi = tail.lastIndexOf("/") + 1;
  parts[last] = tail.slice(multi).join("");
  const empty = parts.findIndex((part) => canBeEmpty(part));
  if (empty < 0) {
    return `${body}/?$`;
  }
  if (empty < last || multi > 0) {
    return body + LOOKBEHIND_SUFFIX;
  }

  if (last === 0) {
    const param = /^\(\?<(\w+)>(\[\^\/\]\*|\.\*)\)$/.exec(parts[0]);
    if (!param) {
      return body + LOOKBEHIND_SUFFIX;
    }
    const head = tokens.slice(0, sep + 1).join("");
    return param[2] === ".*"
      ? `${head}(?:/|(?<${param[1]}>.+?)/?)$`
      : `${head}(?:(?<${param[1]}>[^/]+)/?|/)$`;
  }

  // Every match ending in `/` then ends in the last group, taken empty, and is
  // still a match without it, so `/?$` is exact. Captures need that group
  // lazy, which only works when no earlier one can be empty (it would shift
  // values into later groups: `/*/:y?` capturing `y` instead of `0`).
  // `.*` must not swallow the stripped slash. The router reports `**` as `""`
  // on `/a/` (group taken), every other optional as unset (group skipped).
  const inner = parts[last].replace(/^(\(\?<\w+>\.\*)\)$/, "$1?)");
  const lazy = inner.startsWith("(?<_>") ? "" : "?";
  return `${tokens.slice(0, -1).join("")}(?:/${inner})?${lazy}/?$`;
}

/** Whether a segment regex (a body fragment) can match the empty string. */
function canBeEmpty(fragment: string): boolean {
  try {
    return new RegExp(`^(?:${fragment})$`).test("");
  } catch {
    return true;
  }
}

/**
 * Split a regex body into top-level tokens: a group together with its
 * quantifier, a character class, an escape, or a single char.
 */
function tokenize(body: string): string[] {
  const tokens: string[] = [];
  let depth = 0;
  for (const atom of body.match(/\\[^]|\[(?:\\[^]|[^\\\]])*\]?|\)[?*+]?|[^]/g) || []) {
    if (depth === 0) tokens.push("");
    tokens[tokens.length - 1] += atom;
    if (atom === "(") depth++;
    else if (atom[0] === ")" && depth > 0) depth--;
  }
  return tokens;
}
