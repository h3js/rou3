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
  return [
    path.slice(0, i),
    path.slice(i + 1, j),
    path.slice(j + (hasMod ? 2 : 1)),
    hasMod ? mod : undefined,
  ];
}

export function expandGroupDelimiters(path: string): string[] | undefined {
  if (!path.includes("{")) return;
  const group = scanFirstGroup(path);
  if (!group) {
    return;
  }

  const [pre, body, suf, mod] = group;

  if (!mod) {
    return [pre + body + suf];
  }

  if (mod === "?") {
    return [pre + body + suf, pre + suf];
  }

  if (body.includes("/")) {
    throw new Error("unsupported group repetition across segments");
  }

  return [`${pre}(?:${body})${mod}${suf}`];
}
