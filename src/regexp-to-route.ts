// Inverse of `routeToRegExp()`: parse an anchored, PCRE-compatible RegExp back
// into a rou3 route pattern. Targets the dialect emitted by `routeToRegExp()`
// (named groups `(?<name>...)`, `[^/]+`/`[^/]+?`/`[^/]*` segment matchers,
// `[\s\S]*` / `[\s\S]+` catch-alls (`.*`/`.+` in older versions), `(?:/...)?`
// optional groups, the trailing-slash suffix). Hand-written regexes that
// follow the same conventions convert too; constructs outside the dialect
// throw.

import { expandGroupDelimiters, scanFirstGroup } from "./_group-delimiters.ts";
import { fromGroupName } from "./_group-names.ts";
import { encodeLiteral } from "./operations/_utils.ts";

// Chars a literal is backslash-escaped as so `routeToRegExp` re-emits them
// verbatim: rou3 route syntax (`: ( ) * \`), `+` (a modifier after a param)
// and `| $ [ ]` (literals there too, but kept escaped so reversed routes keep
// their spelling; a raw `$` right after a `:name` throws). `.` is omitted on
// purpose: a literal dot stays raw. `{ } ? ^` are percent-encoded in a route,
// so no route has them as literals (see `literal` in `reverseSegment`).
const ROUTE_SPECIAL = new Set([":", "(", ")", "*", "\\", "+", "|", "$", "[", "]"]);

/**
 * Convert an anchored {@link RegExp} (or its source string) produced by
 * {@link routeToRegExp} back into a rou3 route pattern.
 *
 * Throws a `rou3:` error for input it can't represent exactly: a regex not
 * anchored with `^` and `$`, the flags `i`/`m`/`s`/`u`/`v` (`g`/`y`/`d` are
 * ignored), and constructs outside the dialect `routeToRegExp` emits.
 *
 * @example
 * regExpToRoute(/^\/users\/(?<id>\d+)\/?$/); // "/users/:id(\\d+)"
 * regExpToRoute(/^\/path\/(?<param>[^/]+)\/?$/); // "/path/:param"
 * regExpToRoute(/^\/path(?:\/(?<_0>(?:[\s\S]*[^/])?\/*?))??\/?$/); // "/path/**"
 */
export function regExpToRoute(regexp: RegExp | string): string {
  // Routes carry no flags, so a match-affecting flag would be silently dropped
  // and change matching semantics. Reject rather than lie: `i`/`m`/`s`, and
  // `u`/`v`, which change what a constraint means (`\p{L}` is a letter class
  // with them, the literal `p{L}` without; route constraints compile without
  // flags). `g`/`y`/`d` don't affect a fully-anchored match and are ignored.
  if (typeof regexp !== "string" && /[imsuv]/.test(regexp.flags)) {
    throw new Error(`rou3: cannot represent regexp flag(s) "${regexp.flags}" as a route`);
  }

  let src = typeof regexp === "string" ? regexp : regexp.source;

  // A route matches whole paths, so the regex must be anchored at both ends
  // (an unanchored one matches any path containing it). A `$` after an odd
  // run of backslashes is an escaped literal, not an anchor.
  if (!src.startsWith("^") || !src.endsWith("$") || /(?:^|[^\\])(?:\\\\)*\\\$$/.test(src)) {
    throw new Error(`rou3: regexp must be anchored with \`^\` and \`$\` (${src})`);
  }

  // Strip anchors and the trailing-slash suffix `routeToRegExp` appends (or the
  // plain optional slash older versions and hand-written regexes use).
  src = src.slice(1, -1);
  // Look-behind-free endings (see `withTrailingSlash`) back to their plain
  // forms. Only these exact shapes are rewritten; anything else, a lazy
  // quantifier inside a constraint included, is parsed as written.
  const rootRepeat = ROOT_REPEAT.exec(src);
  if (rootRepeat) {
    return `/:${paramName(rootRepeat[1])}*`;
  }
  // Endings with the rule built in back to the plain body and `\/?`.
  const closed = { dot: false };
  const plain = plainBody(src, closed);
  if (plain !== undefined) src = `${plain}\\/?`;
  // A lazy `.*` ending is a `(.*)` constraint; older versions emitted `.*`
  // for catch-alls too, so elsewhere a whole `.*` still reads as one.
  const dotConstraint = closed.dot || TRAILING_DOT.test(src);
  src = src
    .replace(TRAILING_CATCH_ALL, "(?<$1>[\\s\\S]*)$2\\/?")
    .replace(TRAILING_DOT, "(?<$1>.*)$2\\/?");
  if (src.endsWith(TRAILING_SLASH)) src = src.slice(0, -TRAILING_SLASH.length);
  else if (src.endsWith(LEGACY_TRAILING_SLASHES)) {
    src = src.slice(0, -LEGACY_TRAILING_SLASHES.length);
  } else if (src.endsWith("\\/?")) src = src.slice(0, -3);

  if (src === "" || src === "\\/") {
    return "/";
  }

  // A route starting with a `{/…}?` group (see `mergeGroup`) is absolute as
  // is; after a `\/` the group follows an empty first segment (`/{/a}?`)
  const route = parseSegments(src, true, !dotConstraint).join("/");
  if (route.charCodeAt(0) !== 123 /* { */ || src.startsWith("\\/")) return `/${route}`;
  // Text after a leading group (`{/a}?{b}?/c`) throws like in `addRoute`,
  // quoting the whole route
  const check = (r: string): void => {
    for (const p of expandGroupDelimiters(r, route) || []) if (p.charCodeAt(0) === 123) check(p);
  };
  check(route);
  return route;
}

