import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as bundleEntry } from "esbuild";
import { loadProjectEnvironment } from "../env.js";
import { orcha } from "../orcha.js";
import {
  setRegistryCompilationActive,
  setRegistryCompiler,
} from "../runtime/compiler-hook.js";
import { compileRegistry } from "./compile.js";
import {
  builtInProviderCatalog,
  isBuiltInProvider,
} from "../providers/catalog.js";
import {
  ensureCompiledMcpDependencies,
  ensureProviderDependencies,
} from "../providers/dependencies.js";
import type {
  CompiledAgentManifest,
  CompiledBundle,
} from "../types.js";

export interface BuildProjectOptions {
  projectRoot?: string;
  target?: "node" | "browser" | "react-native";
}

let registryImportSequence = 0;

export async function buildProject(
  options: BuildProjectOptions = {},
): Promise<string> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  loadProjectEnvironment(projectRoot);
  const target = options.target ?? "node";
  setRegistryCompiler((configuration, compilerProjectRoot) =>
    compileRegistry(
      configuration.agents,
      resolve(compilerProjectRoot, "orcha"),
      configuration.actions?.runtime ?? "native",
      target,
    ),
  );
  const registryPath = resolve(projectRoot, "orcha/index.ts");
  if (!existsSync(registryPath)) {
    throw new Error('Missing "orcha/index.ts". Run "orchajs init" first.');
  }

  const temporaryDirectory = resolve(projectRoot, ".orcha/.build");
  const registryBundlePath = resolve(temporaryDirectory, "registry.mjs");
  const productionEntryPath = resolve(
    temporaryDirectory,
    "production-entry.mjs",
  );
  const outputPath = resolve(
    projectRoot,
    `.orcha/dist/${bundleFileName(target)}`,
  );
  const manifestPath = resolve(
    projectRoot,
    ".orcha/dist/manifest.json",
  );
  if (orcha.isInitialized()) {
    throw new Error(
      "Cannot compile an Orcha project while the shared development runtime is initialized. Await orcha.close() first.",
    );
  }
  await mkdir(temporaryDirectory, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });
  let compilationRuntimeCreated = false;

  try {
    await bundleEntry({
      entryPoints: [registryPath],
      outfile: registryBundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node18",
      packages: "external",
      logLevel: "silent",
    });

    const previousCompiling = process.env.ORCHA_COMPILING;
    const previousProjectRoot = process.env.ORCHA_PROJECT_ROOT;
    process.env.ORCHA_COMPILING = "1";
    process.env.ORCHA_PROJECT_ROOT = projectRoot;
    setRegistryCompilationActive(true);
    try {
      await import(
        `${pathToFileURL(registryBundlePath).href}?build=${Date.now()}-${registryImportSequence++}`
      );
    } finally {
      compilationRuntimeCreated = orcha.isInitialized();
      setRegistryCompilationActive(false);
      if (previousCompiling === undefined) {
        delete process.env.ORCHA_COMPILING;
      } else {
        process.env.ORCHA_COMPILING = previousCompiling;
      }
      if (previousProjectRoot === undefined) {
        delete process.env.ORCHA_PROJECT_ROOT;
      } else {
        process.env.ORCHA_PROJECT_ROOT = previousProjectRoot;
      }
    }
    const compiledBundle = orcha.getCompiledBundle();
    const inferenceEnabled = orcha.isInferenceEnabled();
    const cloudStorageEnabled = orcha.isCloudStorageEnabled();
    await orcha.close();
    compilationRuntimeCreated = false;
    if (
      target !== "node" &&
      compiledBundle.actionRuntime === "sandbox"
    ) {
      throw new Error(
        `The ${target} target supports precompiled native actions only. Set actions.runtime to "native".`,
      );
    }
    const runtimeFactoryPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../runtime/create-orcha.js",
    ).replaceAll("\\", "/");
    const runtimePlatformPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      `../runtime/platform-${target}.js`,
    ).replaceAll("\\", "/");
    const runtimeEntryPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../runtime-entry.js",
    ).replaceAll("\\", "/");
    const providerDispatcherPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../providers/dispatcher.js",
    ).replaceAll("\\", "/");
    const sandboxRuntimeSource =
      compiledBundle.actionRuntime === "sandbox"
        ? createSandboxRuntimeSource()
        : "";
    const platformActionRuntimeSource =
      createPlatformActionRuntimeSource(target);
    const nodeStorageExports =
      target === "node" ? createNodeStorageExports() : "";
    const includedProviders = inferenceEnabled
      ? []
      : [
          ...new Set(
            allCompiledAgents(compiledBundle.agents).flatMap(
              (agent) => [
                agent.provider,
                ...Object.values(agent.evaluations ?? {})
                  .filter((evaluation) => evaluation.enabled !== false)
                  .map((evaluation) => evaluation.provider),
              ],
            ),
          ),
        ];
    const providerRuntimeSource =
      createProviderRuntimeSource(includedProviders, target);
    if (!inferenceEnabled) {
      await ensureProviderDependencies(includedProviders, projectRoot);
    }
    const hasMcp = allCompiledAgents(compiledBundle.agents).some(
      (agent) => Object.keys(agent.mcpServers ?? {}).length > 0,
    );
    await ensureCompiledMcpDependencies(compiledBundle, projectRoot);
    const mcpRuntimeSource = hasMcp
      ? createMcpRuntimeSource(target)
      : "";
    const optionalFeatureRuntimeSource =
      createOptionalFeatureRuntimeSource({
        inference: inferenceEnabled,
        cloudStorage: cloudStorageEnabled,
      });
    await writeFile(
      productionEntryPath,
      [
        `import { createOrcha } from ${JSON.stringify(runtimeFactoryPath)};`,
        `import { ${runtimePlatformExport(target)} as runtimePlatform } from ${JSON.stringify(runtimePlatformPath)};`,
        `import { createProviderResponseGenerator } from ${JSON.stringify(providerDispatcherPath)};`,
        `export * from ${JSON.stringify(runtimeEntryPath)};`,
        nodeStorageExports,
        providerRuntimeSource,
        platformActionRuntimeSource,
        mcpRuntimeSource,
        optionalFeatureRuntimeSource,
        sandboxRuntimeSource,
        `const compiledBundle = ${JSON.stringify(compiledBundle)};`,
        "const generateProviderResponse = createProviderResponseGenerator(includedProviders);",
        "export const orcha = createOrcha(() => compiledBundle, generateProviderResponse, runtimePlatform);",
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
      platform: target === "node" ? "node" : "browser",
      target:
        target === "node"
          ? "node18"
          : target === "browser"
            ? ["chrome110", "firefox110", "safari16"]
            : "es2022",
      minify: true,
      legalComments: "none",
      define: {
        "process.env.ORCHA_INCLUDE_SANDBOX": JSON.stringify(
          compiledBundle.actionRuntime === "sandbox" ? "1" : "0",
        ),
      },
      ...(target === "node"
        ? {
            banner: {
              js: [
                'import { createRequire as __orchaCreateRequire } from "node:module";',
                "const require = __orchaCreateRequire(import.meta.url);",
              ].join("\n"),
            },
          }
        : {}),
      ...(target === "react-native"
        ? {
            external: [
              "@react-native-async-storage/async-storage",
            ],
          }
        : {}),
      logLevel: "silent",
    });
    await writeFile(
      manifestPath,
      `${JSON.stringify(compiledBundle)}\n`,
      "utf8",
    );

    return outputPath;
  } finally {
    setRegistryCompilationActive(false);
    if (compilationRuntimeCreated && orcha.isInitialized()) {
      await orcha.close();
    }
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });
  }
}

