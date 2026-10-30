import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build as bundleEntry } from "esbuild";
import { compileRegistry } from "./compiler/compile.js";
import { loadProjectEnvironment } from "./env.js";
import { orcha } from "./orcha.js";
import {
  ensureCompiledMcpDependencies,
  ensureCompiledProviderDependencies,
} from "./providers/dependencies.js";
import { setRegistryCompiler } from "./runtime/compiler-hook.js";

export async function loadProject(projectRoot: string): Promise<void> {
  setRegistryCompiler((configuration, compilerProjectRoot) =>
    compileRegistry(
      configuration.agents,
      resolve(compilerProjectRoot, "orcha"),
      configuration.actions?.runtime ?? "native",
      "node",
    ),
  );
  loadProjectEnvironment(projectRoot);
  const registryPath = resolve(projectRoot, "orcha/index.ts");
  if (!existsSync(registryPath)) {
    throw new Error('Missing "orcha/index.ts". Run "orchajs init" first.');
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
      target: "node18",
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
        '"orcha/index.ts" must call orcha.init({ agents, ... }).',
      );
    }
    if (!orcha.isInferenceEnabled()) {
      await ensureCompiledProviderDependencies(
        orcha.getCompiledBundle(),
        projectRoot,
      );
    }
    await ensureCompiledMcpDependencies(
      orcha.getCompiledBundle(),
      projectRoot,
    );
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
