export function routeToRegExp(route: string = "/"): RegExp {
  const reSegments = [];
  let idCtr = 0;
  for (const segment of route.split("/")) {
    if (!segment) continue;
    if (segment === "*") {
      reSegments.push(`(?<_${idCtr++}>[^/]*)`);
    } else if (segment.startsWith("**")) {
      reSegments.push(
        segment === "**" ? "?(?<_>.*)" : `?(?<${segment.slice(3)}>.+)`,
      );
    } else if (segment.includes(":") || /(^|[^\\])\(/.test(segment)) {
      const modMatch = segment.match(/^(.*:\w+(?:\([^)]*\))?)([?+*])$/);
      if (modMatch) {
        const [, base, mod] = modMatch;
        const name = base.match(/:(\w+)/)?.[1] || `_${idCtr++}`;
        if (mod === "?") {
          const inner = base
            .replace(
              /:(\w+)(?:\(([^)]*)\))?/g,
              (_, id, pattern) => `(?<${id}>${pattern || "[^/]+"})`,
            )
            .replace(/\./g, "\\.");
          reSegments.push(`?${inner}?`);
          continue;
        }
        // + or * (preserve inline constraint when present)
        const pattern = base.match(/:(\w+)(?:\(([^)]*)\))?/)?.[2];
        if (pattern) {
          const repeated = `${pattern}(?:/${pattern})*`;
          reSegments.push(
            mod === "+"
              ? `?(?<${name}>${repeated})`
              : `?(?<${name}>${repeated})?`,
          );
        } else {
          reSegments.push(mod === "+" ? `?(?<${name}>.+)` : `?(?<${name}>.*)`);
        }
        continue;
      }
      reSegments.push(
        segment
          .replace(
            /:(\w+)(?:\(([^)]*)\))?/g,
            (_, id, pattern) => `(?<${id}>${pattern || "[^/]+"})`,
          )
          .replace(/(^|[^\\])\((?![?<])/g, (_, p) => `${p}(?<_${idCtr++}>`)
          .replace(/\./g, "\\."),
      );
    } else {
      reSegments.push(segment);
    }
  }
  return new RegExp(`^/${reSegments.join("/")}/?$`);
}
