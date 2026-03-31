import { bench, group, summary, compact, run, do_not_optimize } from "mitata";
import * as rou3 from "../../src/index.ts";
import * as rou3C from "../../src/compiler.ts";
import {
  ecommerceRoutes,
  ecommerceRequests,
  githubLikeRoutes,
  githubLikeRequests,
  overlappingRoutes,
  overlappingRequests,
  generateScaleRoutes,
} from "./realistic-input.ts";
import type { Route, Request } from "./realistic-input.ts";

const isFull = process.argv.includes("--full");

// --- Helpers ---

function buildRouter(routes: Route[]) {
  const router = rou3.createRouter();
  for (const r of routes) {
    rou3.addRoute(router, r.method, r.path, `[${r.method || "*"}] ${r.path}`);
  }
  return router;
}

const createCase = <T>(name: string, data: T, fn: (data: T) => any) =>
  bench(name, function* () {
    yield {
      [0]: () => data,
      bench: fn,
    };
  });

// --- Pre-build routers ---

const ecommerceRouter = buildRouter(ecommerceRoutes);
const ecommerceCompiled = rou3C.compileRouter(ecommerceRouter);

const githubRouter = buildRouter(githubLikeRoutes);
const githubCompiled = rou3C.compileRouter(githubRouter);

const scale50 = generateScaleRoutes(50);
const scale200 = generateScaleRoutes(200);
const scale500 = generateScaleRoutes(500);

const router50 = buildRouter(scale50.routes);
const router200 = buildRouter(scale200.routes);
const router500 = buildRouter(scale500.routes);

const compiled50 = rou3C.compileRouter(router50);
const compiled200 = rou3C.compileRouter(router200);
const compiled500 = rou3C.compileRouter(router500);

// --- 1. Realistic API workloads: interpreter vs compiled ---

group("ecommerce API (108 routes)", () => {
  summary(() => {
    compact(() => {
      createCase("interpreter", ecommerceRequests, (reqs) => {
        for (const r of reqs) do_not_optimize(rou3.findRoute(ecommerceRouter, r.method, r.path));
      });
      createCase("compiled", ecommerceRequests, (reqs) => {
        for (const r of reqs) do_not_optimize(ecommerceCompiled(r.method, r.path));
      });
    });
  });
});

group("github API (119 routes)", () => {
  summary(() => {
    compact(() => {
      createCase("interpreter", githubLikeRequests, (reqs) => {
        for (const r of reqs) do_not_optimize(rou3.findRoute(githubRouter, r.method, r.path));
      });
      createCase("compiled", githubLikeRequests, (reqs) => {
        for (const r of reqs) do_not_optimize(githubCompiled(r.method, r.path));
      });
    });
  });
});

// --- 2. Route type breakdown ---

group("route type (compiled, 108 routes)", () => {
  const staticReqs = ecommerceRequests.filter((r) => r.description.startsWith("static"));
  const paramReqs = ecommerceRequests.filter(
    (r) => r.description.startsWith("param") || r.description.startsWith("multi-param"),
  );
  const wildcardReqs = ecommerceRequests.filter((r) => r.description.startsWith("wildcard"));
  const missReqs = ecommerceRequests.filter((r) => r.description.startsWith("miss"));

  summary(() => {
    compact(() => {
      createCase("static", staticReqs, (reqs) => {
        for (const r of reqs) do_not_optimize(ecommerceCompiled(r.method, r.path));
      });
      createCase("param", paramReqs, (reqs) => {
        for (const r of reqs) do_not_optimize(ecommerceCompiled(r.method, r.path));
      });
      createCase("wildcard", wildcardReqs, (reqs) => {
        for (const r of reqs) do_not_optimize(ecommerceCompiled(r.method, r.path));
      });
      createCase("miss", missReqs, (reqs) => {
        for (const r of reqs) do_not_optimize(ecommerceCompiled(r.method, r.path));
      });
    });
  });
});

// --- 3. Scaling: findRoute with growing route tables ---

group("scaling: compiled lookup", () => {
  summary(() => {
    compact(() => {
      createCase("50 routes", scale50.requests, (reqs) => {
        for (const r of reqs) do_not_optimize(compiled50(r.method, r.path));
      });
      createCase("200 routes", scale200.requests, (reqs) => {
        for (const r of reqs) do_not_optimize(compiled200(r.method, r.path));
      });
      createCase("500 routes", scale500.requests, (reqs) => {
        for (const r of reqs) do_not_optimize(compiled500(r.method, r.path));
      });
    });
  });
});

// --- 4. Build & compile time ---

group("addRoute + compileRouter", () => {
  summary(() => {
    compact(() => {
      bench("addRoute x108", () => {
        const r = rou3.createRouter();
        for (const rt of ecommerceRoutes) rou3.addRoute(r, rt.method, rt.path, rt.path);
        do_not_optimize(r);
      });
      bench("addRoute x200", () => {
        const r = rou3.createRouter();
        for (const rt of scale200.routes) rou3.addRoute(r, rt.method, rt.path, rt.path);
        do_not_optimize(r);
      });
      bench("compile x108", () => {
        do_not_optimize(rou3C.compileRouter(ecommerceRouter));
      });
      bench("compile x200", () => {
        do_not_optimize(rou3C.compileRouter(router200));
      });
    });
  });
});