// The look-behind-free endings `withTrailingSlash` emits, as `RegExp#source`
// spells them (`x` stands for any group name):
// - a catch-all that needs a value (`**:x`, `:x+`, and `:x*` in an optional
//   group): `(?:\/\/|(?<x>(?:[\s\S]*[^/]|\/\/)\/*?)\/?)`
// - a trailing catch-all, possibly inside optional groups: `(?<x>(?:[\s\S]*[^/])?\/*?)`
// - 0.11's root `:x*` (it could be empty), whole: `(?:\/?(?<x>(?:[\s\S]*[^/])?\/*?))??\/?`
// - a required `(.*)` constraint: `(?:\/|(?<x>.+?)\/?)`
// - a trailing optional one, possibly inside optional groups: `(?:\/(?<x>.*?))??`
// - a required `*` (after `**`): `(?:(?<x>[^/]+)\/?|\/)`
// - a required `*` before optional segments: `(?:(?<x>[^/]+)(?:\/|$)|\/)`,
//   followed by a tail (see `plainBody`)
// 0.10 regexes (a `:x` / `:x+` could be empty there) end a `:x` in the `*`
// forms and a catch-all in `(?:\/|(?<x>(?:[\s\S]*[^/]|\/)\/*?)\/?)`: read as
// `:x` and `:x+`.
const REQUIRED_PARAM = /\(\?:\(\?<(\w+)>\[\^\/\]\+\)\\\/\?\|\\\/\)$/;
const REQUIRED_VALUE =
  /\(\?:\\\/\\\/\|\(\?<(\w+)>\(\?:\[\\s\\S\]\*\[\^\/\]\|\\\/\\\/\)\\\/\*\?\)\\\/\?\)$/;
const REQUIRED_CATCH_ALL =
  /\(\?:\\\/\|\(\?<(\w+)>\(\?:\[\\s\\S\]\*\[\^\/\]\|\\\/\)\\\/\*\?\)\\\/\?\)$/;
const TRAILING_CATCH_ALL =
  /\(\?<(\w+)>\(\?:\[\\s\\S\]\*\[\^\/\]\)\?\\\/\*\?\)((?:\)\?\??)*)\\\/\?$/;
const ROOT_REPEAT = /^\(\?:\\\/\?\(\?<(\w+)>\(\?:\[\\s\\S\]\*\[\^\/\]\)\?\\\/\*\?\)\)\?\?\\\/\?$/;
const REQUIRED_DOT = /\(\?:\\\/\|\(\?<(\w+)>\.\+\?\)\\\/\?\)$/;
const TRAILING_DOT = /(?<=\(\?:\\\/)\(\?<(\w+)>\.\*\?\)(\)\?\?(?:\)\?\??)*)\\\/\?$/;
const REQUIRED_HEAD = /\(\?:\(\?<(\w+)>\[\^\/\]\+\)\(\?:\\\/\|\$\)\|\\\/\)$/;
const REQUIRED_ENDINGS = [
  [REQUIRED_PARAM, "[^/]*"],
  [REQUIRED_VALUE, "[\\s\\S]+"],
  [REQUIRED_CATCH_ALL, "[\\s\\S]*"],
  [REQUIRED_DOT, ".*"],
] as const;

