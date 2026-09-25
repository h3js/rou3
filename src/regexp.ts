import { expandGroupDelimiters, scanFirstGroup } from "./_group-delimiters.ts";
import { toGroupName } from "./_group-names.ts";
import {
  escapeBareDots,
  replaceEscapesOutsideGroups,
  resolveEscapePlaceholders,
} from "./_escape.ts";
import { hasSegmentWildcard, replaceSegmentWildcards } from "./_segment-wildcards.ts";
import { expandModifiers, splitRoute } from "./operations/_utils.ts";

// Lookup ignores at most one trailing slash (#209), so `/a/b` and `/a/b/` reach
// `/a/b` but `/a/b//` does not. A second slash leaves a real empty last
// segment: the body then ends in `/` and exactly one more must follow (`/a//`
// reaches `/a/:x` with `x: ""`, `/a/` does not). The look-behinds encode that.
const TRAILING_SLASH = "(?:(?<=/)/|(?<!/)/?)$";

/**
 * Convert a rou3 route pattern into an anchored {@link RegExp}.
 *
 * The generated source targets a **PCRE-compatible** flavor: named groups use
 * the `(?<name>...)` form and no JS-only constructs are emitted, so the output
 * also compiles in PCRE2 engines (`grep -P`, `rg -P`, `pcre2grep`, PHP `preg_*`)
 * and Perl. A single optional group (`{...}?`, `:name?`) is compiled inline as
 * `(?:...)?` rather than an alternation, so a param is never emitted as a
 * duplicate named group — which PCRE2 rejects unless `PCRE2_DUPNAMES` is set,
 * and V8 before 12.5 (Node 22) rejects outright.
 *
 * The regex matches exactly the paths `findRoute()` matches for a router holding
 * only `route` — including the router's tolerances: one optional trailing slash,
 * empty segments for `:name` / `*` params, and an optional trailing `*` — so it
 * can stand in for the router as a guard or scope check.
 *
 * Note: multi-group routes and optionals that cannot be inlined still fall
 * back to alternation and may contain duplicate named groups (valid in modern
 * JS engines and Perl, but requiring `PCRE2_DUPNAMES` for strict PCRE2 engines).
 *
 * @example
 * routeToRegExp("/users/:id(\\d+)"); // /^\/users\/(?<id>\d+)(?:(?<=\/)\/|(?<!\/)\/?)$/
 * routeToRegExp("/blog/:id(\\d+){-:title}?"); // /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+))?(?:(?<=\/)\/|(?<!\/)\/?)$/
 */
