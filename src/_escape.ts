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
  return str.replace(/\uFFFE(.)/g, (_, c: string) => (/[.*+?^${}()|[\]\\]/.test(c) ? `\\${c}` : c));
}

// Escape literal `.` that sits outside any `(...)` group as `\.`, leaving group
// bodies (opaque user regex) and backslash/placeholder escapes untouched. Run
// after params are wrapped into named groups so a dot inside a constraint
// (`:id(\d+\.\d+)`, `:id([a-z.]+)`) is preserved verbatim instead of being
// blanket-escaped to `\\.` (a literal backslash + any-char).
export function escapeBareDots(str: string): string {
  let r = "",
    d = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 92 || c === 0xff_fe) {
      // Backslash escape or placeholder: next char is opaque, copy the pair.
      r += str[i] + (str[i + 1] || "");
      i++;
    } else if (c === 40) {
      d++;
      r += str[i];
    } else if (c === 41) {
      if (d > 0) d--;
      r += str[i];
    } else if (c === 46 && d === 0) {
      r += "\\.";
    } else {
      r += str[i];
    }
  }
  return r;
}
