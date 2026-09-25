import { CATCH_ALL, canBeEmpty, parseLevel } from "./_regexp-scan.ts";

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

// Catch-all bodies for the look-behind-free endings, in place of `[\s\S]*`:
// they match the same strings, minus one trailing slash left for the `/?$`
// after them (`a/b/` captures `a/b`, `a//` captures `a/`). `(?:[\s\S]*[^/])?`
// runs greedily to the last non-slash char and only the run of trailing
// slashes is taken lazily, so a lazy step per char (`[\s\S]*?`, several times
// slower on long paths) is paid per trailing slash only. `ANY_TAIL` may be
// empty, `SOME_TAIL` may not (a `//` tail gives `/`).
const ANY_TAIL = "(?:[\\s\\S]*[^/])?/*?";
const SOME_TAIL = "(?:[\\s\\S]*[^/]|/)/*?";

/**
 * `[possibly empty, non-empty]` tail bodies for a trailing whole-part capture
 * of `body`: rou3's catch-all `[\s\S]*`, or a `.*` constraint. The router runs
 * a constraint in JS, where `.` excludes line terminators, so `.*` keeps its
 * `.` (`[^/]` would take one as the last char) and is matched lazily instead.
 */
function tails(body: string): readonly [any: string, some: string] {
  return body === ".*" ? [".*?", ".+?"] : [ANY_TAIL, SOME_TAIL];
}

/**
 * Append the trailing-slash rule to a route regex `body`, rewriting its ending
 * so that it needs no look-behind where that is possible. The ending is the
 * body's last segment and the optional groups `(?:/…)?` after it, including
 * nested ones: `{/sub/*}?` compiles to `(?:/sub(?:/…)?)?`, and `/:x?/:y?` to
 * `(?:/…(?:/…)?)?` (see `routeToRegExpSegments`).
 *
 * Open endings (`openEnding`) are the body followed by `/?$`, which is exact
 * when a match ending in `/` minus that `/` is still a match. That holds when
 * the only parts that can be empty are a group's first segment (`:x?`, `*`,
 * `:x*`, `**`: without the slash, the group is skipped) and a trailing
 * catch-all. Each group that can be empty is made lazy so captures agree with
 * the router (`/a/` leaves `x` unset, `/a//` gives `x: ""`), except a `**`
 * one: the router reports `**` as `""` on `/a/`.
 *
 * Closed endings (`closedEnding`) build the rule in. They cover a required
 * last segment that can be empty (a whole `:x` or `*`, `**:x`, `:x+`, or an
 * empty segment: `/a//*`), whether optional segments follow it or not, at
 * the top or after a separator inside a group (`{/sub/:id}?`). The path must
 * not stop right after the segment's separator, so the segment splits into a
 * non-empty branch and one that is just the next slash: `(?:(?<x>[^/]+)/?|/)`
 * at the end, and before optional segments `(?:(?<x>[^/]+)(?:/|$)|/)`,
 * followed by the optionals without their leading slash (`$` inside an
 * alternation is an anchor, which RE2 has, not a look-around).
 *
 * The slash branch leaves the group unset where the router reports `""`, on
 * `/a//` and also mid-path (`/a//b` for `/a/:x/:y?`). No regex without
 * look-around, backreferences or duplicate group names can do better, so this
 * is the accepted trade-off. Proof, for `/a/:x/:y?`: the regex must capture
 * `x = "."` on `/a/.`, where the parts of the parse left and right of the
 * group take `/a/` and nothing. If it captured an empty `x` after `/a/` on
 * any path, that empty match with those two parts would parse `/a/`, which
 * the router rejects. A group that appears once combines this way, and so do
 * RE2's assertions: the empty match can't have used `$` (it wasn't at the
 * end), and `\b` / `\B` read the same wherever both neighbors are `/`, `.`
 * or the end.
 *
 * A trailing catch-all `[\s\S]*` (or `(.*)` constraint) gets a tail body from
 * `tails()` in all these endings, so it never captures the slash lookup
 * strips.
 *
 * The part before the last segment doesn't matter to either ending: a
 * `**` with segments after it (`/**\/:file`) takes the rest of the path
 * there, and `routeToRegExp` ends a lazy one followed by optional segments
 * only with a plain `/?$` itself.
 *
 * Anything else keeps the look-behind suffix:
 * - A part other than a trailing catch-all whose match can end in `/` (a
 *   constraint like `.+`, `[^.]+` or `\S+`, or a required catch-all before
 *   an optional segment: `/a/**:r/:y?`): the rewritten endings would let it
 *   take the stripped slash.
 * - A constraint that can match empty in a required last segment
 *   (`/a/:x(\d*)`). A closed ending needs its non-empty part, and deriving
 *   that from an arbitrary regex is not implemented (it would need a
 *   look-ahead otherwise).
 * - Optional groups side by side where an earlier one can be empty and the
 *   later ones can't nest in it (`/a/:x(\d*)?/:y?`, or a multi-segment group
 *   after `:x?`: `/a/:x?{/b/c}?`). Making the earlier one lazy would shift
 *   values into later groups, and nesting would drop paths.
 * - Optional groups side by side after a required last segment that can be
 *   empty (`/a/:x/:y(\d+)?/:z?`). A closed ending with a `(?:…(?:/|$))?` per
 *   group is possible there but not implemented.
 *
 * @param starStar Whether the route ends in a bare `**`. Its `_` group can't
 *   be told apart from a param named `_` (`:_*`) by the body alone.
 */
