/**
 * Where the `*`s of a route segment are: unescaped, outside a `(...)` group
 * (escapes encoded, see `encodeEscapes`; a `\*` is a literal).
 */
export function segmentWildcards(segment: string): number[] {
  const at: number[] = [];
  let depth = 0;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment.charCodeAt(i);
    if (ch === 92 /* \\ */) {
      i++;
    } else if (ch === 40 /* ( */) {
      depth++;
    } else if (ch === 41 /* ) */ && depth > 0) {
      depth--;
    } else if (ch === 42 /* * */ && depth === 0) {
      at.push(i);
    }
  }
  return at;
}
