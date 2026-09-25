import { canBeEmpty, canEndInSlash, tokenize } from "./_regexp-scan.ts";

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
 * when that removes the need for look-behinds. The ending is the body's last
 * segment and its trailing optional groups `(?:/…)?`, including the ones
 * nested in the last group (`{/sub/*}?` compiles to `(?:/sub(?:/…)?)?`):
 *
 * - The body can never end in `/` (static or non-empty last segment, or
 *   trailing optional groups that cannot be empty, none of them able to match
 *   a string ending in `/`): a plain `/?$`.
 * - Only the innermost last optional group can be empty (`:x?`, trailing `*`,
 *   `:x*`, `**`), apart from the single-segment heads of the groups around it
 *   (`{/:x/*}?`): every match ending in `/` minus that `/` is still a match
 *   (the empty group, or the group around the empty head, skipped), so `/?$`
 *   is exact too. Each of those groups is made lazy so captures agree with
 *   the router (`/a/` leaves `x` unset, `/a//` gives `x: ""`), except for a
 *   `**` group: the router reports `**` as `""` on `/a/`.
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

  // Walk the ending, one level per nested last group. `prefixes[i]` is level
  // `i` up to its last group, whose inner is level `i + 1`.
  const prefixes: string[] = [];
  // Last segment of each level's head, and of each optional before its last
  // group. Only the last part and `optional` ones (the head of a level inside a
  // group, when it is that group's first segment) may be empty.
  const parts: string[] = [];
  const optional = new Set<number>();
  let level = body;
  let tokens = tokenize(level);
  for (;;) {
    let end = tokens.length;
    while (end > 0 && OPTIONAL_GROUP.test(tokens[end - 1])) {
      end--;
    }
    // A level made only of optionals has no head, and at the top the route
    // can't end in `/` without them.
    const sep = tokens.slice(0, end).lastIndexOf("/");
    if (prefixes.length === 0 && end === 0) {
      parts.push("x");
    } else {
      if (prefixes.length > 0 && sep < 0) optional.add(parts.length);
      parts.push(tokens.slice(sep + 1, end).join(""));
    }
    const groups = tokens.slice(end).map((group) => group.slice(4, -2));
    if (groups.length === 0) break;
    parts.push(...groups.slice(0, -1));
    prefixes.push(tokens.slice(0, -1).join(""));
    level = groups[groups.length - 1];
    tokens = tokenize(level);
  }
  const last = parts.length - 1;

  // A part whose match can end in `/` (a constraint like `.+` or `[^.]+`) would
  // keep the slash lookup strips (`/a/:x(.+)` matching `/a//` with `x: "/"`),
  // and none of the endings below rules that out. The exception is a trailing
  // catch-all `.*`: any of its matches minus a trailing slash is still one, and
  // its endings below leave that slash out of the capture.
  if (parts.some((part, i) => canEndInSlash(part) && !(i === last && CATCH_ALL.test(part)))) {
    return body + LOOKBEHIND_SUFFIX;
  }
  const empty = parts.map((part) => canBeEmpty(part));
  if (!empty.includes(true)) {
    return `${body}/?$`;
  }

  if (last === 0) {
    const param = /^\(\?<(\w+)>(\[\^\/\]\*|\.\*)\)$/.exec(parts[0]);
    if (!param) {
      return body + LOOKBEHIND_SUFFIX;
    }
    const head = level.slice(0, level.length - parts[0].length);
    return param[2] === ".*"
      ? `${head}(?:/|(?<${param[1]}>${SOME_TAIL})/?)$`
      : `${head}(?:(?<${param[1]}>[^/]+)/?|/)$`;
  }
  // An empty-capable required segment or optional sibling before the last
  // group, or a last segment after a separator inside its group
  // (`{/bar/:id}?`, where stripping the slash is no match) needs look-around;
  // so would making that sibling lazy, which shifts values into later groups
  // (`/*/:y?` capturing `y` instead of `0`).
  if (empty.some((canBe, i) => canBe && !optional.has(i))) {
    return body + LOOKBEHIND_SUFFIX;
  }

  // Rebuild from the innermost level out: a nested group can only be taken
  // with the ones around it, so making each lazy never shifts a value. A group
  // that can't be empty has a single parse and stays as is.
  let out = CATCH_ALL.test(level) ? level.replace(".*", ANY_TAIL) : level;
  for (let i = prefixes.length - 1; i >= 0; i--) {
    const greedy =
      !canBeEmpty(out) || (starStar && i === prefixes.length - 1 && level === "(?<_>.*)");
    out = `${prefixes[i]}(?:/${out})?${greedy ? "" : "?"}`;
  }
  return `${out}/?$`;
}

/**
 * Whether `fragment` is only whole-segment optional groups `(?:/…)?`, i.e.
 * already optional as a whole.
 */
export function isOptionalGroups(fragment: string): boolean {
  const tokens = tokenize(fragment);
  return tokens.length > 0 && tokens.every((token) => OPTIONAL_GROUP.test(token));
}

/** A whole-segment optional group `(?:/…)?`. */
const OPTIONAL_GROUP = /^\(\?:\/.*\)\?$/s;

/** A whole-part catch-all capture (`**`, `**:x`, `:x+`, `:x*`, `(.*)`). */
const CATCH_ALL = /^\(\?<\w+>\.\*\)$/;
