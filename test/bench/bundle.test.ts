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
    // +~46B raw / +~59B gzip: addRoute is ~2x faster — encodeEscapes,
    // expandGroupDelimiters, expandModifiers and decodeEscaped bail out early
    // when the path lacks their trigger char (`\`, `{`, `?+*` suffix,
    // `\uFFFD`), and the five chained escape replaces collapsed into one
    // callback pass (shrinks raw, but the repetitive chain gzipped better).
    // +~125B raw / +~52B gzip: findRoute now selects same-node siblings by the
    // shared specificity-weight model (regex count + required-last on dynamic
    // terminals, ties first-registered) so single-match agrees with compiled
    // and findAllRoutes; a failed regex falls through instead of aborting,
    // and out-of-bounds segments no longer coerce to a literal "undefined"
    // static key. Includes a single-sibling fast path that keeps lookup speed
    // at parity.
    // +~210B raw / +~95B gzip: param names accept `[\w-]+` but a capture group
    // name must be an identifier, so `_group-names.ts` encodes the ones that
    // aren't (`-`, leading digit) into a reserved injective form and decodes
    // them back when groups are read — `:file-name.json` / `:id(\d+)` with such
    // a name used to throw `SyntaxError: Invalid capture group name` at addRoute.
    expect(bytes).toBeLessThanOrEqual(6580); // <6.58kb
    expect(gzipSize).toBeLessThanOrEqual(2670); // <2.67kb
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
