import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build as bundleEntry } from "esbuild";
import { loadProjectEnvironment } from "./env.js";
import { orcha } from "./orcha.js";

export async function loadProject(projectRoot: string): Promise<void> {
  loadProjectEnvironment(projectRoot);
  const registryPath = resolve(projectRoot, "orcha/index.ts");
  if (!existsSync(registryPath)) {
    throw new Error('Missing "orcha/index.ts". Run "orcha init" first.');
  }
  const temporaryDirectory = resolve(projectRoot, ".orcha/.cli");
  const bundlePath = resolve(
    temporaryDirectory,
    `registry-${process.pid}-${Date.now()}.mjs`,
  );
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    const previousBundle = orcha.isInitialized()
      ? orcha.getCompiledBundle()
      : undefined;
    await bundleEntry({
      entryPoints: [registryPath],
      outfile: bundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      packages: "external",
      logLevel: "silent",
    });
    const previousRoot = process.env.ORCHA_PROJECT_ROOT;
    const previousCompiling = process.env.ORCHA_COMPILING;
    process.env.ORCHA_PROJECT_ROOT = projectRoot;
    process.env.ORCHA_COMPILING = "1";
    try {
      await import(
        `${pathToFileURL(bundlePath).href}?time=${Date.now()}`
      );
    } finally {
      restoreEnvironment("ORCHA_PROJECT_ROOT", previousRoot);
      restoreEnvironment("ORCHA_COMPILING", previousCompiling);
    }
    if (
      !orcha.isInitialized() ||
      orcha.getCompiledBundle() === previousBundle
    ) {
      throw new Error(
        '"orcha/index.ts" must call orcha.init({ providers, agents }).',
      );
    }
  } finally {
    await rm(bundlePath, { force: true });
  }
}

function restoreEnvironment(
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
