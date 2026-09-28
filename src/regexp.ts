import { expandGroupDelimiters, scanFirstGroup } from "./_group-delimiters.ts";
import { toGroupName } from "./_group-names.ts";
import {
  escapeBareDots,
  replaceEscapesOutsideGroups,
  resolveEscapePlaceholders,
} from "./_escape.ts";
import { hasSegmentWildcard, replaceSegmentWildcards } from "./_segment-wildcards.ts";
import { expandModifiers, splitRoute } from "./operations/_utils.ts";
import { isOptionalGroups } from "./_regexp-scan.ts";
import { withTrailingSlash } from "./_trailing-slash.ts";

// Catch-all body. The router splits paths on `/` only, so a catch-all takes
// any char, line terminators included; `.` would not (JS excludes `\n`, `\r`,
// U+2028 and U+2029, PCRE and RE2 by default only `\n`). `[\s\S]` is any char
// in all of them.
const ANY = "[\\s\\S]*";

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
 * Note: other optionals (several groups, `/media/*{.webp}?`) still fall back to
 * alternation and may contain duplicate named groups (valid in Perl and in JS
 * engines that support them, V8 12.5+; they throw on Node 22 and need
 * `PCRE2_DUPNAMES` for strict PCRE2 engines).
 *
 * @throws a `rou3:` error when one expansion of `route` declares the same param
 * name twice (`/files/:path/**:path`, `/a/:x{/b/:x}?`); the resulting duplicate
 * named group would compile on some engines and not on others.
 *
 * @example
 * routeToRegExp("/users/:id(\\d+)"); // /^\/users\/(?<id>\d+)\/?$/
 * routeToRegExp("/blog/:id(\\d+){-:title}?"); // /^\/blog\/(?<id>\d+)(?:-(?<title>[^/]+))?\/?$/
 */
export function routeToRegExp(route: string = "/"): RegExp {
  if (route.charCodeAt(0) !== 47 /* '/' */) {
    route = `/${route}`;
  }

  // Compile a single optional group (`{...}?`) inline as `(?:...)?`
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
    // groups (e.g. `(?<id>a)|(?<id>b)`) for optionals that can't be inlined.
    // This is valid in JS engines with duplicate named groups (V8 12.5+ /
    // Node 24+, Firefox 129+, Safari 17+), but throws on Node 22 and is not
    // portable to PCRE2 without PCRE2_DUPNAMES.
    return new RegExp(`^(?:${sources.join("|")})$`);
  }

  return _routeToRegExp(route);
}

/**
 * Build an inline-optional regex for a route with a single `{…}?` group that
 * ends a segment (`/book{s}?`, `/foo{/bar}?/:id`). Returns `undefined`
 * (falling back to alternation expansion) for anything it can't inline
 * safely: multi-group routes, a group inside a segment, or unexpected segment
 * shapes.
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
    (suf !== "" && suf.charCodeAt(0) !== 47) /* '/' */ ||
    // Only a single group is handled inline; bail if another one is left.
    scanFirstGroup(pre) ||
    scanFirstGroup(body) ||
    scanFirstGroup(suf) ||
    needsModifierExpansion(pre + suf) ||
    needsModifierExpansion(pre + body + suf)
  ) {
    return;
  }

  const [baseSegs, baseOwnSep] = routeToRegExpSegments(pre + suf);
  const [fullSegs, fullOwnSep, starStar] = routeToRegExpSegments(pre + body + suf);
  const baseLen = baseSegs.length;
  const fullLen = fullSegs.length;
  if (baseLen === 0 || fullLen < baseLen || baseOwnSep !== fullOwnSep) {
    return;
  }

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
    let optional = false;
    let lookahead = false;
    if (last === prefix) {
      // The group adds nothing (`/a/**/b{.json}?`: `**` is terminal).
      merged = last;
    } else if (tail === 0 && last.startsWith(prefix) && isOptionalGroups(last.slice(k))) {
      // Only segments that are optional already (`/a{/:x*}?` is `/a/:x*`).
      optional = true;
      merged = last;
    } else {
      const capture = mergeCapture(prefix, last);
      if (capture) {
        [merged, lookahead] = capture;
      } else if (
        last.startsWith(prefix) &&
        // Past a capture elsewhere in the segment, the appended part could be
        // taken by it (`/f/:x.a{.a}?/m`): only trailing groups keep the old
        // inline form there.
        (suf === "" || !hasGroup(prefix)) &&
        // A greedy, open-ended capture (`[^/]*` from a `*` wildcard /
        // unconstrained param, or `.*`/`.+`/`[\s\S]*`) would swallow the
        // optional literal instead of leaving it out (`/media/*{.webp}?`).
        !/(?:\[\^\/\]|\[\\s\\S\]|\.)[*+]\)?$/.test(prefix)
      ) {
        merged = `${prefix}(?:${last.slice(k)})?`;
      }
    }
    if (!merged || ((suf !== "" || lookahead) && !fixedHead())) {
      return;
    }
    const inlineSegs = baseSegs.slice();
    inlineSegs[i] = merged;
    // `/a{/**}?` also registers `/a`, which wins where `**` would match no
    // segment: its group is skipped there like `:_*`'s.
    return new RegExp(
      `^${withTrailingSlash(joinSegments(inlineSegs, fullOwnSep), starStar && !optional)}`,
    );
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
  return new RegExp(`^${withTrailingSlash(`${head}(?:/${added})?${rest}`, starStar)}`);
}