/**
 * An ending `withTrailingSlash` builds the trailing-slash rule into, back to
 * the plain body (without the `\/?`), or `undefined` if `src` doesn't end in
 * one. The required endings are a `*`, a catch-all and a `(.*)` constraint
 * (which sets `closed.dot`). The others end in a tail `X`, an optional group
 * without its leading slash, after a required `*` (`REQUIRED_HEAD`), after an
 * empty segment (`\/\/X`), or as `(?:\/X)?` after a segment that can't be
 * empty. `X` is `(?:R\/?)?` / `(?:R\/?)??` with `R` a plain body, or `(?:C)?`
 * with `C` one of these endings.
 */
function plainBody(src: string, closed: { dot: boolean }): string | undefined {
  for (const [ending, body] of REQUIRED_ENDINGS) {
    const required = ending.exec(src);
    if (required) {
      closed.dot ||= body === ".*";
      return `${src.slice(0, required.index)}(?<${required[1]}>${body})`;
    }
  }
  const group = trailingGroup(src);
  if (!group) return;
  const [start, inner, lazy] = group;
  const before = src.slice(0, start);
  if (!lazy && inner.startsWith("\\/")) {
    const tail = plainTail(inner.slice(2), closed);
    if (tail !== undefined) return before + tail;
  }
  const tail = plainTail(src.slice(start), closed);
  if (tail === undefined) return;
  const head = REQUIRED_HEAD.exec(before);
  if (head) {
    return `${before.slice(0, head.index)}(?<${head[1]}>[^/]*)${tail}`;
  }
  return before.endsWith("\\/\\/") ? before.slice(0, -2) + tail : undefined;
}

/** A tail `X` (see `plainBody`) back to its optional group `(?:\/…)?`. */
function plainTail(x: string, closed: { dot: boolean }): string | undefined {
  const group = trailingGroup(x);
  if (!group || group[0] !== 0) return;
  const [, inner, lazy] = group;
  if (inner.endsWith("\\/?")) {
    return `(?:\\/${inner.slice(0, -3)})?${lazy ? "?" : ""}`;
  }
  const body = lazy ? undefined : plainBody(inner, closed);
  return body === undefined ? undefined : `(?:\\/${body})?`;
}

/**
 * The last top-level `(?:…)` group of `src` when only `?` or `??` follows it:
 * `[start, inner, lazy]`.
 */
function trailingGroup(src: string): [start: number, inner: string, lazy: boolean] | undefined {
  for (let i = 0; i < src.length;) {
    if (src[i] === "(") {
      const end = readGroup(src, i);
      const quantifier = src.slice(end);
      if (src.startsWith("(?:", i) && (quantifier === "?" || quantifier === "??")) {
        return [i, src.slice(i + 3, end - 1), quantifier === "??"];
      }
      i = end;
    } else if (src[i] === "[") {
      // A class: `(` and `)` in it are literal.
      i++;
      while (i < src.length && src[i] !== "]") i += src[i] === "\\" ? 2 : 1;
      i++;
    } else {
      i += src[i] === "\\" ? 2 : 1;
    }
  }
}

/**
 * Whether a whole group `body` is a catch-all: `[\s\S]*` (lazy `[\s\S]*?`
 * where optional segments right after it take the end of the path), or `.*`
 * as older versions emitted it (`dot`), where it reads the same as a `(.*)`
 * constraint. With `value`, also one that needs a value (`**:x`, `:x+`):
 * `[\s\S]+` / `[\s\S]+?`.
 */
function isCatchAll(body: string, dot: boolean, value?: boolean): boolean {
  return (
    body === "[\\s\\S]*" ||
    body === "[\\s\\S]*?" ||
    (dot && body === ".*") ||
    (!!value && (body === "[\\s\\S]+" || body === "[\\s\\S]+?"))
  );
}

