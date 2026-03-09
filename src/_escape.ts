const _P = "\uFFFE";

export function replaceEscapesOutsideGroups(segment: string): string {
  let r = "",
    d = 0;
  for (let i = 0; i < segment.length; i++) {
    const c = segment.charCodeAt(i);
    if (c === 40) d++;
    else if (c === 41 && d > 0) d--;
    else if (c === 92 && d === 0 && i + 1 < segment.length) {
      const n = segment[i + 1];
      if (n !== ":" && n !== "(" && n !== "*" && n !== "\\") {
        r += _P + n;
        i++;
        continue;
      }
    }
    r += segment[i];
  }
  return r;
}

export function resolveEscapePlaceholders(str: string): string {
  return str.replace(/\uFFFE(.)/g, (_, c: string) =>
    /[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c,
  );
}
