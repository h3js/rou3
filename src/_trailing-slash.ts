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

// Catch-all bodies for the look-behind-free endings, in place of `.*`: they
// match the same strings, minus one trailing slash left for the `/?$` after
// them (`a/b/` captures `a/b`, `a//` captures `a/`). `(?:.*[^/])?` runs
// greedily to the last non-slash char and only the run of trailing slashes is
// taken lazily, so a lazy step per char (`.*?`, several times slower on long
// paths) is paid per trailing slash only. `ANY_TAIL` may be empty, `SOME_TAIL`
// may not (a `//` tail gives `/`). Unlike `.`, `[^/]` also matches a line
// terminator, so one is accepted as the last non-slash char (the router takes
// line terminators anywhere; `.*` rejects them elsewhere).
const ANY_TAIL = "(?:.*[^/])?/*?";
const SOME_TAIL = "(?:.*[^/]|/)/*?";

/**
 * Append the trailing-slash rule to a route regex `body`, rewriting its ending
 * when that removes the need for look-behinds:
 *
 * - The body can never end in `/` (static or non-empty last segment, or
 *   trailing optional groups that cannot be empty, none of them able to match
 *   a string ending in `/`): a plain `/?$`.
 * - Only the last optional group can be empty (`:x?`, trailing `*`, `:x*`,
 *   `**`): every match ending in `/` minus that `/` is still a match, so `/?$`
 *   is exact too; the group is made lazy so captures agree with the router
 *   (`/a/` leaves `x` unset, `/a//` gives `x: ""`).
 * - A required whole-segment `:x` / `**:x` ends the route: split into a
 *   non-empty branch with an optional slash and an empty branch with exactly
 *   one. That branch leaves the group unset where the router reports `""`.
 *
 * A trailing catch-all `.*` becomes `ANY_TAIL` / `SOME_TAIL` in these endings,
 * so it never captures the slash `/?$` strips.
 *
 * Anything else keeps the look-behind suffix. That includes a required
 * empty-capable segment followed by optional ones (`/a/:x/:y?`): the path must
 * not stop right after its separator, and without look-around saying so needs
 * the optional groups in two alternation branches, i.e. duplicate group names,
 * which RE2 rejects as well. It also includes any part whose match can end in
 * `/` other than the trailing catch-all (a constraint like `.+`, `[^.]+` or
 * `\S+`): the rewritten endings would let it take the stripped slash.
 *
 * @param starStar Whether the route ends in a bare `**`. Its `_` group can't
 *   be told apart from a param named `_` (`:_*`) by the body alone.
 */
export function withTrailingSlash(body: string, starStar = false): string {
  // Root catch-all (`/**`, `/:x*`): every path matches. `:x*` is unset on `/`.
  const root = /^\/\?\(\?<(\w+)>\.\*\)$/.exec(body);
  if (root) {
    return starStar ? `/?(?<${root[1]}>${ANY_TAIL})/?$` : `(?:/?(?<${root[1]}>${ANY_TAIL}))??/?$`;
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
  // A part whose match can end in `/` (a constraint like `.+` or `[^.]+`) would
  // keep the slash lookup strips (`/a/:x(.+)` matching `/a//` with `x: "/"`),
  // and none of the endings below rules that out. The exception is a trailing
  // catch-all `.*`: any of its matches minus a trailing slash is still one, and
  // its endings below leave that slash out of the capture.
  if (parts.some((part, i) => canEndInSlash(part) && !(i === last && CATCH_ALL.test(part)))) {
    return body + LOOKBEHIND_SUFFIX;
  }
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
      ? `${head}(?:/|(?<${param[1]}>${SOME_TAIL})/?)$`
      : `${head}(?:(?<${param[1]}>[^/]+)/?|/)$`;
  }

  // Every match ending in `/` then ends in the last group, taken empty, and is
  // still a match without it, so `/?$` is exact. Captures need that group
  // lazy, which only works when no earlier one can be empty (it would shift
  // values into later groups: `/*/:y?` capturing `y` instead of `0`).
  // `.*` must not swallow the stripped slash. The router reports `**` as `""`
  // on `/a/` (group taken), every other optional as unset (group skipped).
  const inner = CATCH_ALL.test(parts[last]) ? parts[last].replace(".*", ANY_TAIL) : parts[last];
  const lazy = starStar && parts[last] === "(?<_>.*)" ? "" : "?";
  return `${tokens.slice(0, -1).join("")}(?:/${inner})?${lazy}/?$`;
}