export function routeToRegExp(route: string = "/"): RegExp {
  if (route.charCodeAt(0) !== 47 /* '/' */) {
    route = `/${route}`;
  }

  // Compile a single optional group (`{...}?`) inline as `(?:...)?` instead of
  // expanding it into an alternation of full routes. The alternation form
  // re-emits every param outside the group in both branches, producing
  // duplicate named groups that PCRE2-family engines and Node 22 reject.
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
 * Build an inline-optional regex for a route with a single `{…}?` group, by
 * compiling it with and without the group and making the difference optional.
 * Returns `undefined` (falling back to alternation expansion) for anything it
 * can't inline safely: multi-group routes, optional segments before a
 * mid-route group, or compilations that differ in more than one place.
 */
function inlineOptionalGroup(route: string): RegExp | undefined {
  const group = scanFirstGroup(route);
  if (!group) {
    return;
  }
  const [pre, body, suf, mod] = group;
  if (
    mod !== "?" ||
    body === "" ||
    // Only a single group is handled inline; bail if any part nests another.
    scanFirstGroup(pre) ||
    scanFirstGroup(body) ||
    scanFirstGroup(suf) ||
    needsModifierExpansion(pre + suf) ||
    needsModifierExpansion(pre + body + suf) ||
    // `pre (?:body)? suf` backtracks like `pre body suf | pre suf` as long as
    // `pre` itself can match only one way, so with segments after the group
    // bail on optional or catch-all segments before it.
    (suf !== "" && splitRoute(pre).some((s) => paramModifier(s) || s.startsWith("**")))
  ) {
    return;
  }

  // `base` is the route without the group, `full` the route with it. Both come
  // from the same segment compiler, so they differ exactly where `body` sits.
  const [baseSegs, baseOwnSep] = routeToRegExpSegments(pre + suf);
  const [fullSegs, fullOwnSep] = routeToRegExpSegments(pre + body + suf);
  const baseLen = baseSegs.length;
  const added = fullSegs.length - baseLen;
  if (baseLen === 0 || added < 0 || baseOwnSep !== fullOwnSep) {
    return;
  }

  // Segments before the group match in base and full alike.
  let at = 0;
  while (at < baseLen && baseSegs[at] === fullSegs[at]) {
    at++;
  }

  if (added === 0) {
    // `body` extends one segment (`book` -> `books`, `:id(\d+)` -> `:id(\d+)-:t`)
    // and every other segment is shared; make the appended tail optional.
    if (at === baseLen || !sameSegments(baseSegs, fullSegs, at + 1, at + 1)) {
      return;
    }
    const segment = inlineOptionalTail(baseSegs[at], fullSegs[at]);
    if (!segment) {
      return;
    }
    const inlineSegs = fullSegs.slice();
    inlineSegs[at] = segment;
    return new RegExp(`^${joinSegments(inlineSegs, fullOwnSep)}${TRAILING_SLASH}`);
  }

  // `body` adds whole segments (`/foo` -> `/foo/bar`, `/users/posts` ->
  // `/users/:id/posts`) between a non-empty head and the shared rest; make the
  // added segments optional.
  if (at === 0 || !sameSegments(baseSegs, fullSegs, at, at + added)) {
    return optionalStarTail(baseSegs, fullSegs, fullOwnSep);
  }
  const head = joinSegments(fullSegs.slice(0, at), fullOwnSep);
  const optional = fullSegs.slice(at, at + added).join("/");
  const rest = fullSegs.slice(at + added);
  return new RegExp(
    `^${head}(?:/${optional})?${rest.length > 0 ? `/${rest.join("/")}` : ""}${TRAILING_SLASH}`,
  );
}

/**
 * A trailing `*` is optional (`/media` reaches `/media/*`), so without the
 * group it folds into the previous segment (`media(?:/(?<_0>[^/]*))?`) while
 * with a mid-segment group it stays a segment of its own (`/media/*{.webp}?`).
 * Merge the two the same way, inside the optional separator.
 */
function optionalStarTail(
  baseSegs: string[],
  fullSegs: string[],
  ownSeparator: boolean,
): RegExp | undefined {
  const n = baseSegs.length;
  const prev = fullSegs[n - 1];
  const star = /^(.*)\(\?:\/(\(\?<_\d+>\[\^\/\]\*\))\)\?$/.exec(baseSegs[n - 1]);
  if (
    !star ||
    fullSegs.length !== n + 1 ||
    star[1] !== prev ||
    !sameSegments(baseSegs.slice(0, n - 1), fullSegs.slice(0, n - 1), 0, 0)
  ) {
    return;
  }
  const segment = inlineOptionalTail(star[2], fullSegs[n]);
  if (!segment) {
    return;
  }
  const head = fullSegs.slice(0, n);
  head[n - 1] = `${prev}(?:/${segment})?`;
  return new RegExp(`^${joinSegments(head, ownSeparator)}${TRAILING_SLASH}`);
}

/** Whether `a` from index `i` and `b` from index `j` hold the same segments. */
function sameSegments(a: string[], b: string[], i: number, j: number): boolean {
  if (a.length - i !== b.length - j) {
    return false;
  }
  for (; i < a.length; i++, j++) {
    if (a[i] !== b[j]) {
      return false;
    }
  }
  return true;
}

/**
 * Merge a segment regex without the optional group (`base`) and with it
 * (`full`) into one that matches either and captures what the alternation of
 * the two would: `full` wins whenever it matches.
 */
function inlineOptionalTail(base: string, full: string): string | undefined {
  // A base segment ending in an open-ended `[^/]*` / `[^/]+` capture would
  // swallow the optional tail if it were just appended (`/media/*{.webp}?`
  // would capture `photo.webp` instead of `photo`). In `full` that capture is
  // followed by the tail, so it becomes: take the `full` shape when the tail
  // can follow (checked by a lookahead up to the segment end), else the `base`
  // one.
  const open = /^(.*)\(\?<(\w+)>(\[\^\/\][*+])\)$/.exec(base);
  if (open) {
    const [, head, name, basePattern] = open;
    const start = `${head}(?<${name}>`;
    const fullPattern = full.slice(start.length, start.length + 5);
    const tail = full.slice(start.length + 6);
    if (
      !full.startsWith(start) ||
      (fullPattern !== "[^/]*" && fullPattern !== "[^/]+") ||
      full.charAt(start.length + 5) !== ")" ||
      tail === ""
    ) {
      return;
    }
    // The lookahead repeats the tail without its named groups (a name may
    // only appear once).
    const probe = tail.replace(/(?<!\\)\(\?<\w+>/g, "(?:");
    return `${start}${fullPattern}(?=${probe}(?![^/]))|${basePattern})(?:${tail})?`;
  }
  // Other greedy, open-ended captures (`.*` / `.+` constraints) can swallow the
  // tail the same way; they keep the alternation fallback.
  if (!full.startsWith(base) || /\.[*+]\)?$/.test(base)) {
    return;
  }
  return `${base}(?:${full.slice(base.length)})?`;
}

/**
 * Whether `route` has a modifier whose tree expansion the inline emitter can't
 * mirror: a `+`/`*` before the last segment turns into a terminal `**:name`
 * (`/a/:x+/b` is `/a/**:x`), and an empty segment followed only by optional
 * ones becomes trailing (and is dropped) once they are absent (`/a//:x?`
 * also registers `/a`).
 */
function needsModifierExpansion(route: string): boolean {
  const segments = splitRoute(route);
  for (let i = 0; i < segments.length - 1; i++) {
    const mod = paramModifier(segments[i]);
    if (mod === "+" || mod === "*") {
      return true;
    }
    if (segments[i] === "" && segments.slice(i + 1).every((s) => paramModifier(s))) {
      return true;
    }
  }
  return false;
}

/** The `?`/`+`/`*` modifier of a param segment (`:x?`, `pre-:x(\\d+)+`). */
function paramModifier(segment: string): string | undefined {
  return /:[\w-]+(?:\([^)]*\))?([?+*])$/.exec(segment)?.[1];
}

