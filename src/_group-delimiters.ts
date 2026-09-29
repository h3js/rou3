import { invalidSyntax } from "./operations/_utils.ts";

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

  return mod ? [pre + body + suf, pre + suf] : [pre + body + suf];
}