/** Whether `src` continues with another segment or optional group at `i`. */
function continues(src: string, i: number): boolean {
  return src.startsWith("\\/", i) || src.startsWith("(?:", i);
}

/**
 * Parse a regex body (segments after `\/`, optional groups) into route
 * segments. `atEnd`: whether the body ends the route, where a trailing
 * `(?:\/(?<_0>[\s\S]*))?` is `**`. `dot`: whether a whole `.*` is a catch-all
 * (see `isCatchAll`). `inGroup`: whether the body is a `{…}?` group's.
 */
function parseSegments(src: string, atEnd: boolean, dot: boolean, inGroup = false): string[] {
  const segments: string[] = [];
  const n = src.length;
  let i = 0;

  while (i < n) {
    // Optional group unit: `(?:...)?`, or `(?:...)??` (lazy: same paths, the
    // group skipped where it can be).
    if (src.startsWith("(?:", i)) {
      const end = readGroup(src, i);
      if (src[end] !== "?") {
        throw new Error(`rou3: unsupported non-optional group in "${src}"`);
      }
      const lazy = src[end + 1] === "?";
      const next = end + (lazy ? 2 : 1);
      const inner = src.slice(i + 3, end - 1);
      applyOptional(segments, inner, atEnd && next === n, lazy, dot, inGroup);
      i = next;
      // More of its segment after an in-segment group (`/{:x}?(\d+)`; `{}`
      // can't nest, and no segment holds a `/`). It is part of a segment (a
      // `(.+)` is no `:_0+`), and an optional unit after it in the segment
      // is no route's: a `{…}?` there routes otherwise than an in-place
      // `-:y?` (`/{:x}?(.+)-:y?`).
      if (i < n && !continues(src, i) && !inGroup && !inner.includes("\\/")) {
        const end = segmentEnd(src, i);
        if (src.startsWith("(?:", end) && !src.startsWith("(?:\\/", end)) {
          throw new Error(`rou3: unsupported optional group after a group in "${src}"`);
        }
        segments[segments.length - 1] += reverseSegment(src.slice(i, end), true);
        i = end;
      }
      continue;
    }

    // Catch-all unit at the end: `/?(?<x>[\s\S]*)`, emitted by older versions
    // for a root `/**` (as `_`), and after any prefix, with `.*` (`**`, or a
    // root `:name*`) and `.+` (`**:name`), so those forms are still accepted
    // as input.
    if (src.startsWith("\\/?", i)) {
      const g = matchNamedGroup(src, i + 3);
      if (g && g.end === n && (g.body === ".+" || isCatchAll(g.body, dot))) {
        segments.push(
          g.body === ".+" ? `**:${g.name}` : g.unnamed || g.name === "_" ? "**" : `:${g.name}*`,
        );
        break;
      }
      // A 0.11 root `**` with segments after it (`/**\/_payload.json`).
      if (g && g.name === "_" && isCatchAll(g.body, dot) && src.startsWith("\\/", g.end)) {
        segments.push("**");
        i = g.end;
        continue;
      }
    }

    // One-or-more catch-all: `/(?<name>[\s\S]+)` (`**:name` / `:name+`,
    // `[\s\S]*` before they needed a value). An unnamed `(?<_N>…)` is a
    // constraint, not a param name.
    if (src.startsWith("\\/", i)) {
      const g = matchNamedGroup(src, i + 2);
      if (
        g &&
        (g.end === n || continues(src, g.end)) &&
        isCatchAll(g.body, dot, true) &&
        !g.unnamed
      ) {
        segments.push(`:${g.name}+`);
        i = g.end;
        continue;
      }
    }

    // Static separator + segment.
    if (src.startsWith("\\/", i)) {
      const end = segmentEnd(src, i + 2);
      segments.push(reverseSegment(src.slice(i + 2, end)));
      i = end;
      continue;
    }

    throw new Error(`rou3: cannot parse "${src}" at index ${i}`);
  }

  // A lone param group ending a segment after text is `pre-:x?`: `pre-{:x}?`
  // after plain text, and compiled in place (this regex) after a capture
  // (not before more groups: `b:x?{.:y}?` is no route).
  return segments.map((segment) =>
    segment.replace(/^([^{]+)\{(:[A-Za-z_]\w*(?:\([^)]*\))?)\}\?$/, "$1$2?"),
  );
}

