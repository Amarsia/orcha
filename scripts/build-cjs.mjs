import { readdir, rm, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(root, "src");
const outputDirectory = resolve(root, "dist-cjs");

await rm(outputDirectory, { recursive: true, force: true });

const entryPoints = await collectTypeScriptFiles(sourceDirectory);
await build({
  entryPoints,
  outbase: sourceDirectory,
  outdir: outputDirectory,
  bundle: false,
  format: "cjs",
  platform: "node",
  target: "node20",
  packages: "external",
  sourcemap: true,
  legalComments: "none",
  define: {
    "import.meta.url": "__orchaImportMetaUrl",
  },
  banner: {
    js: '"use strict"; const __orchaImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
});

await writeFile(
  resolve(outputDirectory, "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "playground-ui"
          ? []
          : collectTypeScriptFiles(path);
      }
      if (directory === sourceDirectory && entry.name === "cli.ts") {
        return [];
      }
      return extname(entry.name) === ".ts" ? [path] : [];
    }),
  );
  return files.flat();
}
