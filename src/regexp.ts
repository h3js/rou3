import { expandGroupDelimiters, scanFirstGroup } from "./_group-delimiters.ts";
import { toGroupName } from "./_group-names.ts";
import { createRouter } from "./context.ts";
import { addRoute, getParamRegexp, skipGroup, type Unnamed } from "./operations/add.ts";
import {
  encodeEscapes,
  expandModifiers,
  PARAM_MODIFIER,
  segmentKey,
  splitRoute,
} from "./operations/_utils.ts";
import { appendsCleanly } from "./_optional-append.ts";
import { canBeEmpty, isOptionalGroups } from "./_regexp-scan.ts";
import { ANY_TAIL, openOptionals, withTrailingSlash } from "./_trailing-slash.ts";

// Catch-all body. The router splits paths on `/` only, so a catch-all takes
// any char, line terminators included; `.` would not (JS excludes `\n`, `\r`,
// U+2028 and U+2029, PCRE and RE2 by default only `\n`). `[\s\S]` is any char
// in all of them.
const ANY = "[\\s\\S]*";
// A `**:name` / `:name+` / `:name*`, which needs a value (see `emptyParam`)
const SOME = "[\\s\\S]+";
// `openTail` of a route ending in a `*`, or in a lazy one and optional
// segments: it may take nothing after the stripped trailing slash, so the path
// is the body plus `/?` (see `routeToRegExpSegments`, `ending`)
const STAR_TAIL = "*";
const STAR_OPEN = "*?";
// A `*` followed by optional segments only, where a plain `/?$` would not be
// exact: the routes the tree registers are compiled one by one instead
const STAR_BAIL = "*!";

/**
 * Convert a rou3 route pattern into an anchored {@link RegExp}.
 *
 * The generated source targets a **PCRE-compatible** flavor: named groups use
 * the `(?<name>...)` form and no JS-only constructs are emitted, so the output
 * also compiles in PCRE2 engines (`grep -P`, `rg -P`, `pcre2grep`, PHP `preg_*`)
 * and Perl. Optional segments (`:name?`) and a single optional group ending a
 * segment (`{...}?`, also before more of the route) are compiled inline as
 * `(?:...)?` rather than an alternation, so a param is never emitted as a
 * duplicate named group — which PCRE2 rejects unless `PCRE2_DUPNAMES` is set,
 * and V8 before 12.5 (Node 22) rejects outright.
 *
 * The regex matches exactly the paths `findRoute()` matches for a router holding
 * only `route` — including the router's tolerances: one optional trailing slash,
 * empty segments for `*` / `**` (a `:name` / `:name+` / `:name*` needs a
 * value), and a trailing `*` that takes nothing after the stripped slash
 * (`/a/*` matches `/a/`, not `/a`) — so it can stand in for the router as a
 * guard or scope check. Not modeled: param
 * constraints that can match `/` (`(.*)`: the tree splits on `/` first, so
 * the regex matches more paths, never fewer), the empty path, and
 * `normalize: true`.
 *
 * Most routes also compile to RE2-compatible output (RE2, Go, Rust `regex`):
 * the trailing-slash rule is encoded without look-behinds, except for the few
 * endings `withTrailingSlash` lists (e.g. a constraint that can end in `/`, or a
 * required segment whose constraint can match empty).
 *
 * Note: other optionals (several groups, `/media/*{.webp}?`) still fall back to
 * alternation and may contain duplicate named groups (valid in Perl and in JS
 * engines that support them, V8 12.5+; they need `PCRE2_DUPNAMES` for strict
 * PCRE2 engines). On an engine without them (Node 22), `routeToRegExp` throws a
 * `rou3:` `SyntaxError` for these routes.
 *
 * @throws a `rou3:` error when one expansion of `route` declares the same param
 * name twice (`/files/:path/**:path`, `/a/:x{/b/:x}?`); the resulting duplicate
 * named group would compile on some engines and not on others.
 *
 * A `*` is a catch-all (`[\s\S]*`), also inside a segment (`/*.png` matches
 * `/a/b.png`). Segments after a catch-all (`/**\/_payload.json`, `/*\/edit`,
 * and a `:name+` / `:name*` before the last segment) follow it in the regex,
 * so they match at the end of the path as in the router. Where the route has
 * one optional segment after it, the catch-all is lazy or greedy to pick the
 * route the router picks (see `lazyCatchAll`); with several, it matches the
 * same paths but may capture like another of the routes the pattern
 * registers.
 *
 * @throws a `rou3:` error, the one `addRoute` throws, for every pattern
 * `addRoute` rejects: more than one catch-all (`/**\/**`, `/*\/x/*`,
 * `/a/:x+/b/:y+`), a `(
 * that does not close in its own segment (`/files/(2024`, `/a/:id([^/]+)`),
 * and syntax with no meaning yet (see `addRoute`).
 *
 * @example
 * routeToRegExp("/users/:id(\\d+)"); // /^\/users\/(?<id>\d+)\/?$/
 * routeToRegExp("/blog/:id(\\d+){-:title}?"); // /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+?))?\/?$/
 * routeToRegExp("/v:version?"); // /^\/v(?:(?<version>[^/]+?))?\/?$/
 */