/** Reverse a single segment (no top-level separators) into route syntax. */
function reverseSegment(seg: string, part?: boolean): string {
  // Whole-segment repeat form `:name+` (a constrained one, `PAT(?:/PAT)*`
  // as older versions emitted for `:name(pat)+`, has no route form: its `/`
  // makes `constraint()` throw). `part`: `seg` is the rest of a segment.
  const whole = !part && matchNamedGroup(seg, 0);
  if (whole && whole.end === seg.length && whole.body === ".+") {
    return `:${whole.name}+`;
  }

  let out = "";
  let i = 0;
  // After a bare `:name`, a word char would extend the name: escape it. A
  // char route text percent-encodes (`encodeLiteral`: non-ASCII, space,
  // `{ } ? ^ #`, ...) is no literal of any route: throw. A `(pat)` would read
  // as its constraint, so the name gets the one it has, without a `/`
  // (`:x([^\x2f]+?)(pat)`, what `{:x}(pat)` expands to, see `joinGroup`).
  // After any group a `*` reads as a modifier and after a `*` a `*` as a
  // `**`: no route emits these.
  let afterName = false;
  let afterStar = false;
  // The body of the last group (`[^/]+?`, `[^/]+` or `[^/]*` for a bare name)
  let lastBody = "";
  // The char (code point) at `at`, as a literal; returns its length.
  // U+FFFD-U+FFFF are internal placeholders, which no route has either.
  const literal = (at: number): number => {
    const ch = String.fromCodePoint(seg.codePointAt(at)!);
    const encoded = ch.charCodeAt(0) < 0xfffd ? encodeLiteral(ch) : encodeURIComponent(ch);
    if (encoded !== ch) {
      throw new Error(
        `rou3: no route has a literal ${JSON.stringify(ch)} (route text is percent-encoded, write it as ${encoded}) in "${seg}"`,
      );
    }
    out += afterName && /\w/.test(ch) ? `\\${ch}` : escapeLiteral(ch);
    afterName = afterStar = false;
    return ch.length;
  };
  const param = (token: string, name?: string) => {
    if (afterName && token[0] === "(") {
      out += `([^\\x2f]${lastBody.slice(4)})`;
    } else if (
      (afterName && token[0] !== ":") ||
      (token === "*" && (afterStar || out.endsWith(")")))
    ) {
      throw new Error(`rou3: no route has a param followed by a group in "${seg}"`);
    }
    out += token;
    afterName = token === `:${name}`;
    afterStar = token === "*";
  };
  while (i < seg.length) {
    const c = seg[i];
    if (c === "(") {
      const g = matchNamedGroup(seg, i);
      if (g) {
        param(paramToken(g.name, g.body, g.unnamed), g.name);
        lastBody = g.body;
        i = g.end;
        continue;
      }
      if (!seg.startsWith("(?", i)) {
        // Bare capturing group `(...)` -> unnamed param (route `(pat)` / `*`).
        const end = readGroup(seg, i);
        param(paramToken("_0", seg.slice(i + 1, end - 1), true));
        i = end;
        continue;
      }
      // `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!`, inline flags, ...: no route form.
      throw new Error(`rou3: unsupported group construct in "${seg}"`);
    }
    if (c === "\\") {
      const next = seg[i + 1];
      if (next === undefined) {
        throw new Error(`rou3: dangling escape in "${seg}"`);
      }
      // Outside a constraint, only escaped punctuation is a literal. An
      // alphanumeric escape is a regex metaclass or backreference (`\d`, `\w`,
      // `\b`, `\k<x>`, `\1`) with no route representation. (Inside a `(...)`
      // constraint these are opaque and preserved verbatim.)
      if (/[a-z0-9]/i.test(next)) {
        throw new Error(`rou3: unsupported escape "\\${next}" in "${seg}"`);
      }
      i += 1 + literal(i + 1);
      continue;
    }
    // A bare (unescaped) regex operator at segment level is out of dialect: it
    // means alternation/quantifier/anchor/char-class/any-char, none of which a
    // route can express. `routeToRegExp` only emits these escaped (literal) or
    // inside a `(...)` group, so reject rather than silently literalize them.
    if (BARE_META.has(c)) {
      throw new Error(`rou3: unsupported metacharacter "${c}" in "${seg}"`);
    }
    i += literal(i);
  }
  return out;
}

