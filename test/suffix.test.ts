import { describe, it, expect } from "vitest";
import {
  addRoute,
  compareRoutes,
  createRouter,
  findAllRoutes,
  findRoute,
  removeRoute,
  routeNodeKeys,
  type MatchedRoute,
  type RouterContext,
} from "../src/index.ts";
import { compileRouter, compileRouterToString } from "../src/compiler.ts";

// Routes with segments after `**` (`/**\/_payload.json`): the segments are
// matched from the end of the path, and on paths such a route matches every
// candidate is ranked from the last segment backwards (literal > regex param >
// param or `**`), ties in tree order.

/**
 * `findRoute` / `findAllRoutes`, asserting that compiled lookups (JIT and AOT,
 * single and matchAll) return exactly the same.
 */
function lookups(router: RouterContext<string>) {
  const jit = compileRouter(router);
  const jitAll = compileRouter(router, { matchAll: true });
  const aot = new Function(`return ${compileRouterToString(router)}`)();
  const aotAll = new Function(`return ${compileRouterToString(router, "", { matchAll: true })}`)();
  return {
    find(path: string, method = "GET"): MatchedRoute<string> | undefined {
      const match = findRoute(router, method, path);
      const expected = match && { data: match.data, params: match.params };
      expect(jit(method, path), `compiled ${method} ${path}`).toEqual(expected);
      expect(aot(method, path), `compiled (AOT) ${method} ${path}`).toEqual(expected);
      return expected;
    },
    all(path: string, method = "GET"): MatchedRoute<string>[] {
      const matches = findAllRoutes(router, method, path);
      expect(jitAll(method, path), `compiled matchAll ${method} ${path}`).toEqual(matches);
      expect(aotAll(method, path), `compiled matchAll (AOT) ${method} ${path}`).toEqual(matches);
      return matches;
    },
  };
}

function routerOf(routes: string[]): RouterContext<string> {
  const router = createRouter<string>();
  for (const route of routes) addRoute(router, "", route, route);
  return router;
}

/** Winner and (least -> most specific) findAllRoutes order, in both registration orders. */
function resolve(routes: string[], path: string): [string | undefined, string[]] {
  const results = [routes, [...routes].reverse()].map((order) => {
    const { find, all } = lookups(routerOf(order));
    return [find(path)?.data, all(path).map((m) => m.data)] as [string | undefined, string[]];
  });
  expect(results[1], `registration order of ${routes.join(", ")} @ ${path}`).toEqual(results[0]);
  return results[0];
}

