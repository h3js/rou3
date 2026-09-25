import { expandGroupDelimiters, scanFirstGroup } from "./_group-delimiters.ts";
import { toGroupName } from "./_group-names.ts";
import {
  escapeBareDots,
  replaceEscapesOutsideGroups,
  resolveEscapePlaceholders,
} from "./_escape.ts";
import { hasSegmentWildcard, replaceSegmentWildcards } from "./_segment-wildcards.ts";
import { expandModifiers, splitRoute } from "./operations/_utils.ts";
import { canBeEmpty, isOptionalGroups } from "./_regexp-scan.ts";
import { openOptionals, withTrailingSlash } from "./_trailing-slash.ts";

// Catch-all body. The router splits paths on `/` only, so a catch-all takes
// any char, line terminators included; `.` would not (JS excludes `\n`, `\r`,
// U+2028 and U+2029, PCRE and RE2 by default only `\n`). `[\s\S]` is any char
// in all of them.
const ANY = "[\\s\\S]*";
const LAZY_ANY = "[\\s\\S]*?";

/**
 * Convert a rou3 route pattern into an anchored {@link RegExp}.
 *
 * The generated source targets a **PCRE-compatible** flavor: named groups use
 * the `(?<name>...)` form and no JS-only constructs are emitted, so the output
 * also compiles in PCRE2 engines (`grep -P`, `rg -P`, `pcre2grep`, PHP `preg_*`)
 * and Perl. Trailing optional groups (`{...}?`, `:name?`) are compiled inline as
 * `(?:...)?` rather than an alternation, so a param is never emitted as a
 * duplicate named group — which PCRE2 rejects unless `PCRE2_DUPNAMES` is set.
 *
 * The regex matches exactly the paths `findRoute()` matches for a router holding
 * only `route` — including the router's tolerances: one optional trailing slash,
 * empty segments for `:name` / `*` params, and an optional trailing `*` — so it
 * can stand in for the router as a guard or scope check. Not modeled: param
 * constraints that can match `/` (the tree splits on `/` first), repeated
 * constrained params (`:id(\d+)+`), the empty path, and `normalize: true`.
 *
 * Most routes also compile to RE2-compatible output (RE2, Go, Rust `regex`):
 * the trailing-slash rule is encoded without look-behinds, except for the few
 * endings `withTrailingSlash` lists (e.g. a constraint that can end in `/`, or a
 * required segment whose constraint can match empty).
 *
 * Note: multi-group or mid-route optionals that cannot be inlined still fall
 * back to alternation and may contain duplicate named groups (valid in JS/Perl,
 * but requiring `PCRE2_DUPNAMES` for strict PCRE2 engines).
 *
 * @throws a `rou3:` error when one expansion of `route` declares the same param
 * name twice (`/files/:path/**:path`, `/a/:x{/b/:x}?`); the resulting duplicate
 * named group would compile on some engines and not on others.
 *
 * Segments after a `**` (`/**\/_payload.json`, `/**.md`, and a `:name+` /
 * `:name*` before the last segment) follow it in the regex, so they match at
 * the end of the path as in the router. Where the route has one optional
 * segment after the `**`, the `**` is lazy or greedy to pick the route the
 * router picks (see `lazyCatchAll`); with several, it matches the same paths
 * but may capture like another of the routes the pattern registers.
 *
 * @throws a `rou3:` error, the one `addRoute` throws, when an expansion of
 * `route` has more than one `**` (`/**\/**`, `/a/:x+/b/:y+`).
 *
 * @example
 * routeToRegExp("/users/:id(\\d+)"); // /^\/users\/(?<id>\d+)\/?$/
 * routeToRegExp("/blog/:id(\\d+){-:title}?"); // /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+))?\/?$/
 */
