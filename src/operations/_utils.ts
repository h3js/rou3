import type { MatchedRoute, ParamsIndexMap } from "../types";

export function splitPath(path: string) {
  return path.split("/").filter(Boolean);
}

export function getMatchParams(
  segments: string[],
  paramsMap: ParamsIndexMap,
): MatchedRoute["params"] {
  const params = Object.create(null);
  for (const [index, name] of paramsMap) {
    const segment =
      index < 0 ? segments.slice(-1 * index).join("/") : segments[index];
    if (typeof name === "string") {
      params[name] = segment;
    } else {
      const match = segment.match(name);
      if (match) {
        for (const key in match.groups) {
          params[key] = match.groups[key];
        }
      }
    }
  }
  return params;
}
