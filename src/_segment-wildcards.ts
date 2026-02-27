export const UNNAMED_GROUP_PREFIX = "__rou3_unnamed_";
const _unnamedGroupPrefixLength = UNNAMED_GROUP_PREFIX.length;

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
  toGroupKey: (index: number) => string = toUnnamedGroupKey,
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
      replaced += `(?<${toGroupKey(nextIndex++)}>[^/]*)`;
      continue;
    }

    replaced += segment[i];
  }

  return [replaced, nextIndex];
}

export function toUnnamedGroupKey(index: number): string {
  return `${UNNAMED_GROUP_PREFIX}${index}`;
}

export function normalizeUnnamedGroupKey(key: string): string {
  return key.startsWith(UNNAMED_GROUP_PREFIX)
    ? key.slice(_unnamedGroupPrefixLength)
    : key;
}
