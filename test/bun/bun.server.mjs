Bun.serve({
  port: process.env.BUN_TEST_PORT,
  reusePort: false,
  async fetch(request) {
    const { routes, tests } = await request.json();

    const testServer = Bun.serve({
      port: 0,
      routes: Object.fromEntries(
        routes.map((route) => [
          route,
          (req) => Response.json({ route, params: req.params }),
        ]),
      ),
      fetch: () => Response.json({}),
    });

    const results = Object.fromEntries(
      await Promise.all(
        tests.map(async (path) =>
          fetch(`${testServer.url}${path}`)
            .then((r) => r.json())
            .then((match) => [path, match]),
        ),
      ),
    );

    await testServer.stop(true);
    return Response.json(results);
  },
});
