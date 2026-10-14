import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  target: "node18",
  packages: "external",
  sourcemap: true,
  legalComments: "none",
  plugins: [commonJsCompatibilityPlugin()],
  define: {
    "import.meta.url": "__orchaImportMetaUrl",
  },
  banner: {
    js: '"use strict"; const __orchaImportMetaUrl = require("url").pathToFileURL(__filename).href;',
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
        return collectTypeScriptFiles(path);
      }
      if (directory === sourceDirectory && entry.name === "cli.ts") {
        return [];
      }
      return extname(entry.name) === ".ts" ? [path] : [];
    }),
  );
  return files.flat();
}

function commonJsCompatibilityPlugin() {
  return {
    name: "commonjs-compatibility",
    setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, async ({ path }) => ({
        contents: (await readFile(path, "utf8")).replace(
          /(["'])node:([^"'\\]+)\1/g,
          "$1$2$1",
        ),
        loader: "ts",
      }));
    },
  };
}
