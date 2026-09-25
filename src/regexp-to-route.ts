// Inverse of `routeToRegExp()`: parse an anchored, PCRE-compatible RegExp back
// into a rou3 route pattern. Targets the dialect emitted by `routeToRegExp()`
// (named groups `(?<name>...)`, `[^/]+`/`[^/]*` segment matchers, `[\s\S]*`
// catch-alls (`.*`/`.+` in older versions), `(?:/...)?` optional groups, the
// trailing-slash suffix). Hand-written regexes that follow the same
// conventions convert too; constructs outside the dialect throw.

import { fromGroupName } from "./_group-names.ts";

// Chars a literal must be backslash-escaped as so `routeToRegExp` re-emits them
// verbatim: rou3 route syntax (`: ( ) { } * \`) plus regex metacharacters its
// dynamic-segment branch does not auto-escape (`? + | ^ $ [ ]`). `.` is omitted
// on purpose — that branch already escapes `.`, so a literal dot stays raw.
const ROUTE_SPECIAL = new Set([
  ":",
  "(",
  ")",
  "{",
  "}",
  "*",
  "\\",
  "?",
  "+",
  "|",
  "^",
  "$",
  "[",
  "]",
]);

/**
 * Convert an anchored {@link RegExp} (or its source string) produced by
 * {@link routeToRegExp} back into a rou3 route pattern.
 *
 * @example
 * regExpToRoute(/^\/users\/(?<id>\d+)\/?$/); // "/users/:id(\\d+)"
 * regExpToRoute(/^\/path\/(?<param>[^/]+)\/?$/); // "/path/:param"
 * regExpToRoute(/^\/path(?:\/(?<_>.*))?\/?$/); // "/path/**"
 */
export function regExpToRoute(regexp: RegExp | string): string {
  // Routes carry no flags, so a match-affecting flag (`i`/`m`/`s`) would be
  // silently dropped and change matching semantics. Reject rather than lie;
  // `g`/`y`/`u`/`v`/`d` don't affect a fully-anchored match and are ignored.
  if (typeof regexp !== "string" && /[ims]/.test(regexp.flags)) {
    throw new Error(`rou3: cannot represent regexp flag(s) "${regexp.flags}" as a route`);
  }

  let src = typeof regexp === "string" ? regexp : regexp.source;

  // Strip anchors and the trailing-slash suffix `routeToRegExp` appends (or the
  // plain optional slash older versions and hand-written regexes use).
  if (src.startsWith("^")) src = src.slice(1);
  if (src.endsWith("$")) src = src.slice(0, -1);
  // Look-behind-free endings (see `withTrailingSlash`) back to their plain
  // forms. Only these exact shapes are rewritten; anything else, a lazy
  // quantifier inside a constraint included, is parsed as written.
  const rootRepeat = ROOT_REPEAT.exec(src);
  if (rootRepeat) {
    return `/:${fromGroupName(rootRepeat[1])}*`;
  }
  // A lazy `.*` ending is a `(.*)` constraint; older versions emitted `.*`
  // for catch-alls too, so elsewhere a whole `.*` still reads as one.
  const dotConstraint = REQUIRED_DOT.test(src) || TRAILING_DOT.test(src);
  src = src
    .replace(REQUIRED_PARAM, "(?<$1>[^/]*)\\/?")
    .replace(REQUIRED_CATCH_ALL, "(?<$1>[\\s\\S]*)\\/?")
    .replace(TRAILING_CATCH_ALL, "(?<$1>[\\s\\S]*)$2\\/?")
    .replace(REQUIRED_DOT, "(?<$1>.*)\\/?")
    .replace(TRAILING_DOT, "(?<$1>.*)$2\\/?");
  if (src.endsWith(TRAILING_SLASH)) src = src.slice(0, -TRAILING_SLASH.length);
  else if (src.endsWith(LEGACY_TRAILING_SLASHES)) {
    src = src.slice(0, -LEGACY_TRAILING_SLASHES.length);
  } else if (src.endsWith("\\/?")) src = src.slice(0, -3);

  if (src === "" || src === "\\/") {
    return "/";
  }

  return "/" + parseSegments(src, true, !dotConstraint).join("/");
}