// Look-behind trailing-slash suffix `routeToRegExp` still emits for a few
// route endings (as `RegExp#source` spells it), and the two-slash form it
// emitted before #209.
const TRAILING_SLASH = "(?:(?<=\\/)\\/|(?<!\\/)\\/?)";
const LEGACY_TRAILING_SLASHES = "(?:\\/\\/|(?<!\\/)\\/?)";

const BARE_META = new Set([".", "^", "$", "*", "+", "?", "|", "[", "]", "{", "}", ")"]);

/**
 * Reverse a `(?:...)?` optional unit into route syntax, appending to
 * `segments`. `inGroup`: whether `segments` are a `{…}?` group's.
 */
function applyOptional(
  segments: string[],
  inner: string,
  last: boolean,
  lazy: boolean,
  dot: boolean,
  inGroup: boolean,
): void {
  if (inner.startsWith("\\/")) {
    const rest = inner.slice(2);
    // `:x*` and a lone optional last segment in one group (see
    // `pushCatchAll` in regexp.ts): `(?:/(?:(?<x>[\s\S]+)/)?(?<y>[^/]*))?`
    // (`[\s\S]*` in older versions, also for a `**`).
    const nested = NESTED_CATCH_ALL.exec(rest);
    // An unnamed catch-all is no `:_N*` (see the unnamed capture below).
    if (nested && !UNNAMED.test(nested[1])) {
      const [catchAll, last] = [nested[1], nested[3]].map(paramName);
      const unnamed = UNNAMED.test(nested[3]);
      segments.push(catchAll === "_" && !unnamed && nested[2] === "*" ? "**" : `:${catchAll}*`);
      segments.push(unnamed ? "*" : `:${last}?`);
      return;
    }
    const g = matchNamedGroup(rest, 0);
    if (g && g.end === rest.length) {
      // An unnamed catch-all is the bare `**`, greedy before segments that
      // take the end of the path, lazy otherwise.
      if (g.unnamed && isCatchAll(g.body, dot)) {
        segments.push("**");
        return;
      }
      // An unnamed capture has no `:name?` form (`:_0(…)?` is a param named
      // `_0`): `{/(pat)}?` on the previous segment. A `*` is optional alone
      // only at the end of the route, `{/*}?` elsewhere. Inside a group that
      // would nest `{…}`, which `addRoute` rejects.
      if (g.unnamed && (g.body !== "[^/]*" || !last)) {
        if (inGroup) {
          throw new Error(
            `rou3: no route has an optional unnamed capture in a group in "${inner}"`,
          );
        }
        mergeGroup(segments, `/${paramToken(g.name, g.body, true)}`);
        return;
      }
      // 0.11 and older emitted `**` as the group `_`. A greedy
      // `(?:/(?<_>[\s\S]*))?` is the `**` catch-all, and so is a lazy group
      // with a lazy body (optional segments after it take the end of the
      // path). A lazy group with a greedy body is `{/**}?`, which leaves `_`
      // unset on `/a/` where `**` reports `""` (a `:_*` in older versions, and
      // still where no group can be merged).
      if (g.name === "_" && isCatchAll(g.body, dot)) {
        if (!lazy || g.body.endsWith("?")) {
          segments.push("**");
        } else if (segments.length > 0 && !inGroup) {
          mergeGroup(segments, "/**");
        } else {
          segments.push(":_*");
        }
        return;
      }
      // A single whole-segment param -> `:name?` / `:name*` / `:name(pat)?|*`.
      // A catch-all that needs a value is a `:name*` (`{/:name+}?`), and so is
      // one that may be empty, as older versions emitted it.
      segments.push(optionalParam(g, dot));
      return;
    }
    // A whole-segment `:name?` / `*` with the next optionals nested inside,
    // as `routeToRegExp` emits `/:x?/:y?`, where a group can't be merged: at
    // the root, or inside a group (no nested `{…}?`). The router matches the
    // same paths with the optionals side by side. After a segment, `{/:x/*}?`
    // is the route that captures like the regex (`/a/:x?/*` compiles to the
    // same one, but gives `0`, not `x`, on `/a/b`).
    const units =
      (segments.length === 0 || inGroup) &&
      g &&
      (g.unnamed ? g.body === "[^/]*" : /^\[\^\/\][*+]$/.test(g.body))
        ? optionalUnits(rest.slice(g.end))
        : undefined;
    if (g && units) {
      segments.push(optionalParam(g, dot));
      for (const [i, [unit, unitLazy]] of units.entries()) {
        applyOptional(segments, unit, last && i === units.length - 1, unitLazy, dot, inGroup);
      }
      return;
    }
    // Literal / mixed optional segments, possibly with optionals of their own
    // (`{/sub/**}?`) -> `{/...}?` merged onto the previous segment.
    mergeGroup(segments, `/${parseSegments(inner, last, dot, true).join("/")}`, inGroup);
    return;
  }
  // In-segment optional -> `{...}?` merged onto the previous segment.
  mergeGroup(segments, reverseSegment(inner));
}