/** A whole-part catch-all capture (`**`, `**:x`, `:x+`, `:x*`, `(.*)`). */
const CATCH_ALL = /^\(\?<\w+>\.\*\)$/;

// One regex atom (JS syntax, no `u` flag): an escape (`\xHH`, `\uHHHH`, `\cX`,
// `\k<name>` and digit runs whole), a character class, a group opener, a
// quantifier, or a single char (`)` and `|` included).
const ATOM =
  /\\(?:x[\da-f]{2}|u[\da-f]{4}|c[a-z]|k<[^>]*>|\d+|[^])|\[(?:\\[^]|[^\\\]])*\]?|\((?:\?(?:<?[=!]|<[^>]*>|[\w-]*:))?|(?:[*+?]|\{\d+(?:,\d*)?\})\??|[^]/gi;

/** `[canEndInSlash, canBeEmpty]` of a regex item. */
type Item = [slash: boolean, empty: boolean];

/**
 * Whether some match of a segment regex (a body fragment) can end in `/`.
 * Conservative, so a `false` is a proof: it walks each alternative back from
 * its end over the items that can match empty, and asks every char, class or
 * escape reached whether it matches `/`. Backreferences and anything it can't
 * parse count as ending in `/`. rou3's own `[^/]*` / `[^/]+`, literals and
 * constraints such as `\d+` or `[a-z0-9-]+` do not; `.+`, `[^.]+`, `\S+` do.
 */
function canEndInSlash(fragment: string): boolean {
  // Open groups: opener, then alternatives as item lists.
  const stack: [open: string, alternatives: Item[][]][] = [["", [[]]]];
  for (const atom of fragment.match(ATOM) || []) {
    const [open, alternatives] = stack[stack.length - 1];
    const items = alternatives[alternatives.length - 1];
    if (atom[0] === "(") {
      stack.push([atom, [[]]]);
    } else if (atom === ")") {
      if (stack.length === 1) return true;
      stack.pop();
      const parent = stack[stack.length - 1][1];
      // Look-arounds consume nothing.
      parent[parent.length - 1].push(/[=!]$/.test(open) ? [false, true] : join(alternatives));
    } else if (atom === "|") {
      alternatives.push([]);
    } else if (/^(?:[*+?]|\{\d)/.test(atom)) {
      if (items.length === 0) return true;
      if (/^(?:[*?]|\{0*[,}])/.test(atom)) items[items.length - 1][1] = true;
    } else if (/^(?:[$^]|\\[bB])$/.test(atom)) {
      items.push([false, true]);
    } else if (/^\\[\dk]/.test(atom)) {
      // Backreference (or octal escape): may repeat anything.
      items.push([true, true]);
    } else {
      items.push([matchesSlash(atom), false]);
    }
  }
  return stack.length > 1 || join(stack[0][1])[0];
}

/** Combine the alternatives of a group into one item. */
function join(alternatives: Item[][]): Item {
  let slash = false;
  let empty = false;
  for (const items of alternatives) {
    for (let i = items.length - 1; i >= 0 && !slash; i--) {
      slash = items[i][0];
      if (!items[i][1]) break;
    }
    empty ||= items.every((item) => item[1]);
  }
  return [slash, empty];
}

/** Whether a single char, class or escape matches `/`. */
function matchesSlash(atom: string): boolean {
  try {
    return new RegExp(`^(?:${atom})$`).test("/");
  } catch {
    return true;
  }
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
