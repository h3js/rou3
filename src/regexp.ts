export function routeToRegExp(route: string = "/"): RegExp {
  const reSegments = [];
  for (const segment of route.split("/")) {
    if (!segment) continue;
    if (segment === "*") {
      reSegments.push("[^/]*");
    } else if (segment === "**") {
      reSegments.push("?(?<_>.*)");
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