// --- 5. findAllRoutes ---

const overlapRouter = buildRouter(overlappingRoutes);
const overlapCompiled = rou3C.compileRouter(overlapRouter, { matchAll: true });

group("findAllRoutes (overlapping)", () => {
  summary(() => {
    compact(() => {
      createCase("interpreter", overlappingRequests, (reqs) => {
        for (const r of reqs) do_not_optimize(rou3.findAllRoutes(overlapRouter, r.method, r.path));
      });
      createCase("compiled (matchAll)", overlappingRequests, (reqs) => {
        for (const r of reqs) do_not_optimize(overlapCompiled(r.method, r.path));
      });
    });
  });
});

// --- Full mode: extra detail groups ---

if (isFull) {
  group("scaling: interpreter lookup", () => {
    summary(() => {
      compact(() => {
        createCase("50 routes", scale50.requests, (reqs) => {
          for (const r of reqs) do_not_optimize(rou3.findRoute(router50, r.method, r.path));
        });
        createCase("200 routes", scale200.requests, (reqs) => {
          for (const r of reqs) do_not_optimize(rou3.findRoute(router200, r.method, r.path));
        });
        createCase("500 routes", scale500.requests, (reqs) => {
          for (const r of reqs) do_not_optimize(rou3.findRoute(router500, r.method, r.path));
        });
      });
    });
  });

  group("removeRoute", () => {
    summary(() => {
      compact(() => {
        createCase("50 routes", scale50.routes, (routes) => {
          const router = rou3.createRouter();
          for (const r of routes) rou3.addRoute(router, r.method, r.path, r.path);
          for (const r of routes) do_not_optimize(rou3.removeRoute(router, r.method, r.path));
        });
        createCase("200 routes", scale200.routes, (routes) => {
          const router = rou3.createRouter();
          for (const r of routes) rou3.addRoute(router, r.method, r.path, r.path);
          for (const r of routes) do_not_optimize(rou3.removeRoute(router, r.method, r.path));
        });
      });
    });
  });

  group("single lookup latency", () => {
    summary(() => {
      compact(() => {
        bench("static (compiled)", () => {
          do_not_optimize(ecommerceCompiled("GET", "/health"));
        });
        bench("1-param (compiled)", () => {
          do_not_optimize(ecommerceCompiled("GET", "/products/prod_99xyz"));
        });
        bench("2-param (compiled)", () => {
          do_not_optimize(ecommerceCompiled("PUT", "/users/usr_42abc/addresses/addr_1"));
        });
        bench("wildcard (compiled)", () => {
          do_not_optimize(ecommerceCompiled("GET", "/docs/api/v2/reference"));
        });
        bench("miss (compiled)", () => {
          do_not_optimize(ecommerceCompiled("GET", "/nonexistent"));
        });
      });
    });
  });

  group("github deep params (compiled)", () => {
    summary(() => {
      compact(() => {
        bench("2-param: repo", () => {
          do_not_optimize(githubCompiled("GET", "/repos/facebook/react"));
        });
        bench("3-param+static: PR files", () => {
          do_not_optimize(githubCompiled("GET", "/repos/vercel/next.js/pulls/5678/files"));
        });
        bench("deep: CI run jobs", () => {
          do_not_optimize(githubCompiled("GET", "/repos/denoland/deno/actions/runs/12345/jobs"));
        });
        bench("4-param: remove label", () => {
          do_not_optimize(githubCompiled("DELETE", "/repos/facebook/react/issues/1234/labels/bug"));
        });
      });
    });
  });
}

await run();

// --- Memory usage report ---
if (typeof globalThis.gc === "function") {
  console.log("\n--- Memory Usage ---");
  globalThis.gc();
  const baseline = process.memoryUsage();

  const memRouter50 = buildRouter(scale50.routes);
  globalThis.gc();
  const after50 = process.memoryUsage();

  const memRouter200 = buildRouter(scale200.routes);
  globalThis.gc();
  const after200 = process.memoryUsage();

  const memRouter500 = buildRouter(scale500.routes);
  globalThis.gc();
  const after500 = process.memoryUsage();

  // Prevent GC from collecting routers before measurement
  do_not_optimize(memRouter50);
  do_not_optimize(memRouter200);
  do_not_optimize(memRouter500);

  const fmt = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  console.log(`  50 routes:  ~${fmt(after50.heapUsed - baseline.heapUsed)}`);
  console.log(`  200 routes: ~${fmt(after200.heapUsed - after50.heapUsed)}`);
  console.log(`  500 routes: ~${fmt(after500.heapUsed - after200.heapUsed)}`);
  console.log(`  Total heap: ${fmt(after500.heapUsed)}`);
} else {
  console.log("\nTip: Run with --expose-gc to see memory usage report.");
}

console.log(`
Tips:
- Run with --full to include extra detail groups (single lookup latency, removeRoute, scaling interpreter, deep params).
`);
