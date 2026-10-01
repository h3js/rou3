import { absolutePattern, invalidSyntax, MISPLACED_MODIFIER } from "./operations/_utils.ts";

/** `[pre, body, suf, mod]` split of a `{...}` group, or `undefined`. */
export type GroupDelimiter = [pre: string, body: string, suf: string, mod: string | undefined];

/**
 * Locate the first top-level `{...}` group delimiter (skipping `\` escapes and
 * capturing-group parens) and split into `[pre, body, suf, mod]`. Returns
 * `undefined` when there is no top-level group.
 *
 * Shared by {@link expandGroupDelimiters} (tree add/remove/expansion) and
 * `routeToRegExp()`'s inline-optional compiler so both classify groups
 * identically. Returns a tuple (not an object) to stay tiny in the core bundle.
 */
export function scanFirstGroup(path: string): GroupDelimiter | undefined {
  let i = 0;
  let depth = 0;
  for (; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 92 /* \ */) i++;
    else if (c === 40 /* ( */) depth++;
    else if (c === 41 /* ) */ && depth > 0) depth--;
    else if (c === 123 /* { */ && depth === 0) break;
  }
  if (i >= path.length) return;

  let j = i + 1;
  depth = 0;
  for (; j < path.length; j++) {
    const c = path.charCodeAt(j);
    if (c === 92 /* \ */) j++;
    else if (c === 40 /* ( */) depth++;
    else if (c === 41 /* ) */ && depth > 0) depth--;
    else if (c === 125 /* } */ && depth === 0) break;
  }
  if (j >= path.length) return;

  const mod = path[j + 1];
  const hasMod = mod === "?" || mod === "+" || mod === "*";
  // A `{` / `}` ends a param name, as in URLPattern: the char after one is
  // escaped where it could extend a name once expanded (`/:a{b}?` is `/:a\b`
  // or `/:a`). A `\x` there is always a literal `x` (`body` and `suf` start
  // outside any constraint), so this is a no-op after anything else.
  return [
    path.slice(0, i),
    path.slice(i + 1, j).replace(NAME_CHAR, "\\$&"),
    path.slice(j + (hasMod ? 2 : 1)).replace(NAME_CHAR, "\\$&"),
    hasMod ? mod : undefined,
  ];
}

// A char that would extend a `:name` (a `$` or non-ASCII one there throws)
const NAME_CHAR = /^[\w$\x80-￼]/;

/**
 * Expand the first `{...}` / `{...}?` group of `path` into the routes it
 * stands for. `{...}+` / `{...}*` repetition is not supported: `input` (quoted
 * in the error) is rejected.
 *
 * A pattern starting with a group gets no `/` in front (see `addRoute`): each
 * expansion is read on its own. One starting with `/` is absolute, as in
 * URLPattern (`{/:a}?/b` is `/:a/b` or `/b`); any other one, the empty one
 * too, is relative and gets a `/` like a pattern (`{a}?/b` is `/a/b` or `/b`,
 * `{/:a}?` is `/:a` or `/`). One starting with `{` is left to the next group.
 * Text right after a leading `{/…}?` (`{/a}?b`, `{/:a}?.png`, `{/a}?{b}?/c`)
 * throws: without the group the route would be relative, a form URLPattern
 * gives no meaning (it matches only `/ab`), so a `/b` would be a guess.
 */
export function expandGroupDelimiters(path: string, input: string = path): string[] | undefined {
  if (!path.includes("{")) return;
  const group = scanFirstGroup(path);
  if (!group) {
    return;
  }

  const [pre, body, suf, mod] = group;

  if (mod === "+" || mod === "*") {
    invalidSyntax(`unsupported \`{}${mod}\``, input);
  }

  // An optional lone param after text, ending its segment (`*-{:x}?`,
  // `pre{:x(\d+)}?`), is `:x?` there, as in URLPattern: `getParamRegexp`
  // compiles it in place after a capture, `expandModifiers` expands it after
  // text. One that starts its segment (`/{:x}?`) is a group, and so is one
  // in a `**` segment, which has no text (`/a/**{:x}?` is `/a/**:x` or
  // `/a/**`; an escaped `\**` is text). (A name char starting `suf` is
  // escaped, so it can't end the name.)
  if (
    mod === "?" &&
    /^(?!\*\*)./.test(pre.slice(pre.lastIndexOf("/") + 1)) &&
    /^:[A-Za-z_]\w*(\([^)]*\))?$/.test(body) &&
    (!suf || suf[0] === "/")
  ) {
    // Alone: the caller expands (and numbers, `skipGroup`) the next group
    return [pre + body + "?" + suf];
  }

  const full = joinGroup(joinGroup(pre, body, input), suf, input);
  const expanded = mod ? [full, joinGroup(pre, suf, input)] : [full];
  if (pre) return expanded;
  // After a leading `{/…}?`: `/`, another `{/…}` group or nothing
  if (mod && body.charCodeAt(0) === 47 /* '/' */ && suf && !/^\{?\//.test(suf)) {
    invalidSyntax("text after a leading `{/...}?`", input);
  }
  return expanded.map(absolutePattern);
}

/**
 * `a` + `b`, two parts of a route a `{` / `}` stood between. A `{` / `}` ends
 * a param name (see {@link scanFirstGroup}), so where `a` ends in a bare
 * `:name` and `b` starts with a regex group, the group is an unnamed capture
 * next to the param, as in URLPattern, not its constraint: the param gets the
 * lazy constraint a `:name` sharing its segment has anyway (`[^/]+?`, spelled
 * without a `/`, which would split the segment). A `?` / `+` / `*` there, or
 * after a constraint, group or `*`, would be a modifier on it (`/*{*}` a
 * `**`), which it is not in URLPattern: `input` (quoted in the error) is
 * rejected.
 */
export function joinGroup(a: string, b: string, input?: string): string {
  // `a` ends in a `:name` (not a `**:name`, which ends its segment anyway; an
  // invalid name throws later), a group of its segment (a stray `)` is a
  // literal) or a `*`, none escaped, and `b` starts with a `(`, `?`, `+` or
  // `*` (an empty `b` appends `"undefined"`, which ends in none of them)
  const m = /(?<!\\)(\\\\)*((?<!\*\*):\w+|\([^/]*[^\\]\)|\*)([(?+*])$/.exec(a + b[0]);
  if (m) {
    // `m[3]` is no `(` (`?`, `+` and `*` sort after it)
    if (m[3] > "(") invalidSyntax(MISPLACED_MODIFIER, input!);
    // Only a `:name` starts with a char after `*` (`(` and `*` don't)
    if (m[2] > "*") a += "([^\\x2f]+?)";
  }
  return a + b;
}
