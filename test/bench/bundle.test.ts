import { describe, it, expect } from "vitest";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

describe("benchmark", () => {
  it("bundle size", async () => {
    const code = /* js */ `
      import { createRouter, addRoute, findRoute, findAllRoutes } from "../../src";
      createRouter();
      addRoute();
      findRoute();
      findAllRoutes();
    `;
    const { bytes, gzipSize } = await getBundleSize(code);
    console.log("bundle size", { bytes, gzipSize });
    // Budget bumped from 5.9kb/2.26kb (+~270B/+~115B): findAllRoutes now orders
    // same-node siblings by specificity so it agrees with compiled matchAll
    // regardless of insertion order (#187). Previous bump was for #184.
    // regExpToRoute() is tree-shakeable, so it does not affect this budget.
    // +~15B: getParamRegexp() now escapes only literal dots *outside* (...) groups
    // so a `.` inside a regex constraint (`:id(\d+\.\d+)`) stays verbatim instead
    // of being double-escaped; gzip is unchanged (2383).
    // -~40B raw / +~50B gzip: findRoute's end-of-path optional fallback now
    // scans all same-node siblings (not just the first-inserted entry) via a
    // shared helper with a zero-allocation single-sibling fast path —
    // deduplication shrinks raw size, but the filter loop adds tokens the old
    // duplicated blocks gzipped away.
    // -~4B raw / +~6B gzip: findRoute's regex-param filter is now a single
    // closure-free pass (~1.4x faster than the old double `.find`) and
    // splitPath no longer rest-copies the split array — the unique loop
    // tokens gzip worse than the old repeated `.find` closures.
    expect(bytes).toBeLessThanOrEqual(6180); // <6.18kb
    expect(gzipSize).toBeLessThanOrEqual(2445); // <2.45kb
  });
});

async function getBundleSize(code: string) {
  const res = await build({
    bundle: true,
    metafile: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "node",
    outfile: "index.mjs",
    stdin: {
      contents: code,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      sourcefile: "index.mjs",
      loader: "js",
    },
  });
  const { bytes } = res.metafile.outputs["index.mjs"];
  const gzipSize = zlib.gzipSync(res.outputFiles[0].text).byteLength;
  return { bytes, gzipSize };
}