/**
 * Merge a segment ending in its only capture (`(?<name>[^/]*)` from `:name` /
 * `*`, or a constraint `(?<name>C)`, after static text) with the same segment
 * extended by the group (`(?<name>[^/]+)\.(?<ext>[^/]+)`). The capture must
 * take the extended form's value where that one matches, and the whole value
 * otherwise, as the router (`archive.tar.gz` gives `name: "archive.tar"`).
 * That needs a look-ahead to the rest of the segment, unless the capture is a
 * `\d` / `\w` run and the group starts with a char it can't match
 * (`/blog/:id(\d+){-:title}?`). Returns `[merged, lookahead]`.
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
    // A whole `:name` is `[^/]*`, `:name` in a mixed segment `[^/]+`.
    const capture = /^(\[\^\/\][*+])\)([\s\S]+)$/.exec(full.slice(head.length));
    if (!capture || !/^\[\^\/\][*+]$/.test(body)) {
      return;
    }
    [, fullBody, rest] = capture;
  }
  if (!rest) {
    return;
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

/** Whether a regex fragment holds a group (escaped parens aside). */
function hasGroup(re: string): boolean {
  return re.replace(/\\[\s\S]/g, "").includes("(");
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
  const [segments, ownSeparator, starStar] = routeToRegExpSegments(route);
  // Root: lookup reaches `/` from `/` only (`//` is an empty segment).
  return new RegExp(
    segments.length > 0
      ? `^${withTrailingSlash(joinSegments(segments, ownSeparator), starStar)}`
      : "^/$",
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
 * first route segment carrying its own separator (see `joinSegments`), and
 * whether the route ends in a bare `**` (its `_` group reads the same as a
 * param named `_`, see `withTrailingSlash`).
 */
function routeToRegExpSegments(
  route: string,
): [segments: string[], ownSeparator: boolean, starStar: boolean] {
  const reSegments: string[] = [];
  let idCtr = 0;
  let ownSeparator = false;
  let starStar = false;

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
  const pushOptional = (inner: string, nestable: boolean) => {
    if (reSegments.length === 0) {
      ownSeparator = true;
      reSegments.push(`(?:/${inner})?`);
    } else {
      const prev = reSegments.pop()!;
      const at = prev.length - 2 * nest;
      reSegments.push(`${prev.slice(0, at)}(?:/${inner})?${prev.slice(at)}`);
    }
    if (nestable) nest++;
  };

  const segments = splitRoute(route);
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
      // when only optional segments follow it (`/a/*/:x?` expands to `/a/*`).
      if (
        !segments.slice(i + 1).every((s) => paramModifier(s) === "?" || paramModifier(s) === "*")
      ) {
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

  return [reSegments, ownSeparator, starStar];
}

function toRegExpUnnamedKey(index: number): string {
  return `_${index}`;
}