export function routeToRegExp(route: string = "/"): RegExp {
  if (route.charCodeAt(0) !== 47 /* '/' */) {
    route = `/${route}`;
  }
  // Validate with the router itself: every pattern it rejects (see
  // `addRoute`) throws here with the same error.
  addRoute(createRouter(), "", route);
  return toRegExp(route, route);
}

/**
 * `routeToRegExp` of `route`, an expansion of `input` (quoted in errors),
 * whose unnamed captures are keyed by `unnamed` (see `skipGroup`).
 */
function toRegExp(route: string, input: string, unnamed?: Unnamed): RegExp {
  // Compile a single optional group (`{...}?`) inline as `(?:...)?`
  // instead of expanding it into an alternation of full routes. The alternation
  // form re-emits every param before the group in both branches, producing
  // duplicate named groups that PCRE2-family engines reject.
  const inlineOptional = inlineOptionalGroup(route, input, unnamed);
  if (inlineOptional) {
    return inlineOptional;
  }

  // Modifiers the inline emitter cannot mirror expand exactly like `addRoute`
  // (groups first, then modifiers, read with escapes encoded: `\:x?` is none).
  const groups = expandGroupDelimiters(route);
  const groupExpanded =
    groups ||
    (needsModifierExpansion(route)
      ? expandModifiers(splitRoute(encodeEscapes(route)), input)
      : undefined);
  if (groupExpanded) {
    // Expansions can compile to the same regex (`/a/:x+/b{c}?` is `/a/**:x`
    // either way): `alternation` keeps one copy of each. The one without a
    // group keys its unnamed captures like the one with it (`skipGroup`).
    return alternation(
      groupExpanded.map((expandedRoute, i) =>
        toRegExp(
          expandedRoute,
          input,
          groups && i > 0 ? skipGroup(route, input, unnamed) : unnamed,
        ),
      ),
      input,
    );
  }

  return _routeToRegExp(route, input, unnamed);
}

/** The regexes of `input`'s routes as alternatives, each once. */
function alternation(regexps: RegExp[], input: string): RegExp {
  const sources = [...new Set(regexps.map((regexp) => regexp.source.slice(1, -1)))];
  if (sources.length === 1) {
    return new RegExp(`^${sources[0]}$`);
  }
  // Note: alternation branches may still contain duplicate named capture
  // groups (e.g. `(?<id>a)|(?<id>b)`) for optionals that can't be inlined.
  // This is valid in JS engines with duplicate named groups (V8 12.5+ /
  // Node 23+, Firefox 129+, Safari 17+), but throws on Node 22 and is not
  // portable to PCRE2 without PCRE2_DUPNAMES. Each branch compiled on its
  // own, so a `SyntaxError` here is the engine rejecting duplicate names.
  try {
    return new RegExp(`^(?:${sources.join("|")})$`);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new SyntaxError(
      `rou3: the regex for "${input}" repeats a named group across alternatives, which needs duplicate named groups support (Node.js 23+, Chrome 125+, Firefox 129+, Safari 17+)`,
      { cause: error },
    );
  }
}

/**
 * `pre{/static…}?` where `pre` ends in a `*` (or `pre/{static…}?`): the
 * router's route with the group wins wherever both match (its last segment is
 * a literal, the other's is the `*`'s), so a lazy `*` followed by the
 * optional segments matches like it, without the alternation's duplicate
 * group names. `undefined` for any other shape.
 */