describe("segments after `**`", () => {
  it("match from the end of the path", () => {
    const { find } = lookups(routerOf(["/**/_payload.json"]));
    expect(find("/_payload.json")).toEqual({ data: "/**/_payload.json", params: { _: "" } });
    expect(find("/a/_payload.json")?.params).toEqual({ _: "a" });
    expect(find("/a/b/_payload.json")?.params).toEqual({ _: "a/b" });
    // One trailing slash is ignored (#209), a second is an empty last segment
    expect(find("/a/b/_payload.json/")?.params).toEqual({ _: "a/b" });
    expect(find("/a/b/_payload.json//")).toBeUndefined();
    // Empty segments are part of the `**`
    expect(find("/a//_payload.json")?.params).toEqual({ _: "a/" });
    expect(find("//_payload.json")?.params).toEqual({ _: "" });
    for (const path of ["/", "/a", "/_payload.jsonx", "/x_payload.json", "/a/_payload.json/b"]) {
      expect(find(path), path).toBeUndefined();
    }
  });

  it("capture params around the `**`", () => {
    const { find } = lookups(
      routerOf([
        "/**:path/_payload.json",
        "/**/*.png",
        "/:lang(en|fr)/**/og/:file",
        "/img/**/:name.:ext(webp|avif)",
      ]),
    );
    // `**:name` takes one segment or more
    expect(find("/_payload.json")).toBeUndefined();
    expect(find("/a/_payload.json")?.params).toEqual({ path: "a" });
    expect(find("/a/b/_payload.json")?.params).toEqual({ path: "a/b" });
    expect(find("/a/b/x.png")?.params).toEqual({ _: "a/b", 0: "x" });
    expect(find("/x.png")?.params).toEqual({ _: "", 0: "x" });
    expect(find("/fr/a/og/b")?.params).toEqual({ lang: "fr", _: "a", file: "b" });
    expect(find("/de/a/og/b")).toBeUndefined();
    expect(find("/img/a/b/c.webp")?.params).toEqual({ _: "a/b", name: "c", ext: "webp" });
    expect(find("/img/c.gif")).toBeUndefined();
  });

  it("take the segment for a `*` after `**` (not optional there)", () => {
    const { find } = lookups(routerOf(["/a/**/*"]));
    expect(find("/a")).toBeUndefined();
    expect(find("/a/x")?.params).toEqual({ _: "", 0: "x" });
    expect(find("/a/x/y")?.params).toEqual({ _: "x", 0: "y" });
  });

  it("make `:name+` / `:name*` before the last segment keep the segments after it", () => {
    const { find } = lookups(routerOf(["/a/:x+/b", "/c/:y*/d"]));
    expect(find("/a/b")).toBeUndefined();
    expect(find("/a/1/b")?.params).toEqual({ x: "1" });
    expect(find("/a/1/2/b")?.params).toEqual({ x: "1/2" });
    expect(find("/a/1/2")).toBeUndefined();
    expect(find("/c/d")).toEqual({ data: "/c/:y*/d", params: undefined });
    expect(find("/c/1/2/d")?.params).toEqual({ y: "1/2" });
  });

  it("`**<rest>` is `**/*<rest>` (`/**.md`: any path ending in a `.md` segment)", () => {
    const router = routerOf(["/**.md", "/blog/**.json"]);
    const { find, all } = lookups(router);
    expect(find("/readme.md")).toEqual({ data: "/**.md", params: { _: "", 0: "readme" } });
    expect(find("/docs/guide/intro.md")?.params).toEqual({ _: "docs/guide", 0: "intro" });
    expect(find("/docs/intro.md/")?.params).toEqual({ _: "docs", 0: "intro" });
    expect(find("/blog/a/post.json")?.params).toEqual({ _: "a", 0: "post" });
    expect(find("/blog/post.json")?.params).toEqual({ _: "", 0: "post" });
    for (const path of ["/", "/a", "/a.mdx", "/a.md/b", "/post.json"]) {
      expect(find(path), path).toBeUndefined();
    }
    expect(all("/blog/a.json.md").map((m) => m.data)).toEqual(["/**.md"]);
    // Same node and registration identity as the spelled-out form
    expect(routeNodeKeys("/**.md")).toEqual(["/**/*"]);
    expect(routeNodeKeys("/blog/**.json")).toEqual(routeNodeKeys("/blog/**/*.json"));
    expect(compareRoutes("/**.md", "/**/*.md")).toBe("equal");
    removeRoute(router, "", "/**/*.md");
    expect(lookups(router).find("/readme.md")).toBeUndefined();
    // `***` is two `**`
    expect(() => addRoute(createRouter(), "", "/***")).toThrow(/only one `\*\*`/);
  });

  it("allow one `**` per route", () => {
    for (const route of ["/**/**", "/a/**/b/**:x", "/a/:x+/b/:y+", "/**/a/:x*"]) {
      expect(() => addRoute(createRouter(), "", route), route).toThrow(
        /^rou3: a route can have only one `\*\*`/,
      );
    }
  });

  it('resolve method-scoped entries like other nodes (`methods[m] || methods[""]`)', () => {
    const router = createRouter<string>();
    addRoute(router, "", "/**", "any");
    addRoute(router, "GET", "/**/_payload.json", "get");
    addRoute(router, "", "/**/og.png", "og-any");
    addRoute(router, "POST", "/**/og.png", "og-post");
    const { find, all } = lookups(router);
    expect(find("/a/_payload.json")?.data).toBe("get");
    expect(find("/a/_payload.json", "POST")?.data).toBe("any");
    expect(find("/a/og.png", "POST")?.data).toBe("og-post");
    expect(find("/a/og.png", "GET")?.data).toBe("og-any");
    expect(all("/a/og.png", "POST").map((m) => m.data)).toEqual(["any", "og-post"]);
  });

  it("resolve ties like same-node siblings: findRoute takes the first registered", () => {
    const router = createRouter<string>();
    addRoute(router, "", "/**/x", "first");
    addRoute(router, "", "/**/x", "second");
    addRoute(router, "", "/**:p/x", "named");
    const { find, all } = lookups(router);
    expect(find("/x")?.data).toBe("first");
    // `**:p` must take a segment, and outweighs `**` where it does
    expect(find("/a/x")?.data).toBe("named");
    expect(all("/a/x").map((m) => m.data)).toEqual(["first", "second", "named"]);
  });

  it("are removed by registered pattern", () => {
    const router = routerOf(["/**", "/**/_payload.json", "/blog/**:p/_payload.json"]);
    removeRoute(router, "", "/**/_payload.json");
    expect(lookups(router).find("/a/_payload.json")?.data).toBe("/**");
    expect(lookups(router).find("/blog/a/_payload.json")?.data).toBe("/blog/**:p/_payload.json");
    removeRoute(router, "", "/blog/**:p/_payload.json");
    expect(lookups(router).find("/blog/a/_payload.json")?.data).toBe("/**");
    expect(router.root.wildcard?.suffix).toBeUndefined();
    expect(router.root.static).toBeUndefined();
  });
});