export function withTrailingSlash(body: string, starStar = false): string {
  // Root catch-all (`/**`, `/:x*`): every path matches. `:x*` is unset on `/`.
  const root = /^\/\?\(\?<(\w+)>\[\\s\\S\]\*\)$/.exec(body);
  if (root) {
    return starStar ? `/?(?<${root[1]}>${ANY_TAIL})/?$` : `(?:/?(?<${root[1]}>${ANY_TAIL}))??/?$`;
  }
  const open = openEnding(body, starStar);
  if (open !== undefined) {
    return `${open}/?$`;
  }
  const closed = closedEnding(body, starStar);
  return closed === undefined ? body + LOOKBEHIND_SUFFIX : `${closed}$`;
}

/**
 * Optional groups (`(?:/…)?`, side by side or nested) rebuilt for a plain
 * `/?` after them as in `openEnding`, or `undefined` where that isn't exact.
 * For the optional segments after a lazy catch-all (see `routeToRegExp`).
 */
export function openOptionals(fragment: string): string | undefined {
  return openEnding(fragment, false);
}

/**
 * `level` rebuilt for a plain `/?` after it, or `undefined` when that isn't
 * exact (see `withTrailingSlash`). Nested groups are rebuilt from the
 * innermost out: one can only be taken with the ones around it, so making
 * each lazy never shifts a value. A group that can't be empty has a single
 * parse and stays greedy.
 */
function openEnding(level: string, starStar: boolean): string | undefined {
  const parsed = parseLevel(level);
  if (!parsed) return;
  const [prefix, last, groups] = parsed;
  const inner = groups.pop();
  // A last segment after a separator (`{/bar/:id}?`: stripping the slash is
  // no match) and an optional sibling before the last group (lazy, it would
  // shift values into later groups: `/*/:y?` capturing `y` instead of `0`)
  // must not be empty.
  if ((prefix && canBeEmpty(last)) || groups.some((group) => canBeEmpty(group))) {
    return;
  }
  if (inner === undefined) {
    const tail = CATCH_ALL.exec(level);
    return tail ? `(?<${tail[1]}>${tails(tail[2])[0]})` : level;
  }
  const out = openEnding(inner, starStar);
  if (out === undefined) return;
  const head = level.slice(0, level.length - inner.length - 6);
  return `${head}(?:/${out})?${lazy(out, inner, starStar) ? "?" : ""}`;
}

/**
 * `level` with the trailing-slash rule built in, for a level whose last
 * segment is required: the top one, or a group's after a separator. Used
 * when `openEnding` can't be (see `withTrailingSlash`).
 */
function closedEnding(level: string, starStar: boolean): string | undefined {
  const parsed = parseLevel(level);
  if (!parsed || parsed[2].length > 1) return;
  const [prefix, last, [inner]] = parsed;
  if (inner === undefined) {
    const param = /^\(\?<(\w+)>(\[\^\/\]\*|\[\\s\\S\]\*|\.\*)\)$/.exec(last);
    if (!prefix || !param) return;
    return param[2] === "[^/]*"
      ? `${prefix}(?:(?<${param[1]}>[^/]+)/?|/)`
      : `${prefix}(?:/|(?<${param[1]}>${tails(param[2])[1]})/?)`;
  }
  const tail = optionalTail(inner, starStar);
  if (tail === undefined) return;
  // No head at the top (`/:x?/{b/:y}?`), or a non-empty last segment.
  if (!prefix || !canBeEmpty(last)) {
    return `${prefix}${last}(?:/${tail})?`;
  }
  if (last === "") {
    return `${prefix}/${tail}`;
  }
  const param = /^\(\?<(\w+)>\[\^\/\]\*\)$/.exec(last);
  return param ? `${prefix}(?:(?<${param[1]}>[^/]+)(?:/|$)|/)${tail}` : undefined;
}

/**
 * The paths an optional group `(?:/inner)?` can add after its slash, with
 * the rule built in, or nothing: `inner` as an open ending followed by `/?`
 * (the whole optional, lazy where the group was), or a closed one.
 */
function optionalTail(inner: string, starStar: boolean): string | undefined {
  const out = openEnding(inner, starStar);
  if (out !== undefined) {
    return `(?:${out}/?)?${lazy(out, inner, starStar) ? "?" : ""}`;
  }
  // A closed ending starts with the group's first segment and a separator,
  // so it can't be empty and the `?` has a single parse.
  const closed = parseLevel(inner)?.[0] ? closedEnding(inner, starStar) : undefined;
  return closed === undefined ? undefined : `(?:${closed})?`;
}

/** Whether the optional group around `out` (rebuilt `inner`) is lazy. */
function lazy(out: string, inner: string, starStar: boolean): boolean {
  return canBeEmpty(out) && !(starStar && inner === "(?<_>[\\s\\S]*)");
}