export function routeToRegExp(route: string = "/"): RegExp {
  if (route.charCodeAt(0) !== 47 /* '/' */) {
    route = `/${route}`;
  }

  // Compile a trailing single optional group (`{...}?`) inline as `(?:...)?`
  // instead of expanding it into an alternation of full routes. The alternation
  // form re-emits every param before the group in both branches, producing
  // duplicate named groups that PCRE2-family engines reject.
  const inlineOptional = inlineOptionalGroup(route);
  if (inlineOptional) {
    return inlineOptional;
  }

  // Modifiers the inline emitter cannot mirror expand exactly like `addRoute`
  // (groups first, then modifiers).
  const groupExpanded =
    expandGroupDelimiters(route) ||
    (needsModifierExpansion(route) ? expandModifiers(splitRoute(route)) : undefined);
  if (groupExpanded) {
    // Expansions can compile to the same regex (`/a/:x+/b{c}?` is `/a/**:x`
    // either way); keep one copy of each.
    const sources = [
      ...new Set(
        groupExpanded.map((expandedRoute) => routeToRegExp(expandedRoute).source.slice(1, -1)),
      ),
    ];
    if (sources.length === 1) {
      return new RegExp(`^${sources[0]}$`);
    }
    // Note: alternation branches may still contain duplicate named capture
    // groups (e.g. `(?<id>a)|(?<id>b)`) for multi-group / mid-route optionals
    // that can't be inlined. This is valid in modern JS engines (Node 22+,
    // Chrome 125+, Firefox 129+, Safari 17+) per TC39 proposal, but is not
    // portable to PCRE2 without PCRE2_DUPNAMES.
    return new RegExp(`^(?:${sources.join("|")})$`);
  }

  return _routeToRegExp(route);
}

/**
 * Build an inline-optional regex for the common `…{…}?` case where a single
 * optional group sits at the end of the route. Returns `undefined` (falling
 * back to alternation expansion) for anything it can't inline safely:
 * multi-group routes, mid-route optionals, or unexpected segment shapes.
 */
function inlineOptionalGroup(route: string): RegExp | undefined {
  const group = scanFirstGroup(route);
  if (!group) {
    return;
  }
  const [pre, body, suf, mod] = group;
  if (
    mod !== "?" ||
    suf !== "" ||
    body === "" ||
    // Only a single group is handled inline; bail if `pre`/`body` nest another.
    scanFirstGroup(pre) ||
    scanFirstGroup(body) ||
    // A group right after a bare `**` (`/a/**{.json}?`, `/a/**{/b}?`) adds an
    // optional segment after it, which the router ranks against the route
    // without it: expand (see `lazyCatchAll`).
    /(?:^|\/)\*\*$/.test(pre) ||
    needsModifierExpansion(pre, body.charCodeAt(0) === 47 /* '/' */) ||
    needsModifierExpansion(pre + body)
  ) {
    return;
  }

  // A catch-all before the group is lazy or greedy with the group's segments
  // counted as optional ones (see `lazyCatchAll`).
  const extra = body.charCodeAt(0) === 47 /* '/' */ ? splitRoute(body) : [];
  const [baseSegs, baseOwnSep] = routeToRegExpSegments(pre, extra);
  const [fullSegs, fullOwnSep, starStar] = routeToRegExpSegments(pre + body, extra);
  const baseLen = baseSegs.length;
  if (baseLen === 0 || fullSegs.length < baseLen || baseOwnSep !== fullOwnSep) {
    return;
  }

  // Leading segments shared by base and full must be identical. In the
  // mid-segment case only the final base segment grows, so it is excluded here.
  const midSegment = fullSegs.length === baseLen;
  const sharedLen = midSegment ? baseLen - 1 : baseLen;
  for (let i = 0; i < sharedLen; i++) {
    if (fullSegs[i] !== baseSegs[i]) {
      return;
    }
  }

  if (midSegment) {
    // `body` extends the final segment (e.g. `book` -> `books`); make the
    // appended tail optional.
    const prefix = baseSegs[baseLen - 1];
    const last = fullSegs[baseLen - 1];
    if (!last.startsWith(prefix)) {
      return;
    }
    // If the base segment ends in a greedy, open-ended capture (`[^/]*` from a
    // `*` wildcard / unconstrained param, or `.*`/`.+`/`[\s\S]*`), appending
    // `(?:tail)?` lets that capture swallow the optional literal instead of
    // leaving it out — changing the captured value (`/media/*{.webp}?` would
    // capture the whole `photo.webp` instead of `photo`). Fall back to
    // alternation, which anchors the literal outside the capture in one branch.
    if (/(?:\[\^\/\]|\[\\s\\S\]|\.)[*+]\)?$/.test(prefix)) {
      return;
    }
    const k = prefix.length;
    const inlineSegs = fullSegs.slice(0, baseLen - 1);
    // The group may add nothing to the segment, or only segments that are
    // optional already (`/a{/:x*}?` is `/a/:x*`).
    const optional = k < last.length && isOptionalGroups(last.slice(k));
    inlineSegs.push(
      k === last.length || optional ? last : `${last.slice(0, k)}(?:${last.slice(k)})?`,
    );
    // `/a{/**}?` also registers `/a`, which wins where `**` would match no
    // segment: its group is skipped there like `:_*`'s.
    return new RegExp(
      `^${withTrailingSlash(joinSegments(inlineSegs, fullOwnSep), starStar && !optional)}`,
    );
  }

  // `body` adds one or more whole segments (e.g. `/foo` -> `/foo/bar`); make
  // the appended segments optional.
  const head = joinSegments(fullSegs.slice(0, baseLen), fullOwnSep);
  const tail = fullSegs.slice(baseLen).join("/");
  return new RegExp(`^${withTrailingSlash(`${head}(?:/${tail})?`, starStar)}`);
}

