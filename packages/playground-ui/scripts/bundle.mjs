import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

await Promise.all([
  build({
    entryPoints: [
      fileURLToPath(new URL("../src/mount.tsx", import.meta.url)),
    ],
    outfile: fileURLToPath(
      new URL("../dist/playground.js", import.meta.url),
    ),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome110", "firefox110", "safari16"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  }),
  copyFile(
    new URL("../src/orcha-logo.svg", import.meta.url),
    new URL("../dist/orcha-logo.svg", import.meta.url),
  ),
]);