function bundleFileName(
  target: "node" | "browser" | "react-native",
): string {
  return target === "node" ? "bundle.js" : `bundle.${target}.js`;
}

function runtimePlatformExport(
  target: "node" | "browser" | "react-native",
): string {
  if (target === "browser") {
    return "browserRuntimePlatform";
  }
  if (target === "react-native") {
    return "reactNativeRuntimePlatform";
  }
  return "nodeRuntimePlatform";
}

function createSandboxRuntimeSource(): string {
  const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
  const executePath = resolve(
    runtimeDirectory,
    "../runtime/actions/execute.js",
  ).replaceAll("\\", "/");
  const sandboxPath = resolve(
    runtimeDirectory,
    "../runtime/actions/sandbox.js",
  ).replaceAll("\\", "/");
  return [
    `import { setSandboxRuntimeLoader } from ${JSON.stringify(executePath)};`,
    `import { executeSandboxedAction } from ${JSON.stringify(sandboxPath)};`,
    "setSandboxRuntimeLoader(async () => ({ executeSandboxedAction }));",
    "",
  ].join("\n");
}

function createPlatformActionRuntimeSource(
  target: "node" | "browser" | "react-native",
): string {
  const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
  const executePath = resolve(
    runtimeDirectory,
    "../runtime/actions/execute.js",
  ).replaceAll("\\", "/");
  const nativePath = resolve(
    runtimeDirectory,
    target === "node"
      ? "../runtime/actions/native.js"
      : "../runtime/actions/browser-native.js",
  ).replaceAll("\\", "/");
  return [
    `import { setNativeRuntimeLoader } from ${JSON.stringify(executePath)};`,
    `import { executeNativeAction } from ${JSON.stringify(nativePath)};`,
    "setNativeRuntimeLoader(async () => ({ executeNativeAction }));",
    "",
  ].join("\n");
}

