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
  const optionals = tokens.slice(end);

  // Last segment of what precedes them.
  let sep = end - 1;
  while (sep >= 0 && tokens[sep] !== "/") {
    sep--;
  }
  // A body of only optional groups (`/:x?`, `/*`) has no segment before them.
  if (sep < 0 && end > 0) {
    return body + LOOKBEHIND_SUFFIX;
  }
  const head = tokens.slice(0, sep + 1).join("");
  const segment = end > 0 ? tokens.slice(sep + 1, end).join("") : "x";

  if (optionals.length === 0) {
    if (!canBeEmpty(segment)) {
      return `${body}/?$`;
    }
    const param = /^\(\?<(\w+)>(\[\^\/\]\*|\.\*)\)$/.exec(segment);
    if (param) {
      return param[2] === ".*"
        ? `${head}(?:/|(?<${param[1]}>.+?)/?)$`
        : `${head}(?:(?<${param[1]}>[^/]+)/?|/)$`;
    }
    return body + LOOKBEHIND_SUFFIX;
  }

  // Every match ending in `/` then ends in the last group, taken empty, and is
  // still a match without it, so `/?$` is exact. Captures need that group
  // lazy, which only works when no earlier one can be empty (it would shift
  // values into later groups: `/*/:y?` capturing `y` instead of `0`).
  const inners = optionals.map((group) => group.slice(4, -2));
  const last = inners.length - 1;
  if (canBeEmpty(segment) || inners.slice(0, last).some((inner) => canBeEmpty(inner))) {
    return body + LOOKBEHIND_SUFFIX;
  }
  if (!canBeEmpty(inners[last])) {
    return `${body}/?$`;
  }
  // `.*` must not swallow the stripped slash. The router reports `**` as `""`
  // on `/a/` (group taken), every other optional as unset (group skipped).
  const inner = inners[last].replace(/^(\(\?<\w+>\.\*)\)$/, "$1?)");
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
  let i = 0;
  while (i < body.length) {
    const start = i;
    const c = body[i];
    if (c === "\\") {
      i += 2;
    } else if (c === "[") {
      i = classEnd(body, i);
    } else if (c === "(") {
      let depth = 0;
      while (i < body.length) {
        const d = body[i];
        if (d === "\\") {
          i += 2;
          continue;
        }
        if (d === "[") {
          i = classEnd(body, i);
          continue;
        }
        i++;
        if (d === "(") depth++;
        else if (d === ")" && --depth === 0) break;
      }
      if (/[?*+]/.test(body[i] || "")) i++;
    } else {
      i++;
    }
    tokens.push(body.slice(start, i));
  }
  return tokens;
}

/** Index just past the `]` closing the class that opens at `start`. */
function classEnd(body: string, start: number): number {
  let i = start + 1;
  if (body[i] === "^") i++;
  if (body[i] === "]") i++;
  while (i < body.length && body[i] !== "]") {
    i += body[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}