/**
 * Split `src` into optional units `(?:\/…)?` / `(?:\/…)??`, as
 * `[inner, lazy]`, or `undefined` if it holds anything else.
 */
function optionalUnits(src: string): [inner: string, lazy: boolean][] | undefined {
  const units: [string, boolean][] = [];
  for (let i = 0; i < src.length;) {
    if (!src.startsWith("(?:\\/", i)) return;
    const end = readGroup(src, i);
    if (src[end] !== "?") return;
    const lazy = src[end + 1] === "?";
    units.push([src.slice(i + 3, end - 1), lazy]);
    i = end + (lazy ? 2 : 1);
  }
  return units.length > 0 ? units : undefined;
}

/**
 * Append the optional group `{body}?` to the previous segment. With none, a
 * group of whole segments starts the route (`{/a}?/b`, absolute as in
 * URLPattern); a group inside a group would nest (also where `body` holds one:
 * `(?:\/a(?:\/b)?)?`), and a leading in-segment one (`{a}?`) is relative:
 * those throw.
 */
function mergeGroup(segments: string[], body: string, inGroup?: boolean): void {
  if (scanFirstGroup(body)) {
    throw new Error(`rou3: no route has a group inside a group in "{${body}}?"`);
  }
  if (segments.length === 0) {
    if (inGroup || body.charCodeAt(0) !== 47 /* / */) {
      throw new Error(`rou3: optional group "{${body}}?" has no preceding segment`);
    }
    segments.push(`{${body}}?`);
    return;
  }
  segments[segments.length - 1] += `{${body}}?`;
}

/** Classify a param group inside a segment (`:name`, `*`, `(pat)`, ...). */
function paramToken(name: string, body: string, unnamed: boolean): string {
  // `*` (unnamed `[^/]*`) and `:name` (named `[^/]+`, `[^/]+?` sharing its
  // segment, or `[^/]*` as older versions emitted) are the only
  // single-segment matchers with dedicated syntax. Every other body becomes
  // an inline `(pat)` constraint, which `constraint()` rejects if it can't
  // survive path splitting.
  if (unnamed && body === "[^/]*") {
    return "*";
  }
  if (!unnamed && /^\[\^\/\](?:\*|\+\??)$/.test(body)) {
    return `:${name}`;
  }
  return unnamed ? constraint(body) : `:${name}${constraint(body)}`;
}

/**
 * Classify a param inside an optional group (`:name?`, `:name*`, ...). An
 * unnamed one is a `*` where that is optional (ending the route, or with the
 * next optionals nested in its group): the callers write other unnamed
 * captures, and a `*` elsewhere, as `{/…}?`.
 */
function optionalParam({ name, body, unnamed }: NamedGroup, dot: boolean): string {
  // `(?:/(?<_N>[^/]*))?` is a trailing `*` (optional in the tree).
  if (unnamed) {
    return "*";
  }
  if (body === "[^/]*" || body === "[^/]+") {
    return `:${name}?`;
  }
  if (isCatchAll(body, dot, true)) {
    return `:${name}*`;
  }
  return `:${name}${constraint(body)}?`;
}