/**
 * Whether `route` has a modifier whose tree expansion the inline emitter can't
 * mirror: an empty segment followed only by optional ones becomes trailing
 * (and is dropped) once they are absent (`/a//:x?` also registers `/a`), and
 * a `:x*` followed by a `*` that is optional in the route without the `:x*`
 * (`/a/:x*\/b/*` also registers `/a/b/*`, which matches `/a/b`) but takes a
 * segment after the `**:x`. A lone `*` right after the `:x*` compiles to one
 * nested group, unless an inline `{/…}?` group follows (`group`).
 */
function needsModifierExpansion(route: string, group = false): boolean {
  const segments = splitRoute(route);
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i] === "" && segments.slice(i + 1).every((s) => paramModifier(s))) {
      return true;
    }
    if (
      paramModifier(segments[i]) === "*" &&
      (group || i < segments.length - 2) &&
      segments.some((s, j) => j > i && s === "*" && optionalAfter(segments, j))
    ) {
      return true;
    }
  }
  return false;
}

/** Whether only optional (`?` / `*`) segments follow `segments[i]`. */
function optionalAfter(segments: string[], i: number): boolean {
  return segments.slice(i + 1).every((s) => paramModifier(s) === "?" || paramModifier(s) === "*");
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
  const base = segment.replace(/\\./g, "x").replace(/(:[\w-]+(?:\([^)]*\))?)[?+*]$/, "$1");
  if (base === "*" || /^:[\w-]+$/.test(base)) {
    return 0;
  }
  return /[:(*]/.test(base) ? 2 : 3;
}

/** The `?`/`+`/`*` modifier of a param segment (`:x?`, `pre-:x(\\d+)+`). */
function paramModifier(segment: string): string | undefined {
  return /:[\w-]+(?:\([^)]*\))?([?+*])$/.exec(segment)?.[1];
}

function _routeToRegExp(route: string): RegExp {
  const [segments, ownSeparator, starStar, openTail] = routeToRegExpSegments(route);
  const body = joinSegments(segments, ownSeparator);
  // Root: lookup reaches `/` from `/` only (`//` is an empty segment).
  return new RegExp(segments.length > 0 ? `^${ending(body, starStar, openTail)}` : "^/$");
}

