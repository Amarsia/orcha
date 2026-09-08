import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as bundleEntry } from "esbuild";
import { orcha } from "../orcha.js";

export interface BuildProjectOptions {
  projectRoot?: string;
}

export async function buildProject(
  options: BuildProjectOptions = {},
): Promise<string> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const registryPath = resolve(projectRoot, "orcha/index.ts");
  if (!existsSync(registryPath)) {
    throw new Error('Missing "orcha/index.ts". Run "orcha init" first.');
  }

  const temporaryDirectory = resolve(projectRoot, ".orcha/.build");
  const registryBundlePath = resolve(temporaryDirectory, "registry.mjs");
  const productionEntryPath = resolve(
    temporaryDirectory,
    "production-entry.mjs",
  );
  const outputPath = resolve(projectRoot, ".orcha/dist/bundle.js");
  await mkdir(temporaryDirectory, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });

  try {
    await bundleEntry({
      entryPoints: [registryPath],
      outfile: registryBundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      packages: "external",
      logLevel: "silent",
    });

    const previousCompiling = process.env.ORCHA_COMPILING;
    process.env.ORCHA_COMPILING = "1";
    try {
      await import(
        `${pathToFileURL(registryBundlePath).href}?time=${Date.now()}`
      );
    } finally {
      if (previousCompiling === undefined) {
        delete process.env.ORCHA_COMPILING;
      } else {
        process.env.ORCHA_COMPILING = previousCompiling;
      }
    }
    const compiledBundle = orcha.getCompiledBundle();
    const runtimeFactoryPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../runtime/create-orcha.js",
    ).replaceAll("\\", "/");

    await writeFile(
      productionEntryPath,
      [
        `import { createOrcha } from ${JSON.stringify(runtimeFactoryPath)};`,
        `const compiledBundle = ${JSON.stringify(compiledBundle)};`,
        "export const orcha = createOrcha(() => compiledBundle);",
        "export default orcha;",
        "",
      ].join("\n"),
      "utf8",
    );
    await bundleEntry({
      entryPoints: [productionEntryPath],
      outfile: outputPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      minify: true,
      legalComments: "none",
      logLevel: "silent",
    });

    return outputPath;
  } finally {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });
  }
}