describe("segments after `**`: priority", () => {
  const P = "/blog/post/_payload.json";

  it.each([
    // [routes, path, winner, findAllRoutes order]
    [["/**", "/**/_payload.json"], P, ["/**", "/**/_payload.json"]],
    [["/blog/**", "/blog/**/_payload.json"], P, ["/blog/**", "/blog/**/_payload.json"]],
    [
      ["/**", "/blog/**", "/blog/**/_payload.json"],
      P,
      ["/**", "/blog/**", "/blog/**/_payload.json"],
    ],
    // A catch-all diverging earlier (`/blog/**`) does not hide the suffix route
    [["/blog/**", "/**/_payload.json"], P, ["/blog/**", "/**/_payload.json"]],
    [
      ["/blog/:slug", "/**/_payload.json"],
      "/blog/_payload.json",
      ["/blog/:slug", "/**/_payload.json"],
    ],
    // ... but a route pinning the same end and more still wins
    [
      ["/blog/:slug/_payload.json", "/**/_payload.json"],
      P,
      ["/**/_payload.json", "/blog/:slug/_payload.json"],
    ],
    [["/blog/post/_payload.json", "/**/_payload.json"], P, ["/**/_payload.json", P]],
    [
      ["/**/*.png", "/**/__og_image__/og.png", "/blog/**"],
      "/blog/a/__og_image__/og.png",
      ["/blog/**", "/**/*.png", "/**/__og_image__/og.png"],
    ],
    // Narrower wins even when the broader one diverges earlier
    [["/a/:p/**", "/a/**/x"], "/a/q/x", ["/a/:p/**", "/a/**/x"]],
    [["/:a/**/p", "/**/b/p"], "/b/p", ["/:a/**/p", "/**/b/p"]],
    // Paths no suffix route matches keep the tree order
    [["/api/**", "/**", "/**/_payload.json"], "/api/users", ["/**", "/api/**"]],
    [
      ["/blog/:slug", "/:lang/_payload.json"],
      "/blog/_payload.json",
      ["/:lang/_payload.json", "/blog/:slug"],
    ],
  ] as [string[], string, string[]][])("%j @ %s", (routes, path, order) => {
    expect(resolve(routes, path)).toEqual([order.at(-1), order]);
  });

  it("ranks every candidate from the end once a suffix route matches", () => {
    // Without `/**/_payload.json`, `/blog/:slug` wins here by the tree order;
    // with it, `/:lang/_payload.json` pins the last segment and wins.
    expect(
      resolve(["/blog/:slug", "/:lang/_payload.json", "/**/_payload.json"], "/blog/_payload.json"),
    ).toEqual([
      "/:lang/_payload.json",
      ["/blog/:slug", "/**/_payload.json", "/:lang/_payload.json"],
    ]);
  });

  it("never picks a strictly broader route (sweep)", () => {
    // Every pair and triple of the corpus, on every path up to 4 segments:
    // `findRoute` must not return a route whose match set strictly contains
    // another matching route's, `findAllRoutes` must list broader routes
    // first, and `findRoute` is its last result. Match sets are read off
    // single-route routers over the same paths.
    const corpus = [
      // catch-alls
      "/**",
      "/b/**",
      "/:a/**",
      "/b/:s/**",
      // fixed
      "/b",
      "/b/:s",
      "/:a",
      "/:a/:c",
      "/b/p",
      "/:a/p",
      "/b/:s/p",
      "/:a/:c/p",
      "/b/:s(\\d+)",
      // segments after `**`
      "/**/p",
      "/b/**/p",
      "/:a/**/p",
      "/**/:y/p",
      "/**/b/p",
      "/**/:y",
      "/b/**/:y",
      "/**:n/p",
      "/**/1/p",
      "/**/:n(\\d+)",
      "/**/*.p",
    ];
    const alphabet = ["b", "p", "1", "q.p"];
    const paths = ["/"];
    for (let depth = 1, prev = [""]; depth <= 4; depth++) {
      prev = prev.flatMap((path) => alphabet.map((segment) => `${path}/${segment}`));
      paths.push(...prev);
    }
    const matchSets = new Map(
      corpus.map((route) => {
        const router = routerOf([route]);
        return [route, new Set(paths.filter((path) => findRoute(router, "", path)))];
      }),
    );
    const broader = (a: string, b: string) => {
      const [setA, setB] = [matchSets.get(a)!, matchSets.get(b)!];
      return setA.size > setB.size && [...setB].every((path) => setA.has(path));
    };

    const failures: string[] = [];
    let checks = 0;
    for (let i = 0; i < corpus.length; i++) {
      for (let j = 0; j < corpus.length; j++) {
        if (i === j) continue;
        const sets = [[corpus[i], corpus[j]]];
        for (let k = j + 1; k < corpus.length; k++) {
          if (k !== i) sets.push([corpus[i], corpus[j], corpus[k]]);
        }
        // Sets without a suffix route resolve in tree order, as before
        for (const routes of sets.filter((set) => set.some((r) => /\*\*[^/]*\/./.test(r)))) {
          const router = routerOf(routes);
          for (const path of paths) {
            const found = findRoute(router, "", path)?.data;
            if (found === undefined) continue;
            checks++;
            const all = findAllRoutes(router, "", path).map((m) => m.data);
            const at = `[${routes.join(", ")}] @ ${path}`;
            if (all.at(-1) !== found) failures.push(`findRoute is not last: ${at}`);
            for (const other of all) {
              if (broader(found, other)) failures.push(`${found} over ${other}: ${at}`);
            }
            for (let x = 0; x < all.length; x++) {
              for (let y = x + 1; y < all.length; y++) {
                if (broader(all[y], all[x])) failures.push(`${all[x]} before ${all[y]}: ${at}`);
              }
            }
          }
        }
      }
    }
    expect(checks).toBeGreaterThan(100_000);
    expect(failures.slice(0, 20)).toEqual([]);
  }, 30_000);

  it("compiled lookups agree on the whole corpus", () => {
    const router = routerOf([
      "/**",
      "/b/**",
      "/:a/**",
      "/b/:s",
      "/:a/:c",
      "/b/p",
      "/b/:s(\\d+)",
      "/**/p",
      "/b/**/p",
      "/:a/**/p",
      "/**/:y/p",
      "/**/b/p",
      "/b/**/:y",
      "/**:n/p",
      "/**/:n(\\d+)",
      "/**/*.p",
    ]);
    const { find, all } = lookups(router);
    for (const path of ["/", "/b", "/b/p", "/x/b/p", "/b/1", "/q/1", "/a/q.p", "/b/x/y/p/"]) {
      find(path);
      all(path);
    }
  });

  it("agrees with compareRoutes on the scenarios above", () => {
    expect(compareRoutes("/a/:p/**", "/a/**/x")).toBe("superset");
    expect(compareRoutes("/:a/**/p", "/**/b/p")).toBe("superset");
    expect(compareRoutes("/**/_payload.json", "/blog/:slug/_payload.json")).toBe("superset");
    expect(compareRoutes("/blog/**", "/**/_payload.json")).toBe("partial");
  });
});
