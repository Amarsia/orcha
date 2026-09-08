import { build } from "esbuild";
import { orchaPlugin } from "orchajs/esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [resolve(projectRoot, "src/index.ts")],
  outfile: resolve(projectRoot, "dist/index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  minify: true,
  legalComments: "none",
  plugins: [orchaPlugin({ projectRoot })],
});

console.log("Built dist/index.js");
