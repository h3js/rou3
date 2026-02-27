export function expandGroupDelimiters(path: string): string[] | undefined {
  let i = 0;
  let depth = 0;

  for (; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c === 92 /* \\ */) {
      i++;
      continue;
    }
    if (c === 40 /* ( */) {
      depth++;
      continue;
    }
    if (c === 41 /* ) */ && depth > 0) {
      depth--;
      continue;
    }
    if (c === 123 /* { */ && depth === 0) {
      break;
    }
  }

  if (i >= path.length) {
    return;
  }

  let j = i + 1;
  depth = 0;

  for (; j < path.length; j++) {
    const c = path.charCodeAt(j);
    if (c === 92 /* \\ */) {
      j++;
      continue;
    }
    if (c === 40 /* ( */) {
      depth++;
      continue;
    }
    if (c === 41 /* ) */ && depth > 0) {
      depth--;
      continue;
    }
    if (c === 125 /* } */ && depth === 0) {
      break;
    }
  }

  if (j >= path.length) {
    return;
  }

  const mod = path[j + 1];
  const hasMod = mod === "?" || mod === "+" || mod === "*";
  const pre = path.slice(0, i);
  const body = path.slice(i + 1, j);
  const suf = path.slice(j + (hasMod ? 2 : 1));

  if (!hasMod) {
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
