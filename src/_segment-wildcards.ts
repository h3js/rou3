export function hasSegmentWildcard(segment: string): boolean {
  let depth = 0;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment.charCodeAt(i);
    if (ch === 92 /* \\ */) {
      i++;
      continue;
    }
    if (ch === 40 /* ( */) {
      depth++;
      continue;
    }
    if (ch === 41 /* ) */ && depth > 0) {
      depth--;
      continue;
    }
    if (ch === 42 /* * */ && depth === 0) {
      return true;
    }
  }

  return false;
}

export function replaceSegmentWildcards(
  segment: string,
  unnamedStart: number,
): [string, number] {
  let depth = 0;
  let nextIndex = unnamedStart;
  let replaced = "";

  for (let i = 0; i < segment.length; i++) {
    const ch = segment.charCodeAt(i);

    if (ch === 92 /* \\ */) {
      replaced += segment[i];
      if (i + 1 < segment.length) {
        replaced += segment[++i];
      }
      continue;
    }

    if (ch === 40 /* ( */) {
      depth++;
      replaced += segment[i];
      continue;
    }

    if (ch === 41 /* ) */ && depth > 0) {
      depth--;
      replaced += segment[i];
      continue;
    }

    if (ch === 42 /* * */ && depth === 0) {
      replaced += `(?<_${nextIndex++}>[^/]*)`;
      continue;
    }

    replaced += segment[i];
  }

  return [replaced, nextIndex];
}
