import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "dist/playground/public");

await mkdir(outputDirectory, { recursive: true });
await copyFile(
  resolve(root, "src/playground-ui/orcha-logo.svg"),
  resolve(outputDirectory, "orcha-logo.svg"),
);
await build({
  entryPoints: [resolve(root, "src/playground-ui/index.tsx")],
  outfile: resolve(outputDirectory, "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome110", "firefox110", "safari16"],
  jsx: "automatic",
  jsxImportSource: "react",
  minify: true,
  sourcemap: true,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

await writeFile(
  resolve(outputDirectory, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <link rel="icon" href="/orcha-logo.svg" type="image/svg+xml" />
    <title>Orcha Playground</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`,
  "utf8",
);