// The look-behind-free endings `withTrailingSlash` emits, as `RegExp#source`
// spells them (`x` stands for any group name):
// - a required `:x`: `(?:(?<x>[^/]+)\/?|\/)`
// - a required catch-all (`**:x`, `:x+`): `(?:\/|(?<x>(?:[\s\S]*[^/]|\/)\/*?)\/?)`
// - a trailing catch-all, possibly inside optional groups: `(?<x>(?:[\s\S]*[^/])?\/*?)`
// - a root `:x*`, whole: `(?:\/?(?<x>(?:[\s\S]*[^/])?\/*?))??\/?`
// - a required `(.*)` constraint: `(?:\/|(?<x>.+?)\/?)`
// - a trailing optional one, possibly inside optional groups: `(?:\/(?<x>.*?))??`
const REQUIRED_PARAM = /\(\?:\(\?<(\w+)>\[\^\/\]\+\)\\\/\?\|\\\/\)$/;
const REQUIRED_CATCH_ALL =
  /\(\?:\\\/\|\(\?<(\w+)>\(\?:\[\\s\\S\]\*\[\^\/\]\|\\\/\)\\\/\*\?\)\\\/\?\)$/;
const TRAILING_CATCH_ALL =
  /\(\?<(\w+)>\(\?:\[\\s\\S\]\*\[\^\/\]\)\?\\\/\*\?\)((?:\)\?\??)*)\\\/\?$/;
const ROOT_REPEAT = /^\(\?:\\\/\?\(\?<(\w+)>\(\?:\[\\s\\S\]\*\[\^\/\]\)\?\\\/\*\?\)\)\?\?\\\/\?$/;
const REQUIRED_DOT = /\(\?:\\\/\|\(\?<(\w+)>\.\+\?\)\\\/\?\)$/;
const TRAILING_DOT = /(?<=\(\?:\\\/)\(\?<(\w+)>\.\*\?\)(\)\?\?(?:\)\?\??)*)\\\/\?$/;

/**
 * Whether a whole group `body` is a catch-all: `[\s\S]*`, or `.*` as older
 * versions emitted it (`dot`), where it reads the same as a `(.*)` constraint.
 */
function isCatchAll(body: string, dot: boolean): boolean {
  return body === "[\\s\\S]*" || (dot && body === ".*");
}

/**
 * Parse a regex body (segments after `\/`, optional groups) into route
 * segments. `atEnd`: whether the body ends the route, where a trailing
 * `(?:\/(?<_>[\s\S]*))?` is `**`. `dot`: whether a whole `.*` is a catch-all
 * (see `isCatchAll`).
 */
