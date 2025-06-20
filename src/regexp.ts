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
    } else if (segment.includes(":")) {
      reSegments.push(
        segment
          .replace(/:(\w+)/g, (_, id) => `(?<${id}>[^/]+)`)
          .replace(/\./g, "\\."),
      );
    } else {
      reSegments.push(segment);
    }
  }
  return new RegExp(`^/${reSegments.join("/")}/?$`);
}
