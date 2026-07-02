// Inverse of `routeToRegExp()`: parse an anchored, PCRE-compatible RegExp back
// into a rou3 route pattern. Targets the dialect emitted by `routeToRegExp()`
// (named groups `(?<name>...)`, `[^/]+`/`[^/]*` segment matchers, `.*`/`.+`
// catch-alls, `(?:/...)?` optional groups). Hand-written regexes that follow the
// same conventions convert too; constructs outside the dialect throw.

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
 * regExpToRoute(/^\/base\/?(?<path>.+)\/?$/); // "/base/**:path"
 */
export function regExpToRoute(regexp: RegExp | string): string {
  // Routes carry no flags, so a match-affecting flag (`i`/`m`/`s`) would be
  // silently dropped and change matching semantics. Reject rather than lie;
  // `g`/`y`/`u`/`v`/`d` don't affect a fully-anchored match and are ignored.
  if (typeof regexp !== "string" && /[ims]/.test(regexp.flags)) {
    throw new Error(`rou3: cannot represent regexp flag(s) "${regexp.flags}" as a route`);
  }

  let src = typeof regexp === "string" ? regexp : regexp.source;

  // Strip anchors and the trailing optional-slash `routeToRegExp` appends.
  if (src.startsWith("^")) src = src.slice(1);
  if (src.endsWith("$")) src = src.slice(0, -1);
  if (src.endsWith("\\/?")) src = src.slice(0, -3);

  if (src === "" || src === "\\/") {
    return "/";
  }

  const segments: string[] = [];
  const n = src.length;
  let i = 0;

  while (i < n) {
    // Optional group unit: `(?:...)?`.
    if (src.startsWith("(?:", i)) {
      const end = readGroup(src, i);
      if (src[end] !== "?") {
        throw new Error(`rou3: unsupported non-optional group in "${src}"`);
      }
      applyOptional(segments, src.slice(i + 3, end - 1));
      i = end + 1;
      continue;
    }

    // Catch-all unit: `/?(?<name>.*)` or `/?(?<name>.+)` at the end.
    if (src.startsWith("\\/?", i)) {
      const g = matchNamedGroup(src, i + 3);
      if (g && g.end === n && (g.body === ".*" || g.body === ".+")) {
        segments.push(g.name === "_" ? "**" : `**:${g.name}`);
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

  return "/" + segments.join("/");
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

const BARE_META = new Set([".", "^", "$", "*", "+", "?", "|", "[", "]", "{", "}", ")"]);

/** Reverse a `(?:...)?` optional unit into route syntax, appending to `segments`. */
function applyOptional(segments: string[], inner: string): void {
  if (inner.startsWith("\\/")) {
    const rest = inner.slice(2);
    const g = matchNamedGroup(rest, 0);
    if (g && g.end === rest.length) {
      // A single whole-segment param -> `:name?` / `:name*` / `:name(pat)?|*`.
      segments.push(optionalParam(g.name, g.body));
      return;
    }
    // Literal / mixed optional segment -> `{/...}?` merged onto the previous.
    mergeGroup(segments, `/${reverseSegment(rest)}`);
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
  // `*` (unnamed `[^/]*`) and `:name` (named `[^/]+`) are the only single-segment
  // matchers with dedicated syntax. Every other body becomes an inline `(pat)`
  // constraint, which `constraint()` rejects if it can't survive path splitting.
  if (unnamed && body === "[^/]*") {
    return "*";
  }
  if (!unnamed && body === "[^/]+") {
    return `:${name}`;
  }
  return unnamed ? constraint(body) : `:${name}${constraint(body)}`;
}

/** Classify a param inside an optional group (`:name?`, `:name*`, ...). */
function optionalParam(name: string, body: string): string {
  if (body === "[^/]+") {
    return `:${name}?`;
  }
  if (body === ".*") {
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

/** Parse `(?<name>...)` at `start`, returning its name, body and end index. */
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
  return { name: src.slice(start + 3, gt), body: src.slice(gt + 1, end - 1), end };
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