// `(?:(?<x>[\s\S]+)\/)?(?<y>[^/]*)`: a catch-all and a lone optional last
// segment in one optional group (`[\s\S]*` in older versions).
const NESTED_CATCH_ALL = /^\(\?:\(\?<(\w+)>\[\\s\\S\]([*+])\)\\\/\)\?\(\?<(\w+)>\[\^\/\]\*\)$/;

/**
 * Wrap an inline param constraint as `(body)`, rejecting bodies that contain a
 * `/`. rou3 splits routes on `/` before parsing params, so a constraint with a
 * slash (e.g. `[a-z/]+`) is unrepresentable — throw rather than emit a route
 * `routeToRegExp` would choke on.
 */
function constraint(body: string): string {
  if (body.includes("/")) {
    throw new Error(`rou3: param constraint "(${body})" cannot contain "/"`);
  }
  // A capturing group inside a constraint has no route form (`addRoute` rejects it)
  if (/\((?!\?(?!<[^=!]))/.test(body.replace(/\\[\s\S]|\[(?:\\[\s\S]|[^\]])*\]/g, ""))) {
    throw new Error(`rou3: param constraint "(${body})" cannot contain a capturing group`);
  }
  return `(${body})`;
}

function escapeLiteral(ch: string): string {
  return ROUTE_SPECIAL.has(ch) ? `\\${ch}` : ch;
}

interface NamedGroup {
  name: string;
  body: string;
  end: number;
  /** An unnamed capture (`_N`), told apart by the raw group name (see `UNNAMED`). */
  unnamed: boolean;
}

// The unnamed-capture group name `routeToRegExp` emits. Tested on the raw group
// name: a param `:_0` is emitted escaped and decodes to the same `_0`.
const UNNAMED = /^_\d+$/;

/**
 * Parse `(?<name>...)` at `start`, returning its name, body and end index. The
 * name is decoded back to its route form, so a param whose name is emitted
 * escaped (`:_0`) round-trips instead of leaking the escaped group name.
 */
function matchNamedGroup(src: string, start: number): NamedGroup | undefined {
  if (!src.startsWith("(?<", start)) {
    return undefined;
  }
  // `(?<=` / `(?<!` are look-behind assertions, not `(?<name>...)` groups.
  const after = src[start + 3];
  if (after === "=" || after === "!") {
    return undefined;
  }
  const gt = src.indexOf(">", start);
  if (gt === -1) {
    return undefined;
  }
  const end = readGroup(src, start);
  const key = src.slice(start + 3, gt);
  return {
    name: paramName(key),
    body: src.slice(gt + 1, end - 1),
    end,
    unnamed: UNNAMED.test(key),
  };
}

/** Decode a capture-group name into a route param name (`[A-Za-z_]\w*`). */
function paramName(key: string): string {
  const name = fromGroupName(key);
  if (!/^[A-Za-z_]\w*$/.test(name)) {
    throw new Error(`rou3: "${name}" is not a valid param name`);
  }
  return name;
}

/** Index just past the `)` matching the `(` at `start`, class/escape aware. */
function readGroup(src: string, start: number): number {
  let depth = 0;
  let inClass = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inClass) {
      if (c === "\\") i++;
      else if (c === "]") inClass = false;
      continue;
    }
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  throw new Error(`rou3: unbalanced group in "${src}"`);
}

/** Index where the segment starting at `start` ends (top-level `/` or `(?:`). */
function segmentEnd(src: string, start: number): number {
  let depth = 0;
  let inClass = false;
  let i = start;
  while (i < src.length) {
    if (inClass) {
      if (src[i] === "\\") i++;
      else if (src[i] === "]") inClass = false;
      i++;
      continue;
    }
    if (depth === 0 && (src.startsWith("\\/", i) || src.startsWith("(?:", i))) {
      break;
    }
    const c = src[i];
    if (c === "\\") i += 2;
    else if (c === "[") {
      inClass = true;
      i++;
    } else {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
  }
  return i;
}