function createMcpRuntimeSource(
  target: "node" | "browser" | "react-native",
): string {
  const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
  const clientPath = resolve(
    runtimeDirectory,
    "../runtime/mcp/client.js",
  ).replaceAll("\\", "/");
  const implementationPath = resolve(
    runtimeDirectory,
    target === "node"
      ? "../runtime/mcp/node-client.js"
      : "../runtime/mcp/http-client.js",
  ).replaceAll("\\", "/");
  const factoryName =
    target === "node" ? "createNodeMcpClient" : "createHttpMcpClient";
  return [
    `import { setMcpClientFactory } from ${JSON.stringify(clientPath)};`,
    `import { ${factoryName} } from ${JSON.stringify(implementationPath)};`,
    `setMcpClientFactory(${factoryName});`,
    "",
  ].join("\n");
}

function createOptionalFeatureRuntimeSource(options: {
  inference: boolean;
  cloudStorage: boolean;
}): string {
  if (!options.inference && !options.cloudStorage) {
    return "";
  }
  const sourceRoot = dirname(fileURLToPath(import.meta.url));
  const hooksPath = resolve(
    sourceRoot,
    "../runtime/optional-features.js",
  ).replaceAll("\\", "/");
  const imports: string[] = [];
  const registrations: string[] = [];
  if (options.inference) {
    const inferencePath = resolve(
      sourceRoot,
      "../amarsia/inference.js",
    ).replaceAll("\\", "/");
    imports.push(
      `import { createAmarsiaInferenceGenerator } from ${JSON.stringify(inferencePath)};`,
      `import { setInferenceGeneratorFactory } from ${JSON.stringify(hooksPath)};`,
    );
    registrations.push(
      "setInferenceGeneratorFactory(createAmarsiaInferenceGenerator);",
    );
  }
  if (options.cloudStorage) {
    const cloudPath = resolve(
      sourceRoot,
      "../storage/cloud.js",
    ).replaceAll("\\", "/");
    imports.push(
      `import { CloudSessionStore } from ${JSON.stringify(cloudPath)};`,
      `import { setCloudSessionStoreFactory } from ${JSON.stringify(hooksPath)};`,
    );
    registrations.push(
      "setCloudSessionStoreFactory((options) => new CloudSessionStore(options));",
    );
  }
  return [...imports, ...registrations, ""].join("\n");
}

function createNodeStorageExports(): string {
  const sourceRoot = dirname(fileURLToPath(import.meta.url));
  const jsonlPath = resolve(
    sourceRoot,
    "../storage/node-jsonl.js",
  ).replaceAll("\\", "/");
  const sqlitePath = resolve(
    sourceRoot,
    "../storage/node-sqlite.js",
  ).replaceAll("\\", "/");
  return [
    `export { NodeJsonlSessionStore } from ${JSON.stringify(jsonlPath)};`,
    `export { NodeSqliteSessionStore } from ${JSON.stringify(sqlitePath)};`,
    "",
  ].join("\n");
}

function allCompiledAgents(
  agents: CompiledBundle["agents"],
): CompiledAgentManifest[] {
  return Object.values(agents).flatMap((agent) => [
    agent,
    ...Object.values(agent.subagents ?? {}),
  ]);
}

function createProviderRuntimeSource(
  providerNames: string[],
  target: "node" | "browser" | "react-native",
): string {
  const providersDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../providers",
  );
  const imports: string[] = [];
  const entries: string[] = [];

  for (const [index, name] of providerNames.entries()) {
    if (!isBuiltInProvider(name)) {
      throw new Error(`Provider "${name}" is not built in.`);
    }
    if (
      target !== "node" &&
      (name === "bedrock" || name === "vertexai")
    ) {
      throw new Error(
        `Provider "${name}" is not available for the ${target} target.`,
      );
    }
    const descriptor = builtInProviderCatalog[name];
    const localName = `provider${index}`;
    imports.push(
      `import { ${descriptor.exportName} as ${localName} } from ${JSON.stringify(
        resolve(providersDirectory, descriptor.moduleFile),
      )};`,
    );
    entries.push(`${JSON.stringify(name)}: ${localName}`);
  }

  const contents = [
    ...imports,
    `const includedProviders = { ${entries.join(", ")} };`,
    "",
  ].join("\n");

  return contents;
}