function parseSegments(src: string, atEnd: boolean, dot: boolean): string[] {
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
      applyOptional(segments, src.slice(i + 3, end - 1), atEnd && next === n, lazy, dot);
      i = next;
      continue;
    }

    // Catch-all unit at the end: `/?(?<_>[\s\S]*)`, emitted by `routeToRegExp`
    // only for a root `/**`. Older versions used it after any prefix, with
    // `.*` (`**`, or a root `:name*`) and `.+` (`**:name`), so those forms are
    // still accepted as input.
    if (src.startsWith("\\/?", i)) {
      const g = matchNamedGroup(src, i + 3);
      if (g && g.end === n && (g.body === ".+" || isCatchAll(g.body, dot))) {
        segments.push(g.body === ".+" ? `**:${g.name}` : g.name === "_" ? "**" : `:${g.name}*`);
        break;
      }
    }

    // One-or-more catch-all at the end: `/(?<name>[\s\S]*)` (`**:name` /
    // `:name+`). An unnamed `(?<_N>…)` is a constraint, not a param name.
    if (src.startsWith("\\/", i)) {
      const g = matchNamedGroup(src, i + 2);
      if (g && g.end === n && isCatchAll(g.body, dot) && !/^_\d+$/.test(g.name)) {
        segments.push(`:${g.name}+`);
        break;
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

  return segments;
}

/** Reverse a single segment (no top-level separators) into route syntax. */
function reverseSegment(seg: string): string {
  // Whole-segment repeat forms: `:name+` / `:name(pat)+`.
  const whole = matchNamedGroup(seg, 0);
  if (whole && whole.end === seg.length) {
    if (whole.body === ".+") {
      return `:${whole.name}+`;
    }
    const rep = matchRepeat(whole.body);
    if (rep) {
      return `:${whole.name}${constraint(rep)}+`;
    }
  }

  let out = "";
  let i = 0;
  while (i < seg.length) {
    const c = seg[i];
    if (c === "(") {
      const g = matchNamedGroup(seg, i);
      if (g) {
        out += paramToken(g.name, g.body);
        i = g.end;
        continue;
      }
      if (!seg.startsWith("(?", i)) {
        // Bare capturing group `(...)` -> unnamed param (route `(pat)` / `*`).
        const end = readGroup(seg, i);
        out += paramToken("_0", seg.slice(i + 1, end - 1));
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
      out += escapeLiteral(next);
      i += 2;
      continue;
    }
    // A bare (unescaped) regex operator at segment level is out of dialect: it
    // means alternation/quantifier/anchor/char-class/any-char, none of which a
    // route can express. `routeToRegExp` only emits these escaped (literal) or
    // inside a `(...)` group, so reject rather than silently literalize them.
    if (BARE_META.has(c)) {
      throw new Error(`rou3: unsupported metacharacter "${c}" in "${seg}"`);
    }
    out += escapeLiteral(c);
    i += 1;
  }
  return out;
}

// Look-behind trailing-slash suffix `routeToRegExp` still emits for a few
// route endings (as `RegExp#source` spells it), and the two-slash form it
// emitted before #209.
const TRAILING_SLASH = "(?:(?<=\\/)\\/|(?<!\\/)\\/?)";
const LEGACY_TRAILING_SLASHES = "(?:\\/\\/|(?<!\\/)\\/?)";

const BARE_META = new Set([".", "^", "$", "*", "+", "?", "|", "[", "]", "{", "}", ")"]);

/** Reverse a `(?:...)?` optional unit into route syntax, appending to `segments`. */
function applyOptional(
  segments: string[],
  inner: string,
  last: boolean,
  lazy: boolean,
  dot: boolean,
): void {
  if (inner.startsWith("\\/")) {
    const rest = inner.slice(2);
    const g = matchNamedGroup(rest, 0);
    if (g && g.end === rest.length) {
      // A trailing greedy `(?:/(?<_>[\s\S]*))?` is the `**` catch-all. The
      // lazy form is a param named `_` (`:_*`), which the router leaves unset
      // on `/a/` where `**` reports `""`. (Only at the end: `**` is terminal,
      // so a mid-route `:_*` must stay as is.)
      if (last && !lazy && g.name === "_" && isCatchAll(g.body, dot)) {
        segments.push("**");
        return;
      }
      // A single whole-segment param -> `:name?` / `:name*` / `:name(pat)?|*`.
      segments.push(optionalParam(g.name, g.body, dot));
      return;
    }
    // Literal / mixed optional segments, possibly with optionals of their own
    // (`{/sub/**}?`) -> `{/...}?` merged onto the previous segment.
    mergeGroup(segments, `/${parseSegments(inner, last, dot).join("/")}`);
    return;
  }
  // In-segment optional -> `{...}?` merged onto the previous segment.
  mergeGroup(segments, reverseSegment(inner));
}

function mergeGroup(segments: string[], body: string): void {
  if (segments.length === 0) {
    throw new Error(`rou3: optional group "{${body}}?" has no preceding segment`);
  }
  segments[segments.length - 1] += `{${body}}?`;
}

/** Classify a param group inside a segment (`:name`, `*`, `(pat)`, ...). */
function paramToken(name: string, body: string): string {
  const unnamed = /^_\d+$/.test(name);
  // `*` (unnamed `[^/]*`) and `:name` (named `[^/]*`, or `[^/]+` as older
  // versions emitted) are the only single-segment matchers with dedicated syntax. Every other body becomes an inline `(pat)`
  // constraint, which `constraint()` rejects if it can't survive path splitting.
  if (unnamed && body === "[^/]*") {
    return "*";
  }
  if (!unnamed && (body === "[^/]*" || body === "[^/]+")) {
    return `:${name}`;
  }
  return unnamed ? constraint(body) : `:${name}${constraint(body)}`;
}

/** Classify a param inside an optional group (`:name?`, `:name*`, ...). */
function optionalParam(name: string, body: string, dot: boolean): string {
  // `(?:/(?<_N>[^/]*))?` is a trailing `*` (optional in the tree).
  if (/^_\d+$/.test(name) && body === "[^/]*") {
    return "*";
  }
  if (body === "[^/]*" || body === "[^/]+") {
    return `:${name}?`;
  }
  if (isCatchAll(body, dot)) {
    return `:${name}*`;
  }
  const rep = matchRepeat(body);
  if (rep) {
    return `:${name}${constraint(rep)}*`;
  }
  return `:${name}${constraint(body)}?`;
}

/** Detect `PAT(?:/PAT)*` (the `+`/`*` repeat form) and return `PAT`. */
function matchRepeat(body: string): string | undefined {
  const m = body.match(/^(.+)\(\?:\\\/(.+)\)\*$/);
  return m && m[1] === m[2] ? m[1] : undefined;
}

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
  return `(${body})`;
}

function escapeLiteral(ch: string): string {
  return ROUTE_SPECIAL.has(ch) ? `\\${ch}` : ch;
}

interface NamedGroup {
  name: string;
  body: string;
  end: number;
}

/**
 * Parse `(?<name>...)` at `start`, returning its name, body and end index. The
 * name is decoded back to its route form, so a param whose name is not a valid
 * capture-group name (`:test-id`, `:0`) round-trips instead of leaking the
 * escaped group name.
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
  return {
    name: fromGroupName(src.slice(start + 3, gt)),
    body: src.slice(gt + 1, end - 1),
    end,
  };
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
