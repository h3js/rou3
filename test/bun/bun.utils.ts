import { spawn } from "node:child_process";
import { afterAll } from "vitest";

const bunProc = spawn("bun", ["--bun", require.resolve("./bun.server.mjs")], {
  stdio: "pipe",
  env: {
    ...process.env,
    BUN_TEST_PORT: "7070",
  },
});

export function testBunRoutes(spec: {
  routes: string[];
  tests: string[];
}): Promise<Record<string, { route: string; params: Record<string, string> }>> {
  return fetch(`http://localhost:7070`, {
    method: "POST",
    body: JSON.stringify(spec),
  }).then((res) => res.json());
}

afterAll(() => {
  bunProc.kill();
});