/**
 * `body` with the trailing-slash rule (see `withTrailingSlash`). After a lazy
 * catch-all followed by optional segments only (`openTail`), a plain `/?$`
 * is exact, and the optional segments after it that can be empty are made
 * lazy (when `openTail` is the catch-all's group, they follow it) so that
 * the stripped slash does not end one: `/a/**\/:y?/:z?` leaves `z` unset on
 * `/a/b/`, as the router does.
 */
function ending(body: string, starStar: boolean, openTail: string | boolean): string {
  if (!openTail) {
    return withTrailingSlash(body, starStar);
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
 * first route segment carrying its own separator (see `joinSegments`),
 * whether the route ends in a bare `**` (its `_` group reads the same as a
 * param named `_`, see `withTrailingSlash`), and whether a plain `/?$` ends
 * it exactly (`openTail`). `extra`: the segments of an inline `{…}?` group
 * that follows `route` (see `lazyCatchAll`).
 */
function routeToRegExpSegments(
  route: string,
  extra: string[] = [],
): [segments: string[], ownSeparator: boolean, starStar: boolean, openTail: string | boolean] {
  const reSegments: string[] = [];
  let idCtr = 0;
  let ownSeparator = false;
  let starStar = false;
  // The `**` (or `:x+` / `:x*`) segments after which match from the end of
  // the path: a route (expansion) can have one.
  let catchAll = false;
  // The route ends in a lazy `**` / `:x*` and optional segments only, for
  // which a plain `/?$` is exact: any match minus a trailing slash is one
  // (the catch-all takes the rest), and the lazy catch-all leaves that slash
  // to the `/?`. The catch-all's group where the optionals follow it at the
  // end of the body (not nested in an earlier optional), see `ending`.
  let openTail: string | boolean = false;
  const oneCatchAll = () => {
    if (catchAll) {
      throw new Error(`rou3: a route can have only one \`**\` (${route})`);
    }
    catchAll = true;
  };

  // Every param name emitted for this expansion. A name declared twice would
  // be a duplicate named group, which engines disagree on: V8 (Node 24)
  // accepts one when a copy sits inside an alternative (the `**:name` /
  // `:name+` ending), while other runtimes, PCRE2 and RE2 reject it. Throw the
  // same error everywhere instead. Generated unnamed captures (`_N`) are not
  // params and never pass through here; the alternation fallback checks each
  // expansion on its own, so it may still repeat a name across branches.
  // Named groups inside a constraint body (`:x((?<y>a))`) are not tracked.
  const names = new Set<string>();
  const groupName = (name: string): string => {
    if (names.has(name)) {
      throw new Error(`rou3: duplicate param name "${name}" in "${route}"`);
    }
    names.add(name);
    return toGroupName(name);
  };

  // Optional segments (`:x?`, a trailing `*`, `:x*`, `**`) are appended to the
  // previous segment as `(?:/…)?`. After a whole-segment `:x?` / `*`, the
  // next ones nest inside its group: of the router's expansions of
  // `/a/:x?/:y?`, `/a/:y` matches no path `/a/:x` doesn't, so both forms
  // match the same paths, and only the nested one leaves a single optional
  // group at the end (see `withTrailingSlash`). Both give a lone segment to
  // `x`, as the router does unless `/a/:y` wins it (a `*` or a constrained
  // `:y`). `nest` counts the `)?` closers to insert before.
  let nest = 0;
  const pushOptional = (inner: string, nestable: boolean, lazy = false) => {
    const group = `(?:/${inner})?${lazy ? "?" : ""}`;
    if (reSegments.length === 0) {
      ownSeparator = true;
      reSegments.push(group);
    } else {
      const prev = reSegments.pop()!;
      const at = prev.length - 2 * nest;
      reSegments.push(`${prev.slice(0, at)}${group}${prev.slice(at)}`);
    }
    if (nestable) nest++;
  };

  const segments = splitRoute(route);

  // A `**` / `**:name` / `:name+` / `:name*` with segments after it: those
  // match the end of the path and the catch-all what is between, zero or more
  // segments (one or more for `**:name` / `:name+`), empty ones included. The
  // separator stays with the prefix (`/a/**/b` must not match `/ab`), except
  // at the root, where the leading slash doubles as it so that `_` is `""`
  // on `/b` as in the router. With optional segments after it, the router
  // registers several routes; `lazyCatchAll` picks between them.
  const pushCatchAll = (
    id: string,
    required: boolean,
    i: number,
    pattern?: string,
    repeat = false,
  ): boolean => {
    // `**` / `:x*` then a lone `:y?` (or a `*`, which is optional in the
    // route `:x*` registers without it): the router takes the route with the
    // last segment wherever it matches, and the one without only where
    // nothing follows the prefix. Both fit in one optional group, the
    // catch-all nested in it before the last segment.
    const tail = segments.slice(i + 1);
    if (
      !required &&
      !pattern &&
      extra.length === 0 &&
      tail.length === 1 &&
      (/^:[\w-]+\?$/.test(tail[0]) || (repeat && tail[0] === "*"))
    ) {
      const catchAllGroup = `(?<${groupName(id)}>${ANY})`;
      const last =
        tail[0] === "*"
          ? `(?<${toRegExpUnnamedKey(idCtr++)}>[^/]*)`
          : `(?<${groupName(tail[0].slice(1, -1))}>[^/]*)`;
      pushOptional(`(?:${catchAllGroup}/)?${last}`, false);
      return true;
    }
    const lazy = lazyCatchAll(tail, extra);
    // A plain `/?$` is not exact where the segment before the catch-all can be
    // empty: the stripped slash would end it (`/a/` matching `/a/:p/**/:y?`).
    const open =
      lazy &&
      !required &&
      extra.length === 0 &&
      tail.every((s) => paramModifier(s) === "?") &&
      !(reSegments.length > 0 && canBeEmpty(reSegments[reSegments.length - 1]));
    const name = groupName(id);
    const body = pattern ? `${pattern}(?:/${pattern})*${lazy ? "?" : ""}` : lazy ? LAZY_ANY : ANY;
    const group = `(?<${name}>${body})`;
    if (open) {
      openTail = nest === 0 ? `(?:/${group})??` : true;
    }
    if (required) {
      reSegments.push(reSegments.length > 0 ? `${reSegments.pop()}/${group}` : group);
      nest = 0;
    } else if (repeat || lazy || reSegments.length > 0) {
      // Without optional segments after it, `:name*` is lazy: the router's
      // route without it leaves `name` unset. With them, it picks like `**`.
      pushOptional(group, false, lazy ?? repeat);
    } else {
      reSegments.push(`?${group}`);
    }
    return false;
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
      const star = `(?<${toRegExpUnnamedKey(idCtr++)}>[^/]*)`;
      // A trailing `*` is optional in the tree (`/a` reaches `/a/*`), also
      // when only optional segments follow it (`/a/*/:x?` expands to `/a/*`),
      // but not after a `**`, where it takes one segment.
      if (catchAll || !optionalAfter(segments, i)) {
        reSegments.push(star);
        nest = 0;
      } else {
        pushOptional(star, true);
      }
    } else if (segment.startsWith("**")) {
      // The separator before a catch-all must stay anchored to the prefix: a
      // bare optional `/?` would let `/api/**` match `/apifoo`. `**` matches
      // zero or more segments (`/api` too), `**:name` one or more. A segment may
      // be empty, so one-or-more is the separator plus `ANY` (`/api//` reaches
      // `/api/**:p` with `p: ""`; `/api/` is `/api` after trailing stripping).
      // A bare `**` is the `_` param (`params._` in the router).
      oneCatchAll();
      if (i < segments.length - 1) {
        // Segments follow: they take the end of the path, the `**` what is
        // between (see `pushCatchAll`).
        if (pushCatchAll(segment === "**" ? "_" : segment.slice(3), segment !== "**", i)) {
          break;
        }
        continue;
      }
      const name = groupName(segment === "**" ? "_" : segment.slice(3));
      starStar = segment === "**";
      if (!starStar) {
        reSegments.push(`(?<${name}>${ANY})`);
      } else if (reSegments.length > 0) {
        pushOptional(`(?<_>${ANY})`, false);
      } else {
        reSegments.push(`?(?<_>${ANY})`);
      }
      break;
    } else if (
      segment.includes(":") ||
      /(^|[^\\])\(/.test(segment) ||
      hasSegmentWildcard(segment)
    ) {
      const modMatch = segment.match(/^(.*:[\w-]+(?:\([^)]*\))?)([?+*])$/);
      if (modMatch) {
        const [, base, mod] = modMatch;

        if (mod === "?") {
          const whole = /^:[\w-]+$/.test(base);
          const inner = escapeBareDots(
            base.replace(
              /:([\w-]+)(?:\(([^)]*)\))?/g,
              (_, id, pattern) => `(?<${groupName(id)}>${pattern || (whole ? "[^/]*" : "[^/]+")})`,
            ),
          );
          // Append optional group to previous segment: /foo(?:/<inner>)?
          pushOptional(inner, whole);
          continue;
        }

        // + or * (preserve inline constraint when present). `modMatch` ensures
        // `base` holds a `:name`; only the first one is emitted.
        const [, id, pattern] = base.match(/:([\w-]+)(?:\(([^)]*)\))?/)!;
        oneCatchAll();
        if (i < segments.length - 1) {
          // The tree has `**:name` here (`:name*` also registers the route
          // without it), with segments after it.
          if (pushCatchAll(id, mod === "+", i, pattern, mod === "*")) {
            break;
          }
          continue;
        }
        const name = groupName(id);
        if (reSegments.length > 0) {
          const repeated = pattern ? `${pattern}(?:/${pattern})*` : ANY;
          if (mod === "*") {
            pushOptional(`(?<${name}>${repeated})`, false);
          } else {
            reSegments.push(`${reSegments.pop()}/(?<${name}>${repeated})`);
            nest = 0;
          }
        } else {
          if (pattern) {
            const repeated = `${pattern}(?:/${pattern})*`;
            reSegments.push(mod === "+" ? `?(?<${name}>${repeated})` : `?(?<${name}>${repeated})?`);
          } else {
            // `+` needs at least one segment, so its separator is required.
            reSegments.push(mod === "+" ? `(?<${name}>${ANY})` : `?(?<${name}>${ANY})`);
          }
          nest = 0;
        }

        continue;
      }

      // Strip URLPattern backslash escapes before regex processing
      let dynamicSegment = replaceEscapesOutsideGroups(segment);
      [dynamicSegment, idCtr] = replaceSegmentWildcards(dynamicSegment, idCtr, toRegExpUnnamedKey);

      // A whole-segment `:name` is an unchecked param node in the tree, which
      // also takes an empty segment (`/a//b` reaches `/a/:x/b`); inside a mixed
      // segment (`get-:file`) the tree compiles it to `[^/]+`.
      const whole = /^:[\w-]+$/.test(segment);
      reSegments.push(
        resolveEscapePlaceholders(
          escapeBareDots(
            dynamicSegment
              .replace(
                /:([\w-]+)(?:\(([^)]*)\))?/g,
                (_, id, pattern) =>
                  `(?<${groupName(id)}>${pattern || (whole ? "[^/]*" : "[^/]+")})`,
              )
              .replace(/(^|[^\\])\((?![?<])/g, (_, p) => `${p}(?<${toRegExpUnnamedKey(idCtr++)}>`),
          ),
        ),
      );
      nest = 0;
    } else {
      reSegments.push(segment.replace(/\\(.)/g, "$1").replace(/[.*+?^${}()|[\]]/g, "\\$&"));
      nest = 0;
    }
  }

  return [reSegments, ownSeparator, starStar, openTail];
}

function toRegExpUnnamedKey(index: number): string {
  return `_${index}`;
}
