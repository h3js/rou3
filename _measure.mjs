import { build } from "esbuild"; import zlib from "node:zlib"; import fs from "node:fs";
const dir = process.argv[2], out = process.argv[3];
const res = await build({ bundle: true, metafile: true, write: false, minify: true, format: "esm", platform: "node", outfile: "index.mjs",
  stdin: { contents: `import { createRouter, addRoute, findRoute, findAllRoutes } from "./src/index.ts"; createRouter(); addRoute(); findRoute(); findAllRoutes();`, resolveDir: dir, sourcefile: "index.mjs", loader: "js" } });
const t = res.outputFiles[0].text; fs.writeFileSync(out, t);
console.log(res.metafile.outputs["index.mjs"].bytes, zlib.gzipSync(t).byteLength);