function lazyStarGroup(
  pre: string,
  body: string,
  input: string,
  unnamed?: Unnamed,
): RegExp | undefined {
  const slash = pre.endsWith("/");
  if (slash === (body.charCodeAt(0) === 47) /* '/' */) {
    return;
  }
  const keys: string[] = [];
  for (const segment of splitRoute(slash ? `/${body}` : body)) {
    const key = segment && segmentKey(encodeEscapes(segment));
    if (typeof key !== "string" || key === "") {
      return;
    }
    keys.push(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  const [segments, ownSeparator, openTail] = routeToRegExpSegments(
    slash ? pre.slice(0, -1) : pre,
    input,
    [],
    unnamed,
  );
  const base = joinSegments(segments, ownSeparator);
  if (openTail === STAR_TAIL && base.endsWith(`${ANY})`)) {
    return new RegExp(`^${base.slice(0, -1)}?)(?:/${keys.join("/")})?/?$`);
  }
}

/**
 * Build an inline-optional regex for a route with a single `{…}?` group that
 * ends a segment (`/book{s}?`, `/foo{/bar}?/:id`). Returns `undefined`
 * (falling back to alternation expansion) for anything it can't inline
 * safely: multi-group routes, a group inside a segment, or unexpected segment
 * shapes.
 */
function inlineOptionalGroup(route: string, input: string, unnamed?: Unnamed): RegExp | undefined {
  const group = scanFirstGroup(route);
  if (!group) {
    return;
  }
  const [pre, body, suf, mod] = group;
  // Static segments after a route ending in a `*` (`/a/*{/b}?`, `/x-*/{b}?`)
  const star =
    mod === "?" && suf === "" && /(?<!\\)\*\/?$/.test(pre)
      ? lazyStarGroup(pre, body, input, unnamed)
      : undefined;
  if (star) {
    return star;
  }
  if (
    mod !== "?" ||
    body === "" ||
    (suf !== "" && suf.charCodeAt(0) !== 47) /* '/' */ ||
    // Only a single group is handled inline; bail if another one is left.
    scanFirstGroup(pre) ||
    scanFirstGroup(body) ||
    scanFirstGroup(suf) ||
    // A group right after a catch-all (`/a/**{.json}?`, `/a/*{/:x}?`,
    // `/a/x-*{.png}?`) adds an optional part after it, which the router ranks
    // against the route without it: expand (see `lazyCatchAll`), unless it is
    // static segments after a `*` (`lazyStarGroup`, above).
    /(?<!\\)\*$/.test(pre) ||
    needsModifierExpansion(pre + suf) ||
    needsModifierExpansion(pre + body + suf)
  ) {
    return;
  }

  // A catch-all before a trailing group is lazy or greedy with the group's
  // segments counted as optional ones (see `lazyCatchAll`). Before more of the
  // route, a catch-all can only be in the shared tail, after the group.
  const extra = suf === "" && body.charCodeAt(0) === 47 /* '/' */ ? splitRoute(body) : [];
  // The base keys its unnamed captures like the full route (`skipGroup`), so
  // the two line up
  const [baseSegs, baseOwnSep, baseOpenTail] = routeToRegExpSegments(
    pre + suf,
    input,
    extra,
    skipGroup(route, input, unnamed),
  );
  const [fullSegs, fullOwnSep, openTail] = routeToRegExpSegments(
    pre + body + suf,
    input,
    extra,
    unnamed,
  );
  const baseLen = baseSegs.length;
  const fullLen = fullSegs.length;
  // A `*` that may end a route: the base's ending must be the full one's, or
  // a plain `/?$` where only the group has it
  const starEnding = (tail: string | boolean) => typeof tail === "string" && tail[0] === "*";
  const base = joinSegments(baseSegs, baseOwnSep);
  if (
    baseOpenTail === STAR_BAIL ||
    openTail === STAR_BAIL ||
    (starEnding(baseOpenTail) && baseOpenTail !== openTail) ||
    (starEnding(openTail) &&
      baseOpenTail !== openTail &&
      (suf !== "" || withTrailingSlash(base) !== `${base}/?$`))
  ) {
    return;
  }
  if (
    baseLen === 0 ||
    fullLen < baseLen ||
    baseOwnSep !== fullOwnSep ||
    (suf !== "" && baseOpenTail !== openTail)
  ) {
    return;
  }
  // With more of the route after the group, its ending is the shared tail's,
  // as in the router's expansions (a lazy catch-all there, see `ending`).
  // A trailing group whose route ends in a `*` keeps its ending.
  const tailEnding = suf === "" ? starEnding(openTail) && openTail : openTail;

  // Segments shared by base and full: a head of `shared` and a tail of `tail`.
  let shared = 0;
  while (shared < baseLen && fullSegs[shared] === baseSegs[shared]) shared++;
  let tail = 0;
  while (tail < baseLen - shared && fullSegs[fullLen - 1 - tail] === baseSegs[baseLen - 1 - tail]) {
    tail++;
  }
  // With more of the route after the group, the head must span the same path
  // segments whichever branch matches, so that factoring it out keeps the
  // alternation's captures. The tail is order-safe.
  const fixedHead = () => baseSegs.slice(0, shared).every((s) => isFixedSegment(s));

  if (fullLen === baseLen && shared + tail >= baseLen - 1) {
    // `body` extends one segment (e.g. `book` -> `books`); make the appended
    // part optional.
    const i = Math.min(shared, baseLen - 1);
    const prefix = baseSegs[i];
    const last = fullSegs[i];
    const k = prefix.length;
    let merged: string | undefined;
    let lookahead = false;
    if (last === prefix) {
      // The group adds nothing to the segment.
      merged = last;
    } else if (last.startsWith(prefix) && isOptionalGroups(last.slice(k))) {
      // Only segments that are optional already (`/a{/:x*}?` is `/a/:x*`).
      merged = last;
    } else {
      const capture = mergeCapture(prefix, last);
      if (capture) {
        [merged, lookahead] = capture;
      } else if (
        last.startsWith(prefix) &&
        // Earlier captures must not take the appended part where the router's
        // longer route matches (`/media/*{.webp}?`, see `appendsCleanly`).
        appendsCleanly(prefix, last.slice(k))
      ) {
        merged = `${prefix}(?:${last.slice(k)})?`;
      }
    }
    if (!merged || ((suf !== "" || lookahead) && !fixedHead())) {
      return;
    }
    const inlineSegs = baseSegs.slice();
    inlineSegs[i] = merged;
    return new RegExp(`^${ending(joinSegments(inlineSegs, fullOwnSep), tailEnding)}`);
  }

  // `body` adds one or more whole segments (e.g. `/foo` -> `/foo/bar`); make
  // the appended segments optional.
  if (shared + tail !== baseLen || (suf !== "" && !fixedHead())) {
    return;
  }
  const head =
    shared > 0 ? joinSegments(fullSegs.slice(0, shared), fullOwnSep) : fullOwnSep ? undefined : "";
  if (head === undefined) {
    return;
  }
  const added = fullSegs.slice(shared, fullLen - tail).join("/");
  const rest = tail > 0 ? `/${baseSegs.slice(baseLen - tail).join("/")}` : "";
  return new RegExp(`^${ending(`${head}(?:/${added})?${rest}`, tailEnding)}`);
}

/**
 * Merge a segment ending in its only capture (`(?<name>[^/]+)` from a whole
 * `:name`, `(?<name>[^/]*)` from a `*`, `(?<name>[^/]+?)` from a `:name` after text, or a
 * constraint `(?<name>C)`) with the same segment extended by the group
 * (`(?<name>[^/]+?)\.(?<ext>[^/]+?)`). The capture must take the extended
 * form's value where that one matches, and the whole value otherwise, as the
 * router. A `:name` in the extended form is lazy, so trying it shortest first
 * with the group before without it finds the same split (`archive.tar.gz`
 * gives `archive` + `tar.gz`). A greedy `*` or a constraint needs a look-ahead to the
 * rest of the segment, unless the capture is a `\d` / `\w` run and the group
 * starts with a char it can't match (`/blog/:id(\d+){-:title}?`). Returns
 * `[merged, lookahead]`.
 */
function mergeCapture(base: string, full: string): [string, boolean] | undefined {
  const match = /^([^(]*\(\?<\w+>)([\s\S]*)\)$/.exec(base);
  if (!match || !full.startsWith(match[1])) {
    return;
  }
  const [, head, body] = match;
  // The final `)` must close the capture: no other group in its body.
  if (/[()]/.test(body.replace(/\\[\s\S]/g, ""))) {
    return;
  }
  let fullBody = body;
  let rest = full.slice(head.length + body.length + 1);
  if (!full.startsWith(`${head}${body})`)) {
    // A whole `:name` is `[^/]+`, `:name` in a mixed segment `[^/]+?`.
    const capture = /^\[\^\/\]\+\?\)([\s\S]+)$/.exec(full.slice(head.length));
    if (!capture || body !== "[^/]+") {
      return;
    }
    fullBody = "[^/]+?";
    rest = capture[1];
  }
  if (!rest) {
    return;
  }
  if (fullBody === "[^/]+?") {
    return [`${head}[^/]+?)(?:${rest})?`, false];
  }
  const first = rest.charCodeAt(0) === 92 /* \ */ ? rest[1] : rest[0];
  if (/^\\[dw][*+]?$/.test(body) && !/[\w([|.?*+{^$]/.test(first)) {
    return [`${base}(?:${rest})?`, false];
  }
  const wrap = (re: string) => (re.includes("|") ? `(?:${re})` : re);
  // The look-ahead repeats `rest` without its capture names. The whole value
  // must reach the end of the segment (`(?![^/])`), which also keeps it from
  // retrying shorter matches.
  const ahead = rest.replace(/\(\?<\w+>/g, "(?:");
  return [`${head}${wrap(fullBody)}(?=${ahead}(?:/|$))|${wrap(body)}(?![^/]))(?:${rest})?`, true];
}

/**
 * Whether a segment regex always spans exactly one path segment: no optional
 * `(?:/…)?` part, and nothing that can match `/` (conservatively, any `.`,
 * class other than `[^/]`, or escape that is not a plain literal or `\d\w\s`).
 */
function isFixedSegment(segment: string): boolean {
  const atoms = segment
    .replace(/\\([\s\S])/g, (_, c) => (/[SDWpPux0-9ck]/.test(c) ? "." : ""))
    .replaceAll("[^/]", "");
  return !/[./[]|\(\?:/.test(atoms);
}

/**
 * Whether `route` has a modifier whose tree expansion the inline emitter can't
 * mirror: an empty segment followed only by optional ones becomes trailing
 * (and is dropped) once they are absent (`/a//:x?` also registers `/a`).
 */
function needsModifierExpansion(route: string): boolean {
  const segments = splitRoute(route);
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === "" && segments.slice(i + 1).every((s) => paramModifier(s))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a `**` followed by the route segments `after` (and the segments of
 * an inline `{…}?` group, `extra`) is lazy. With optional segments after it,
 * the router registers the route with and without them and, where both
 * match, ranks them from the end of the path (a literal beats a regex param,
 * which beats a param or `**`; the longer one wins a tie). A greedy `**`
 * picks the route without them, a lazy one the route with them. `undefined`
 * when no optional segment follows (a single parse either way). With several,
 * this compares the routes with all and with none of them, and the router
 * may pick one in between (`/a/**\/:n(\d+)?/:y?` on `/a/x/1/1` takes the
 * route with `n` only): the regex then captures like another of them.
 */
function lazyCatchAll(after: string[], extra: string[]): boolean | undefined {
  const all = after.concat(extra);
  const kept = all.filter((segment, i) => i < after.length && paramModifier(segment) !== "?");
  if (kept.length === all.length) {
    return;
  }
  for (let a = all.length - 1, b = kept.length - 1; a >= 0; a--, b--) {
    const kind = segmentKind(all[a]);
    const other = b >= 0 ? segmentKind(kept[b]) : 0;
    if (kind !== other) {
      return kind > other;
    }
    // Different literals: the two never match the same path.
    if (kind === 3 && all[a] !== kept[b]) {
      return false;
    }
  }
  return true;
}

/** How the router ranks a route segment: 3 literal, 2 regex param, 0 param. */
function segmentKind(segment: string): number {
  const base = segment.replace(/\\./g, "x").replace(/(:[A-Za-z_]\w*(?:\([^)]*\))?)[?+*]$/, "$1");
  if (base === "*" || /^:[A-Za-z_]\w*$/.test(base)) {
    return 0;
  }
  return /[:(*]/.test(base) ? 2 : 3;
}

/**
 * The `?`/`+`/`*` modifier of a whole-segment param (`:x?`, `:x(\\d+)?`),
 * read like `expandModifiers` with escapes encoded (`\:x?` has none). An
 * in-segment `pre-:x?` is a required segment (only its param is optional).
 */
function paramModifier(segment: string): string | undefined {
  return /^:[A-Za-z_]\w*(?:\([^)]*\))?([?+*])$/.exec(encodeEscapes(segment))?.[1];
}

function _routeToRegExp(route: string, input: string, unnamed?: Unnamed): RegExp {
  const [segments, ownSeparator, openTail] = routeToRegExpSegments(route, input, [], unnamed);
  if (openTail === STAR_BAIL) {
    // Each of the routes the tree registers ends in its own way
    return alternation(
      expandModifiers(splitRoute(encodeEscapes(route)), input)!.map((expandedRoute) =>
        toRegExp(expandedRoute, input, unnamed),
      ),
      input,
    );
  }
  const body = joinSegments(segments, ownSeparator);
  // Root: lookup reaches `/` from `/` only (`//` is an empty segment).
  return new RegExp(segments.length > 0 ? `^${ending(body, openTail)}` : "^/$");
}

/**
 * `body` with the trailing-slash rule (see `withTrailingSlash`). After a lazy
 * catch-all followed by optional segments only (`openTail`), a plain `/?$`
 * is exact, and the optional segments after it that can be empty are made
 * lazy (when `openTail` is the catch-all's group, they follow it) so that
 * the stripped slash does not end one: `/a/**\/:y?/:z?` leaves `z` unset on
 * `/a/b/`, as the router does.
 */
function ending(body: string, openTail: string | boolean): string {
  if (!openTail) {
    return withTrailingSlash(body);
  }
  if (openTail === STAR_TAIL) {
    // The trailing `*`'s capture leaves out the stripped slash (it may end an
    // optional group: `/a{/b/*}?`, lazy, as the router prefers the route
    // without it where both match: `/a/` is `/a` for `/a{/*}?`)
    return `${body.replace(/\[\\s\\S\]\*\)((?:\)\??)*)$/, (_, closers: string) => `${ANY_TAIL})${closers.replaceAll(")?", ")??")}`)}/?$`;
  }
  if (openTail === STAR_OPEN) {
    // Lazy too (where `$` leaves one choice, the inner ones don't matter)
    return `${body.replace(/(?:\)\?\??)+$/, (closers) => closers.replace(/\)\?\??/g, ")??"))}/?$`;
  }
  if (typeof openTail === "string") {
    const at = body.lastIndexOf(openTail) + openTail.length;
    const optionals = openOptionals(body.slice(at));
    if (optionals !== undefined) {
      return `${body.slice(0, at)}${optionals}/?$`;
    }
  }
  return `${body}/?$`;
}

/**
 * Join segment regexes with `/`. With `ownSeparator`, the first one is an
 * optional first route segment that carries its own separator (`(?:/…)?`), so
 * no leading `/` is added — a bare `^\/?` there would let the leading slash
 * double as a trailing one.
 */
function joinSegments(segments: string[], ownSeparator: boolean): string {
  return (ownSeparator ? "" : "/") + segments.join("/");
}

/**
 * Segment regexes for `route`, plus whether the first one is an optional
 * first route segment carrying its own separator (see `joinSegments`), and
 * whether a plain `/?$` ends it exactly (`openTail`). `extra`: the segments
 * of an inline `{…}?` group that follows `route` (see `lazyCatchAll`).
 * `input`: the pattern `route` expands, quoted in errors. `unnamed`: the key
 * of each unnamed capture in `input` (see `skipGroup`).
 */
function routeToRegExpSegments(
  route: string,
  input: string,
  extra: string[] = [],
  unnamed: Unnamed = (index) => index,
): [segments: string[], ownSeparator: boolean, openTail: string | boolean] {
  const reSegments: string[] = [];
  let idCtr = 0;
  const unnamedKey = (index: number) => `_${unnamed(index)}`;
  let ownSeparator = false;
  // The `**` (or `:x+` / `:x*`) segments after which match from the end of
  // the path: a route (expansion) can have one.
  let catchAll = false;
  // The route ends in a lazy `**` and optional segments only, for
  // which a plain `/?$` is exact: any match minus a trailing slash is one
  // (the catch-all takes the rest), and the lazy catch-all leaves that slash
  // to the `/?`. The catch-all's group where the optionals follow it at the
  // end of the body (not nested in an earlier optional), see `ending`.
  let openTail: string | boolean = false;
  const oneCatchAll = () => {
    if (catchAll) {
      throw new Error(
        `rou3: a route can have only one \`*\`, \`**\`, \`:name+\` or \`:name*\` (${input})`,
      );
    }
    catchAll = true;
  };

  // A param name declared twice in an expansion would be a duplicate named
  // group, which engines disagree on: V8 (Node 24) accepts one when a copy
  // sits inside an alternative (the `**:name` / `:name+` ending), while other
  // runtimes, PCRE2 and RE2 reject it. `addRoute` rejects such routes, so none
  // reach here. The alternation fallback may still repeat a name across
  // branches.
  const groupName = toGroupName;

  // Optional segments (`:x?`, `:x*`, `**`) are appended to the previous
  // segment as `(?:/…)?`. After a whole-segment `:x?`, the next ones nest
  // inside its group: of the router's expansions of `/a/:x?/:y?`, `/a/:y`
  // matches no path `/a/:x` doesn't, so both forms match the same paths, and
  // only the nested one leaves a single optional group at the end (see
  // `withTrailingSlash`). Both give a lone segment to `x`, as the router does
  // unless `/a/:y` wins it (a constrained `:y`). A `:x` needs a value, so one
  // that can be empty (`**`) or start with an empty segment (`:y*`) doesn't
  // nest in it (`/a/:x?/**` on `/a//` is `/a/**`), and follows it instead
  // (`free`). `nest` counts the
  // `)?` closers to insert before, `nestValue` whether the innermost group
  // needs a value.
  let nest = 0;
  let nestValue = false;
  const pushOptional = (
    inner: string,
    nestable: boolean,
    lazy = false,
    free = canBeEmpty(inner),
  ) => {
    const group = `(?:/${inner})?${lazy ? "?" : ""}`;
    if (nestValue && free) nest = 0;
    if (reSegments.length === 0) {
      ownSeparator = true;
      reSegments.push(group);
    } else {
      const prev = reSegments.pop()!;
      const at = prev.length - 2 * nest;
      reSegments.push(`${prev.slice(0, at)}${group}${prev.slice(at)}`);
    }
    if (nestable) {
      nest++;
      nestValue = !free;
    }
  };

  const segments = splitRoute(route);

  // A `**` / `**:name` / `:name+` / `:name*` with segments after it: those
  // match the end of the path and the catch-all what is between, zero or more
  // segments (one or more with a value for `**:name` / `:name+` / `:name*`),
  // empty ones included. The separator stays with the prefix (`/a/**/b` must
  // not match `/ab`); over zero segments the group is unset, as in the
  // router. With optional segments after it, the router registers several
  // routes; `lazyCatchAll` picks between them. `name`: the catch-all's group
  // name.
  const pushCatchAll = (
    name: string,
    required: boolean,
    i: number,
    repeat = false,
    star = false,
  ): void => {
    // A bare `**` and a `*` may be empty, a `**:name` (`:name+`, `:name*`)
    // needs a value
    const empty = star || (!required && !repeat);
    const tail = segments.slice(i + 1);
    // A `*` in the group `extra` are the segments of is followed by its rest
    // only (`/a{/*/:y?}?`)
    const after = star && segments.length - i <= extra.length ? [] : extra;
    const lazy = lazyCatchAll(tail, after);
    // A plain `/?$` is not exact where the segment before the catch-all can be
    // empty: the stripped slash would end it (`/a/` matching `/a/*/**/:y?`).
    // A `*` needs a segment, but takes none where it ends the route after a
    // trailing slash (`/a/*/:y?` on `/a/`), so it can have one.
    const open =
      lazy &&
      empty &&
      after.length === 0 &&
      tail.every((s) => paramModifier(s) === "?") &&
      !(reSegments.length > 0 && canBeEmpty(reSegments[reSegments.length - 1]));
    const group = `(?<${name}>${empty ? ANY : SOME}${lazy ? "?" : ""})`;
    if (open) {
      openTail = star ? STAR_OPEN : nest === 0 ? `(?:/${group})??` : true;
    } else if (star && tail.every((s) => paramModifier(s) === "?")) {
      openTail = STAR_BAIL;
    }
    if (required) {
      reSegments.push(reSegments.length > 0 ? `${reSegments.pop()}/${group}` : group);
      nest = 0;
    } else {
      // Without optional segments after it, `:name*` is lazy: the router's
      // route without it leaves `name` unset. With them, it picks like `**`.
      pushOptional(group, false, lazy ?? repeat, true);
    }
  };

  // A dynamic segment (or the base of a `?`-modified one) exactly as the tree
  // compiles it (`getParamRegexp`): a whole `:name` is an unchecked param
  // node, which needs a value (`/a//b` doesn't reach `/a/:x/b`).
  const dynamic = (segment: string): string => {
    if (/^:[A-Za-z_]\w*$/.test(segment)) {
      return `(?<${groupName(segment.slice(1))}>[^/]+)`;
    }
    const [regexp, next] = getParamRegexp(encodeEscapes(segment), idCtr, [], input, unnamedKey);
    idCtr = next;
    return greedy(regexp.source.slice(1, -1));
  };
  // A `*` inside a segment (a segment-local `[^/]*` group in the tree's
  // regex, which no constraint can write) is a catch-all: it takes `/` too,
  // the rest of the route matching the end of the path (see `splitStar`)
  const greedy = (source: string): string => {
    const out = source.replace(/(\(\?<_\d+>)\[\^\/\]\*\)/, `$1${ANY})`);
    if (out !== source) oneCatchAll();
    return out;
  };

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    // An empty *middle* segment (`/a//b`) is a real static segment in the tree,
    // so it must stay in the regex; `splitRoute` has already dropped the leading
    // and trailing empties (`/a//` = `/a/` = `/a`).
    if (!segment) {
      reSegments.push("");
      nest = 0;
      continue;
    }

    if (segment === "*") {
      // A catch-all, URLPattern's `(.*)` after its `/`: one segment or more,
      // empty ones included, with segments after it at the end of the path
      // (see `pushCatchAll`). Last, it also takes none after the stripped
      // trailing slash (`/a/` gives `""`, `/a` is no match), so the path is
      // the body plus `/?` (`STAR_TAIL`, see `ending`).
      oneCatchAll();
      const name = unnamedKey(idCtr++);
      if (i < segments.length - 1) {
        pushCatchAll(name, true, i, false, true);
        continue;
      }
      reSegments.push(`(?<${name}>${ANY})`);
      openTail = STAR_TAIL;
      break;
    } else if (segment.startsWith("**")) {
      // The separator before a catch-all must stay anchored to the prefix: a
      // bare optional `/?` would let `/api/**` match `/apifoo`. `**` matches
      // zero or more segments (`/api` too), `**:name` one or more, with a
      // value: the separator plus `SOME` (`/api///` reaches `/api/**:p` with
      // `p: "/"`, `/api//` doesn't). A bare `**` is an unnamed capture (`_N`,
      // `"N"` in the router), unset over zero segments.
      oneCatchAll();
      const bare = segment === "**";
      const name = bare ? unnamedKey(idCtr++) : groupName(segment.slice(3));
      if (i < segments.length - 1) {
        // Segments follow: they take the end of the path, the `**` what is
        // between (see `pushCatchAll`).
        pushCatchAll(name, !bare, i);
        continue;
      }
      if (bare) {
        // At the root too: the group carries its own separator, so `/` (zero
        // segments) leaves it unset
        pushOptional(`(?<${name}>${ANY})`, false);
      } else {
        reSegments.push(`(?<${name}>${SOME})`);
      }
      break;
    } else if (segmentKey(encodeEscapes(segment)) === 1) {
      // Read like `expandModifiers`, with escapes encoded (`\:x?` has none)
      const modMatch = encodeEscapes(segment).match(PARAM_MODIFIER);
      // `pre-:x?` (only the param is optional) is the tree's own in-place
      // `pre-(?:(?<x>…))?` (`getParamRegexp`), below; after plain text the
      // router's two routes match the same paths and split them the same way
      if (modMatch && !(modMatch[1] && modMatch[3] === "?")) {
        const [, , base, mod] = modMatch;

        if (mod === "?") {
          // Append optional group to previous segment: /foo(?:/<inner>)?
          pushOptional(dynamic(base), /^:[A-Za-z_]\w*$/.test(base));
          continue;
        }

        // + or *: `addRoute` accepts them on a whole-segment `:name` only.
        const name = groupName(base.slice(1));
        oneCatchAll();
        if (i < segments.length - 1) {
          // The tree has `**:name` here (`:name*` also registers the route
          // without it), with segments after it.
          pushCatchAll(name, mod === "+", i, mod === "*");
          continue;
        }
        // `:name*` is `{/:name+}?`
        const group = `(?<${name}>${SOME})`;
        if (mod === "*") {
          pushOptional(group, false, false, true);
        } else {
          reSegments.push(reSegments.length > 0 ? `${reSegments.pop()}/${group}` : group);
          nest = 0;
        }

        continue;
      }

      let regex = dynamic(segment);
      // A `*` ending the route (`/file-*`) takes the rest of the path, minus
      // the stripped trailing slash (see `ending`)
      if (i === segments.length - 1 && regex.endsWith(`${ANY})`)) {
        openTail = STAR_TAIL;
      }
      // One with optional segments after it is lazy or greedy like a `**`
      // (see `lazyCatchAll`): the tree's `**` is after its segment, and the
      // segment ranks as a regex param where text follows the `*` (`*.png`)
      else if (
        regex.includes(`${ANY})`) &&
        lazyCatchAll(regex.endsWith(`${ANY})`) ? segments.slice(i + 1) : segments.slice(i), extra)
      ) {
        regex = regex.replace(`${ANY})`, `${ANY}?)`);
      }
      reSegments.push(regex);
      nest = 0;
    } else {
      // A static key: any `\x` is a literal `x` (see `segmentKey`)
      const key = segmentKey(encodeEscapes(segment)) as string;
      reSegments.push(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      nest = 0;
    }
  }

  return [reSegments, ownSeparator, openTail];
}
