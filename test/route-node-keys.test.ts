import { describe, it, expect } from "vitest";
import { createRouter, addRoute, findRoute, findAllRoutes, routeNodeKeys } from "../src/index.ts";
import { compileRouter } from "../src/compiler.ts";
import type { Node } from "../src/types.ts";
import { formatTree } from "./_utils.ts";

describe("routeNodeKeys", () => {
  describe("node identity rules", () => {
    const cases: [pattern: string, keys: string[]][] = [
      // Root.
      ["/", ["/"]],
      ["", ["/"]],

      // Static edges.
      ["/a", ["/a"]],
      ["/a/b", ["/a/b"]],

      // Param edge (`node.param`, key `*`): name and constraint live in the
      // *entry*, not the node, so every one of these is the same node.
      ["/users/:id", ["/users/*"]],
      ["/users/*", ["/users/*"]],
      ["/users/:id(\\d+)", ["/users/*"]],
      ["/users/(\\d+)", ["/users/*"]],
      ["/users/*.png", ["/users/*"]],
      ["/users/pre-:id-suf", ["/users/*"]],
      ["/users/file-*-*.png", ["/users/*"]],

      // Wildcard edge (`node.wildcard`, key `**`).
      ["/admin/**", ["/admin/**"]],
      ["/admin/**:rest", ["/admin/**"]],
      ["/admin/:x+", ["/admin/**"]],
      // `**` is terminal: the add loop breaks at the first one.
      ["/admin/**/anything", ["/admin/**"]],

      // Escaped literals are static keys, never markers.
      ["/a/\\*", ["/a/\\*"]],
      ["/a/*", ["/a/*"]],
      ["/a/\\*\\*", ["/a/\\*\\*"]],
      ["/a/**", ["/a/**"]],
      // Route-syntax punctuation stays escaped in the key.
      ["/a/b\\:c", ["/a/b\\:c"]],
      ["/a/b\\(c\\)", ["/a/b\\(c\\)"]],
      ["/a/b\\{c\\}", ["/a/b\\{c\\}"]],

      // Trailing empty segments are all popped at registration (#193)...
      ["/a/", ["/a"]],
      ["/a//", ["/a"]],
      // ...but a *middle* empty segment is a real static `""` key.
      ["/a//b", ["/a//b"]],
    ];

    it.each(cases)("%j -> %j", (pattern, keys) => {
      expect(routeNodeKeys(pattern)).toEqual(keys);
    });
  });

  describe("multi-expansion patterns", () => {
    const cases: [pattern: string, keys: string[]][] = [
      ["/a/:x?", ["/a", "/a/*"]],
      ["/a/:x*", ["/a", "/a/**"]],
      ["/a/:x+", ["/a/**"]],
      ["/book{s}?", ["/books", "/book"]],
      ["/x{/a}?{/b}?", ["/x", "/x/a", "/x/a/b", "/x/b"]],
      // 4 registrations (`/a/:x/:y`, `/a/:x`, `/a/:y`, `/a`) onto 3 nodes.
      ["/a/:x?/:y?", ["/a", "/a/*", "/a/*/*"]],
    ];

    it.each(cases)("%j -> %j", (pattern, keys) => {
      expect(routeNodeKeys(pattern)).toEqual(keys);
    });

    it("returns a fresh array the caller may mutate", () => {
      const first = routeNodeKeys("/a/:x?");
      first.push("/mutated");
      expect(routeNodeKeys("/a/:x?")).toEqual(["/a", "/a/*"]);
    });
  });

  describe("property sweep", () => {
    // The honesty test: key-set intersection must be *exactly* radix-node
    // sharing, in both directions. A drifting key model shows up here.
    const corpus = buildCorpus();

    it("keysIntersect(a, b) === sharesNode(a, b) for every ordered pair", () => {
      const keys = new Map(corpus.map((p) => [p, new Set(routeNodeKeys(p))]));
      const mismatches: string[] = [];
      let pairs = 0;
      for (const a of corpus) {
        const ka = keys.get(a)!;
        for (const b of corpus) {
          pairs++;
          let intersects = false;
          for (const k of keys.get(b)!) {
            if (ka.has(k)) {
              intersects = true;
              break;
            }
          }
          if (intersects !== sharesNode(a, b)) mismatches.push(`${a} vs ${b}: keys=${intersects}`);
        }
      }
      expect(pairs).toBe(corpus.length * corpus.length);
      expect(mismatches).toEqual([]);
    });
  });

  describe("security property", () => {
    it("deletes a method-agnostic gate when the nodes collide", () => {
      // The upstream bug: two textually distinct keys, one radix node, so the
      // method-scoped entry wins `methods[method] || methods[""]` outright.
      const ctx = createRouter<{ path: string }>();
      addRoute(ctx, "", "/users/*", { path: "gate" });
      addRoute(ctx, "GET", "/users/:id", { path: "handler" });
      expect(formatTree(ctx.root)).toMatchInlineSnapshot(`
        "<root>
            ├── /users
            │       ├── /* ┈> [*] gate, [GET] handler"
      `);
      expect(findAllRoutes(ctx, "GET", "/users/42").map((r) => r.data.path)).toEqual(["handler"]);
      // ...and routeNodeKeys is what makes that predictable up-front.
      expect(routeNodeKeys("/users/*")).toEqual(routeNodeKeys("/users/:id"));
    });

    it("a method-agnostic route is never shadowed by a disjoint-key route", () => {
      // For every pair whose keys do NOT intersect, adding B under `GET` must
      // not remove A from the `GET` results of any path A matches — in the
      // interpreter *and* in compiled matchAll. A false negative in the key
      // model surfaces here as a silently dropped `""` entry.
      const corpus = buildCorpus();
      const keys = new Map(corpus.map((p) => [p, new Set(routeNodeKeys(p))]));
      const shadowed: string[] = [];
      let pairs = 0;
      let checks = 0;
      for (const a of corpus) {
        const ka = keys.get(a)!;
        const solo = createRouter<string>();
        addRoute(solo, "", a, "A");
        // Paths this route answers on its own, with no competitor registered.
        const covered = PATHS.filter((p) =>
          findAllRoutes(solo, "GET", p).some((r) => r.data === "A"),
        );
        if (covered.length === 0) continue;
        for (const b of corpus) {
          if (a === b) continue;
          let intersects = false;
          for (const k of keys.get(b)!) {
            if (ka.has(k)) {
              intersects = true;
              break;
            }
          }
          if (intersects) continue;
          pairs++;
          const both = createRouter<string>();
          addRoute(both, "", a, "A");
          addRoute(both, "GET", b, "B");
          const matchAll = compileRouter(both, { matchAll: true });
          for (const path of covered) {
            checks++;
            if (!findAllRoutes(both, "GET", path).some((r) => r.data === "A")) {
              shadowed.push(`interpreter: ${a} shadowed by ${b} @ ${path}`);
            }
            if (!matchAll("GET", path).some((r) => r.data === "A")) {
              shadowed.push(`compiled: ${a} shadowed by ${b} @ ${path}`);
            }
          }
        }
      }
      expect(pairs).toBeGreaterThan(10_000);
      expect(checks).toBeGreaterThan(10_000);
      expect(shadowed).toEqual([]);
    });
  });

  describe("idempotence", () => {
    it("every key is a route pattern whose only node key is itself", () => {
      const failures: string[] = [];
      for (const pattern of buildCorpus()) {
        for (const key of routeNodeKeys(pattern)) {
          const round = routeNodeKeys(key);
          if (round.length !== 1 || round[0] !== key) {
            failures.push(`${pattern} -> ${key} -> ${JSON.stringify(round)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  });

  describe("encoding injectivity", () => {
    // Brute-force the reachable static-key space over an adversarial alphabet:
    // the encoded key must never collide with another key or with a `*` / `**`
    // marker, and must re-register as the same node.
    it("distinct nodes never share an encoded key", () => {
      const alphabet = ["a", "\\", "*", ":", "(", ")", "{", "}", "."];
      const segments = [""];
      for (let start = 0, len = 1; len <= 3; len++) {
        const end = segments.length;
        for (let i = start; i < end; i++) {
          for (const c of alphabet) segments.push(segments[i] + c);
        }
        start = end;
      }

      const byNode = new Map<string, string>(); // node identity -> encoded key
      const byKey = new Map<string, string>(); // encoded key -> node identity
      const collisions: string[] = [];
      const reachable = new Set<string>();
      for (const segment of segments) {
        // Skip anything addRoute rejects or that expands to several nodes —
        // this test is about the static-key encoding, not modifier expansion.
        const node = classifySegment(segment);
        if (node === undefined) continue;
        const encoded = encodeVia(segment, node);
        if (encoded === undefined) continue;
        if (node.charCodeAt(0) === 115 /* s(tatic) */) reachable.add(node);
        const seenKey = byNode.get(node);
        if (seenKey === undefined) byNode.set(node, encoded);
        else if (seenKey !== encoded) collisions.push(`${node} -> ${seenKey} and ${encoded}`);
        const seenNode = byKey.get(encoded);
        if (seenNode === undefined) byKey.set(encoded, node);
        else if (seenNode !== node) collisions.push(`${encoded} <- ${seenNode} and ${node}`);
      }

      expect(collisions).toEqual([]);
      expect(reachable.size).toBeGreaterThan(200);
      // The dynamic markers are reserved: no static key ever encodes to them.
      expect(byKey.get("*")).toBe("param");
      expect(byKey.get("**")).toBe("wildcard");
    });
  });

  describe("non-goals", () => {
    it("equal keys do NOT imply equal (or even overlapping) match-sets", () => {
      // The key erases regex constraints, so these share a node while matching
      // disjoint paths. This is deliberate: node identity is syntactic,
      // match-set containment is semantic (that is `compareRoutes`'s job).
      expect(routeNodeKeys("/u/:id(\\d+)")).toEqual(["/u/*"]);
      expect(routeNodeKeys("/u/:slug([a-z]+)")).toEqual(["/u/*"]);

      const ctx = createRouter<string>();
      addRoute(ctx, "GET", "/u/:id(\\d+)", "num");
      addRoute(ctx, "GET", "/u/:slug([a-z]+)", "slug");
      expect(findRoute(ctx, "GET", "/u/42")?.data).toBe("num");
      expect(findRoute(ctx, "GET", "/u/abc")?.data).toBe("slug");
    });

    it("widens `**:name` to `**`, so named and bare catch-alls share a key", () => {
      expect(routeNodeKeys("/admin/**:rest")).toEqual(routeNodeKeys("/admin/**"));
    });
  });

  describe("error parity", () => {
    it("throws exactly what addRoute throws", () => {
      const viaAdd = captureError(() => addRoute(createRouter(), "", "/a/{x}+"));
      const viaKeys = captureError(() => routeNodeKeys("/a/{x}+"));
      expect(viaAdd).toBeTruthy();
      expect(viaKeys).toBe(viaAdd);
      expect(() => routeNodeKeys("/a/{x}+")).toThrow();
    });

    it("does not memoize a throwing pattern", () => {
      expect(() => routeNodeKeys("/a/{/b}+")).toThrow();
      expect(() => routeNodeKeys("/a/{/b}+")).toThrow();
    });
  });
});

const SEGMENTS = ["a", "b", ":x", "*", ":x(\\d+)", "\\*"];
const TAILS = ["", "/**", "/*"];
const EXTRA_PATTERNS = [
  "/",
  "/a/:x?",
  "/a/:x*",
  "/a/:x+",
  "/a/**:rest",
  "/a/b/**:rest",
  "/book{s}?",
  "/x{/a}?{/b}?",
  "/a//b",
  "/a/b\\:c",
  "/a/*.png",
  "/a/pre-:id-suf",
  "/a/\\*\\*",
  "/:x/:y",
  "/a/:x/:y?",
];

const PATHS = [
  "/",
  "/a",
  "/a/",
  "/a/b",
  "/a/b/c",
  "/a/b/c/d",
  "/a/42",
  "/a/x.png",
  "/a/pre-1-suf",
  "/a//b",
  "/42",
  "/*",
  "/b/a",
  "/b/42/c",
  "/books",
  "/x/a/b",
];

/** Segment alphabet at depth <= 2, each with each tail, plus hand-picked extras. */
function buildCorpus(): string[] {
  const corpus: string[] = [];
  for (const s1 of SEGMENTS) {
    for (const tail of TAILS) corpus.push("/" + s1 + tail);
    for (const s2 of SEGMENTS) {
      for (const tail of TAILS) corpus.push("/" + s1 + "/" + s2 + tail);
    }
  }
  return corpus.concat(EXTRA_PATTERNS);
}

/**
 * Ground truth for the sweep: register both patterns in one router under
 * distinct data references and report whether any node's `methods[""]` array
 * holds entries for both (i.e. they share a bucket).
 */
function sharesNode(a: string, b: string): boolean {
  const ctx = createRouter<symbol>();
  const dataA = Symbol("a");
  const dataB = Symbol("b");
  addRoute(ctx, "", a, dataA);
  addRoute(ctx, "", b, dataB);
  const stack: Node<symbol>[] = [ctx.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const entries = node.methods?.[""];
    if (entries) {
      let hasA = false;
      let hasB = false;
      for (const entry of entries) {
        if (entry.data === dataA) hasA = true;
        else if (entry.data === dataB) hasB = true;
      }
      if (hasA && hasB) return true;
    }
    if (node.static) {
      for (const key in node.static) stack.push(node.static[key]);
    }
    if (node.param) stack.push(node.param);
    if (node.wildcard) stack.push(node.wildcard);
  }
  return false;
}

/**
 * Node identity of `segment` when registered as the middle segment of a route,
 * read straight off the tree. `undefined` when `addRoute` rejects the segment
 * or when it expands to more than one child (modifiers) — those are covered by
 * the multi-expansion block instead.
 */
function classifySegment(segment: string): string | undefined {
  const ctx = createRouter();
  try {
    addRoute(ctx, "", "/x/" + segment + "/y");
  } catch {
    return undefined;
  }
  const mid = ctx.root.static?.["x"];
  if (!mid) return undefined;
  const staticKeys = Object.keys(mid.static || {});
  const children = staticKeys.length + (mid.param ? 1 : 0) + (mid.wildcard ? 1 : 0);
  if (children !== 1) return undefined;
  if (mid.wildcard) return "wildcard";
  if (mid.param) return "param";
  return "static:" + staticKeys[0];
}

/** The encoded form `routeNodeKeys` gives that segment inside a `/x/…/y` frame. */
function encodeVia(segment: string, node: string): string | undefined {
  const keys = routeNodeKeys("/x/" + segment + "/y");
  if (keys.length !== 1) return undefined;
  const key = keys[0];
  // A wildcard node is terminal, so the `/y` frame is not part of its key.
  if (node === "wildcard") return key === "/x/**" ? "**" : undefined;
  return key.startsWith("/x/") && key.endsWith("/y") ? key.slice(3, -2) : undefined;
}

function captureError(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
}
