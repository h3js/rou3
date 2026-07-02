import { expandGroupDelimiters, scanFirstGroup } from "./_group-delimiters.ts";
import {
  escapeBareDots,
  replaceEscapesOutsideGroups,
  resolveEscapePlaceholders,
} from "./_escape.ts";
import { hasSegmentWildcard, replaceSegmentWildcards } from "./_segment-wildcards.ts";

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
 * Note: multi-group or mid-route optionals that cannot be inlined still fall
 * back to alternation and may contain duplicate named groups (valid in JS/Perl,
 * but requiring `PCRE2_DUPNAMES` for strict PCRE2 engines).
 *
 * @example
 * routeToRegExp("/users/:id(\\d+)"); // /^\/users\/(?<id>\d+)\/?$/
 * routeToRegExp("/blog/:id(\\d+){-:title}?"); // /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+))?\/?$/
 */
export function routeToRegExp(route: string = "/"): RegExp {
  // Compile a trailing single optional group (`{...}?`) inline as `(?:...)?`
  // instead of expanding it into an alternation of full routes. The alternation
  // form re-emits every param before the group in both branches, producing
  // duplicate named groups that PCRE2-family engines reject.
  const inlineOptional = inlineOptionalGroup(route);
  if (inlineOptional) {
    return inlineOptional;
  }

  const groupExpanded = expandGroupDelimiters(route);
  if (groupExpanded) {
    const sources = groupExpanded.map((expandedRoute) =>
      routeToRegExp(expandedRoute).source.slice(1, -1),
    );
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
    scanFirstGroup(body)
  ) {
    return;
  }

  const baseSegs = routeToRegExpSegments(pre);
  const fullSegs = routeToRegExpSegments(pre + body);
  const baseLen = baseSegs.length;
  if (baseLen === 0 || fullSegs.length < baseLen) {
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
    return new RegExp(`^/${inlineSegs.join("/")}/?$`);
  }

  // `body` adds one or more whole segments (e.g. `/foo` -> `/foo/bar`); make
  // the appended segments optional.
  const head = fullSegs.slice(0, baseLen).join("/");
  const tail = fullSegs.slice(baseLen).join("/");
  return new RegExp(`^/${head}(?:/${tail})?/?$`);
}

function _routeToRegExp(route: string): RegExp {
  return new RegExp(`^/${routeToRegExpSegments(route).join("/")}/?$`);
}

function routeToRegExpSegments(route: string): string[] {
  const reSegments = [];
  let idCtr = 0;

  for (const segment of route.split("/")) {
    if (!segment) continue;

    if (segment === "*") {
      reSegments.push(`(?<${toRegExpUnnamedKey(idCtr++)}>[^/]*)`);
    } else if (segment.startsWith("**")) {
      reSegments.push(segment === "**" ? "?(?<_>.*)" : `?(?<${segment.slice(3)}>.+)`);
    } else if (
      segment.includes(":") ||
      /(^|[^\\])\(/.test(segment) ||
      hasSegmentWildcard(segment)
    ) {
      const modMatch = segment.match(/^(.*:[\w-]+(?:\([^)]*\))?)([?+*])$/);
      if (modMatch) {
        const [, base, mod] = modMatch;
        const name = base.match(/:([\w-]+)/)?.[1] || `_${idCtr++}`;

        if (mod === "?") {
          const inner = escapeBareDots(
            base.replace(
              /:([\w-]+)(?:\(([^)]*)\))?/g,
              (_, id, pattern) => `(?<${id}>${pattern || "[^/]+"})`,
            ),
          );
          if (reSegments.length > 0) {
            // Append optional group to previous segment: /foo(?:/<inner>)?
            const prevQ: string = reSegments.pop()!;
            reSegments.push(`${prevQ}(?:/${inner})?`);
          } else {
            reSegments.push(`?${inner}?`);
          }
          continue;
        }

        // + or * (preserve inline constraint when present)
        const pattern = base.match(/:(\w+)(?:\(([^)]*)\))?/)?.[2];
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
              mod === "+" ? `${prevMod}/(?<${name}>.+)` : `${prevMod}(?:/(?<${name}>.*))?`,
            );
          }
        } else {
          if (pattern) {
            const repeated = `${pattern}(?:/${pattern})*`;
            reSegments.push(mod === "+" ? `?(?<${name}>${repeated})` : `?(?<${name}>${repeated})?`);
          } else {
            reSegments.push(mod === "+" ? `?(?<${name}>.+)` : `?(?<${name}>.*)`);
          }
        }

        continue;
      }

      // Strip URLPattern backslash escapes before regex processing
      let dynamicSegment = replaceEscapesOutsideGroups(segment);
      [dynamicSegment, idCtr] = replaceSegmentWildcards(dynamicSegment, idCtr, toRegExpUnnamedKey);

      reSegments.push(
        resolveEscapePlaceholders(
          escapeBareDots(
            dynamicSegment
              .replace(
                /:([\w-]+)(?:\(([^)]*)\))?/g,
                (_, id, pattern) => `(?<${id}>${pattern || "[^/]+"})`,
              )
              .replace(/(^|[^\\])\((?![?<])/g, (_, p) => `${p}(?<${toRegExpUnnamedKey(idCtr++)}>`),
          ),
        ),
      );
    } else {
      reSegments.push(segment.replace(/\\(.)/g, "$1").replace(/[.*+?^${}()|[\]]/g, "\\$&"));
    }
  }

  return reSegments;
}

function toRegExpUnnamedKey(index: number): string {
  return `_${index}`;
}
