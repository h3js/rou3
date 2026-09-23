import { expandGroupDelimiters, scanFirstGroup } from "./_group-delimiters.ts";
import { toGroupName } from "./_group-names.ts";
import {
  escapeBareDots,
  replaceEscapesOutsideGroups,
  resolveEscapePlaceholders,
} from "./_escape.ts";
import { hasSegmentWildcard, replaceSegmentWildcards } from "./_segment-wildcards.ts";
import { expandModifiers, splitRoute } from "./operations/_utils.ts";

// Lookup ignores up to two trailing slashes (`findRoute` strips one, then
// `splitPath` pops one trailing empty segment), so `/a/b`, `/a/b/` and `/a/b//`
// all reach `/a/b`. A third slash leaves a real empty last segment: the body
// then ends in `/` and exactly two more must follow (`/a///` reaches `/a/:x`
// with `x: ""`, `/a//` does not). The look-behind encodes that last rule.
const TRAILING_SLASHES = "(?://|(?<!/)/?)$";

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
 * only `route` — including the router's tolerances: up to two trailing slashes,
 * empty segments for `:name` / `*` params, and an optional trailing `*` — so it
 * can stand in for the router as a guard or scope check.
 *
 * Note: multi-group or mid-route optionals that cannot be inlined still fall
 * back to alternation and may contain duplicate named groups (valid in JS/Perl,
 * but requiring `PCRE2_DUPNAMES` for strict PCRE2 engines).
 *
 * @example
 * routeToRegExp("/users/:id(\\d+)"); // /^\/users\/(?<id>\d+)(?:\/\/|(?<!\/)\/?)$/
 * routeToRegExp("/blog/:id(\\d+){-:title}?"); // /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+))?(?:\/\/|(?<!\/)\/?)$/
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
    needsModifierExpansion(pre) ||
    needsModifierExpansion(pre + body)
  ) {
    return;
  }

  const [baseSegs, baseOwnSep] = routeToRegExpSegments(pre);
  const [fullSegs, fullOwnSep] = routeToRegExpSegments(pre + body);
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
    // `*` wildcard / unconstrained param, or `.*`/`.+`), appending `(?:tail)?`
    // lets that capture swallow the optional literal instead of leaving it out
    // — changing the captured value (`/media/*{.webp}?` would capture the whole
    // `photo.webp` instead of `photo`). Fall back to alternation, which anchors
    // the literal outside the capture in one branch.
    if (/(?:\[\^\/\]|\.)[*+]\)?$/.test(prefix)) {
      return;
    }
    const k = prefix.length;
    const inlineSegs = fullSegs.slice(0, baseLen - 1);
    inlineSegs.push(`${last.slice(0, k)}(?:${last.slice(k)})?`);
    return new RegExp(`^${joinSegments(inlineSegs, fullOwnSep)}${TRAILING_SLASHES}`);
  }

  // `body` adds one or more whole segments (e.g. `/foo` -> `/foo/bar`); make
  // the appended segments optional.
  const head = joinSegments(fullSegs.slice(0, baseLen), fullOwnSep);
  const tail = fullSegs.slice(baseLen).join("/");
  return new RegExp(`^${head}(?:/${tail})?${TRAILING_SLASHES}`);
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
  // Root: lookup reaches `/` from `/` and `//` only.
  return new RegExp(
    segments.length > 0 ? `^${joinSegments(segments, ownSeparator)}${TRAILING_SLASHES}` : "^//?$",
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
      // be empty, so one-or-more is the separator plus `.*` (`/api///` reaches
      // `/api/**:p` with `p: ""`; `/api//` is `/api` after trailing stripping).
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
