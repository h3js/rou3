// Syntax scans over `routeToRegExp()` body fragments (JS regex syntax), used
// by `withTrailingSlash` to classify a route's ending.

// One regex atom (JS syntax, no `u` flag): an escape (`\xHH`, `\uHHHH`, `\cX`,
// `\k<name>` and digit runs whole), a character class, a group opener, a
// quantifier, or a single char (`)` and `|` included).
export const ATOM: RegExp =
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
export function canEndInSlash(fragment: string): boolean {
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
export function canBeEmpty(fragment: string): boolean {
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
export function tokenize(body: string): string[] {
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

/**
 * Split a level into its head up to the last segment (empty, or ending in
 * `/` or in an optional group `(?:…/)?`), that segment, and the inners of the
 * optional groups after it (the last one is the next level). The head may be
 * anything, a catch-all with segments after it included: the endings don't
 * depend on it. `undefined` when a part's match can end in `/`
 * (a constraint like `.+` or `[^.]+`): it would keep the slash lookup strips
 * (`/a/:x(.+)` matching `/a//` with `x: "/"`), and no rewritten ending rules
 * that out. The exception is a trailing catch-all (or `.*`): any of its
 * matches minus a trailing slash is still one, and its endings leave that
 * slash out of the capture.
 */
export function parseLevel(
  level: string,
): [prefix: string, last: string, groups: string[]] | undefined {
  const tokens = tokenize(level);
  // A merged body (`mergeBodies`) can alternate at this level; its segments
  // don't line up with the tokens.
  if (tokens.includes("|")) return;
  let end = tokens.length;
  while (end > 0 && OPTIONAL_GROUP.test(tokens[end - 1])) {
    end--;
  }
  // The last segment starts after a separator, or after an optional group
  // that ends in one (`(?:(?<_>[\s\S]*)/)?`, a catch-all before it).
  let sep = end - 1;
  while (sep >= 0 && tokens[sep] !== "/" && !SEPARATOR_GROUP.test(tokens[sep])) sep--;
  const last = tokens.slice(sep + 1, end).join("");
  const groups = tokens.slice(end).map((group) => group.slice(4, -2));
  if (
    groups.slice(0, -1).some((group) => canEndInSlash(group)) ||
    (canEndInSlash(last) && !(groups.length === 0 && CATCH_ALL.test(last)))
  ) {
    return;
  }
  return [tokens.slice(0, sep + 1).join(""), last, groups];
}

/**
 * Whether `fragment` is only whole-segment optional groups `(?:/…)?`, i.e.
 * already optional as a whole.
 */
export function isOptionalGroups(fragment: string): boolean {
  const tokens = tokenize(fragment);
  return tokens.length > 0 && tokens.every((token) => OPTIONAL_GROUP.test(token));
}

/** An optional group that ends in a separator, `(?:…/)?`. */
const SEPARATOR_GROUP = /^\(\?:.*\/\)\?$/s;

/** A whole-segment optional group `(?:/…)?`. */
const OPTIONAL_GROUP = /^\(\?:\/.*\)\?$/s;

/**
 * A whole-part catch-all capture (`**`, `**:x`, `:x+`, `:x*`), or a `(.*)`
 * constraint: `[name, body]`.
 */
export const CATCH_ALL: RegExp = /^\(\?<(\w+)>(\[\\s\\S\]\*|\.\*)\)$/;
