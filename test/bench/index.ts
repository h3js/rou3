import { bench, group, summary, compact, run, do_not_optimize } from "mitata";
import { requests } from "./input.ts";
import { createInstances } from "./impl.ts";

const instances = createInstances();

const createCase = <T>(name: string, requests: T, fn: (requests: T) => any) =>
  bench(name, function* () {
    yield {
      [0]: () => requests,
      bench: fn,
    };
  });

group("dynamic routes", () => {
  summary(() => {
    compact(() => {
      const nonStaticRequests = requests.filter((r) => r.data.includes(":"));
      for (const [name, _find] of instances) {
        createCase(name, nonStaticRequests, (requests) => {
          for (let i = 0; i < requests.length; i++)
            do_not_optimize(_find(requests[i].method, requests[i].path));
        });
      }
    });
  });
});

group("all routes", () => {
  summary(() => {
    compact(() => {
      for (const [name, _find] of instances) {
        createCase(name, requests, (requests) => {
          for (let i = 0; i < requests.length; i++)
            do_not_optimize(_find(requests[i].method, requests[i].path));
        });
      }
    });
  });
});

if (process.argv.includes("--detailed")) {
  for (const request of requests) {
    group(`[${request.method}] ${request.path}`, () => {
      summary(() => {
        compact(() => {
          for (const [name, _find] of instances) {
            createCase(name, request, (request) => {
              _find(request.method, request.path);
            });
          }
        });
      });
    });
  }
}

await run();

console.log(`
Tips:
- Run with --detailed to see detailed results.
- Run with --max to compare with maximum possible performance.
`);
