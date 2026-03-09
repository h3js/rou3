import { expandGroupDelimiters } from "./_group-delimiters.ts";
import { replaceEscapesOutsideGroups, resolveEscapePlaceholders } from "./_escape.ts";
import { hasSegmentWildcard, replaceSegmentWildcards } from "./_segment-wildcards.ts";

export function routeToRegExp(route: string = "/"): RegExp {
  const groupExpanded = expandGroupDelimiters(route);
  if (groupExpanded) {
    const sources = groupExpanded.map((expandedRoute) =>
      routeToRegExp(expandedRoute).source.slice(1, -1),
    );
    // Note: alternation branches may contain duplicate named capture groups
    // (e.g. `(?<id>a)|(?<id>b)`). This is valid in modern engines (Node 22+,
    // Chrome 125+, Firefox 129+, Safari 17+) per TC39 proposal.
    return new RegExp(`^(?:${sources.join("|")})$`);
  }

  return _routeToRegExp(route);
}

function _routeToRegExp(route: string): RegExp {
  const reSegments = [];
  let idCtr = 0;

  for (const segment of route.split("/")) {
    if (!segment) continue;

    if (segment === "*") {
      reSegments.push(`(?<${toRegExpUnnamedKey(idCtr++)}>[^/]*)`);
    } else if (segment.startsWith("**")) {
      reSegments.push(segment === "**" ? "?(?<_>.*)" : `?(?<${segment.slice(3)}>.+)`);
    } else if (
      segment.includes(":") ||
      /(^|[^\\])\(/.test(segment) ||
      hasSegmentWildcard(segment)
    ) {
      const modMatch = segment.match(/^(.*:[\w-]+(?:\([^)]*\))?)([?+*])$/);
      if (modMatch) {
        const [, base, mod] = modMatch;
        const name = base.match(/:([\w-]+)/)?.[1] || `_${idCtr++}`;

        if (mod === "?") {
          const inner = base
            .replace(
              /:([\w-]+)(?:\(([^)]*)\))?/g,
              (_, id, pattern) => `(?<${id}>${pattern || "[^/]+"})`,
            )
            .replace(/\./g, "\\.");
          if (reSegments.length > 0) {
            // Append optional group to previous segment: /foo(?:/<inner>)?
            const prevQ: string = reSegments.pop()!;
            reSegments.push(`${prevQ}(?:/${inner})?`);
          } else {
            reSegments.push(`?${inner}?`);
          }
          continue;
        }

        // + or * (preserve inline constraint when present)
        const pattern = base.match(/:(\w+)(?:\(([^)]*)\))?/)?.[2];
        if (reSegments.length > 0) {
          const prevMod: string = reSegments.pop()!;
          if (pattern) {
            const repeated = `${pattern}(?:/${pattern})*`;
            reSegments.push(
              mod === "+"
                ? `${prevMod}/(?<${name}>${repeated})`
                : `${prevMod}(?:/(?<${name}>${repeated}))?`,
            );
          } else {
            reSegments.push(
              mod === "+" ? `${prevMod}/(?<${name}>.+)` : `${prevMod}(?:/(?<${name}>.*))?`,
            );
          }
        } else {
          if (pattern) {
            const repeated = `${pattern}(?:/${pattern})*`;
            reSegments.push(mod === "+" ? `?(?<${name}>${repeated})` : `?(?<${name}>${repeated})?`);
          } else {
            reSegments.push(mod === "+" ? `?(?<${name}>.+)` : `?(?<${name}>.*)`);
          }
        }

        continue;
      }

      // Strip URLPattern backslash escapes before regex processing
      let dynamicSegment = replaceEscapesOutsideGroups(segment);
      [dynamicSegment, idCtr] = replaceSegmentWildcards(dynamicSegment, idCtr, toRegExpUnnamedKey);

      reSegments.push(
        resolveEscapePlaceholders(
          dynamicSegment
            .replace(
              /:([\w-]+)(?:\(([^)]*)\))?/g,
              (_, id, pattern) => `(?<${id}>${pattern || "[^/]+"})`,
            )
            .replace(/(^|[^\\])\((?![?<])/g, (_, p) => `${p}(?<${toRegExpUnnamedKey(idCtr++)}>`)
            .replace(/\./g, "\\."),
        ),
      );
    } else {
      reSegments.push(segment.replace(/\\(.)/g, "$1").replace(/[.*+?^${}()|[\]]/g, "\\$&"));
    }
  }

  return new RegExp(`^/${reSegments.join("/")}/?$`);
}

function toRegExpUnnamedKey(index: number): string {
  return `_${index}`;
}