function _routeToRegExp(route: string): RegExp {
  const [segments, ownSeparator] = routeToRegExpSegments(route);
  // Root: lookup reaches `/` from `/` only (`//` is an empty segment).
  return new RegExp(
    segments.length > 0 ? `^${joinSegments(segments, ownSeparator)}${TRAILING_SLASH}` : "^/$",
  );
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
 * first route segment carrying its own separator (see `joinSegments`).
 */
function routeToRegExpSegments(route: string): [segments: string[], ownSeparator: boolean] {
  const reSegments: string[] = [];
  let idCtr = 0;
  let ownSeparator = false;

  const segments = splitRoute(route);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    // An empty *middle* segment (`/a//b`) is a real static segment in the tree,
    // so it must stay in the regex; `splitRoute` has already dropped the leading
    // and trailing empties (`/a//` = `/a/` = `/a`).
    if (!segment) {
      reSegments.push("");
      continue;
    }

    if (segment === "*") {
      const star = `(?<${toRegExpUnnamedKey(idCtr++)}>[^/]*)`;
      // A trailing `*` is optional in the tree (`/a` reaches `/a/*`), also
      // when only optional segments follow it (`/a/*/:x?` expands to `/a/*`).
      if (
        !segments.slice(i + 1).every((s) => paramModifier(s) === "?" || paramModifier(s) === "*")
      ) {
        reSegments.push(star);
      } else if (reSegments.length > 0) {
        reSegments.push(`${reSegments.pop()}(?:/${star})?`);
      } else {
        ownSeparator = true;
        reSegments.push(`(?:/${star})?`);
      }
    } else if (segment.startsWith("**")) {
      // The separator before a catch-all must stay anchored to the prefix: a
      // bare optional `/?` would let `/api/**` match `/apifoo`. `**` matches
      // zero or more segments (`/api` too), `**:name` one or more. A segment may
      // be empty, so one-or-more is the separator plus `.*` (`/api//` reaches
      // `/api/**:p` with `p: ""`; `/api/` is `/api` after trailing stripping).
      if (segment !== "**") {
        reSegments.push(`(?<${toGroupName(segment.slice(3))}>.*)`);
      } else if (reSegments.length > 0) {
        reSegments.push(`${reSegments.pop()}(?:/(?<_>.*))?`);
      } else {
        reSegments.push("?(?<_>.*)");
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
        const name = toGroupName(base.match(/:([\w-]+)/)?.[1] || `_${idCtr++}`);

        if (mod === "?") {
          const inner = escapeBareDots(
            base.replace(
              /:([\w-]+)(?:\(([^)]*)\))?/g,
              (_, id, pattern) =>
                `(?<${toGroupName(id)}>${pattern || (/^:[\w-]+$/.test(base) ? "[^/]*" : "[^/]+")})`,
            ),
          );
          if (reSegments.length > 0) {
            // Append optional group to previous segment: /foo(?:/<inner>)?
            const prevQ: string = reSegments.pop()!;
            reSegments.push(`${prevQ}(?:/${inner})?`);
          } else {
            ownSeparator = true;
            reSegments.push(`(?:/${inner})?`);
          }
          continue;
        }

        // + or * (preserve inline constraint when present)
        const pattern = base.match(/:([\w-]+)(?:\(([^)]*)\))?/)?.[2];
        if (reSegments.length > 0) {
          const prevMod: string = reSegments.pop()!;
          if (pattern) {
            const repeated = `${pattern}(?:/${pattern})*`;
            reSegments.push(
              mod === "+"
                ? `${prevMod}/(?<${name}>${repeated})`
                : `${prevMod}(?:/(?<${name}>${repeated}))?`,
            );
          } else {
            reSegments.push(
              mod === "+" ? `${prevMod}/(?<${name}>.*)` : `${prevMod}(?:/(?<${name}>.*))?`,
            );
          }
        } else {
          if (pattern) {
            const repeated = `${pattern}(?:/${pattern})*`;
            reSegments.push(mod === "+" ? `?(?<${name}>${repeated})` : `?(?<${name}>${repeated})?`);
          } else {
            // `+` needs at least one segment, so its separator is required.
            reSegments.push(mod === "+" ? `(?<${name}>.*)` : `?(?<${name}>.*)`);
          }
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
                  `(?<${toGroupName(id)}>${pattern || (whole ? "[^/]*" : "[^/]+")})`,
              )
              .replace(/(^|[^\\])\((?![?<])/g, (_, p) => `${p}(?<${toRegExpUnnamedKey(idCtr++)}>`),
          ),
        ),
      );
    } else {
      reSegments.push(segment.replace(/\\(.)/g, "$1").replace(/[.*+?^${}()|[\]]/g, "\\$&"));
    }
  }

  return [reSegments, ownSeparator];
}

function toRegExpUnnamedKey(index: number): string {
  return `_${index}`;
}
