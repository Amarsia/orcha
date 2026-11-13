import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAmarsiaInferenceGenerator } from "./amarsia/inference.js";
import { generateProviderResponse } from "./providers/index.js";
import {
  setNativeRuntimeLoader,
  setSandboxRuntimeLoader,
} from "./runtime/actions/execute.js";
import { executeNativeAction } from "./runtime/actions/native.js";
import {
  getRegistryCompiler,
  setGlobalCompiledManifest,
} from "./runtime/compiler-hook.js";
import { createOrcha } from "./runtime/create-orcha.js";
import type { Orcha, OrchaClient } from "./runtime/create-orcha.js";
import { setMcpClientFactory } from "./runtime/mcp/client.js";
import {
  importRuntimeModule,
  requireRuntimeModule,
} from "./runtime/node-module-loader.js";
import {
  setCloudSessionStoreFactory,
  setInferenceGeneratorFactory,
} from "./runtime/optional-features.js";
import { nodeRuntimePlatform } from "./runtime/platform-node.js";
import { CloudSessionStore } from "./storage/cloud.js";
import type {
  CompiledBundle,
  OrchaInitConfiguration,
} from "./types.js";

export type { Orcha, OrchaClient };

setNativeRuntimeLoader(async () => ({ executeNativeAction }));
setSandboxRuntimeLoader(async () => {
  return importRuntimeModule<typeof import("./runtime/actions/sandbox.js")>([
    "orchajs",
    "runtime",
    "sandbox",
  ]);
});
setMcpClientFactory(async (server, credentials) => {
  const { createNodeMcpClient } = await importRuntimeModule<
    typeof import("./runtime/mcp/node-client.js")
  >(["orchajs", "runtime", "mcp-node"]);
  return createNodeMcpClient(server, credentials);
});
setInferenceGeneratorFactory(createAmarsiaInferenceGenerator);
setCloudSessionStoreFactory((options) => new CloudSessionStore(options));

const NODE_ORCHA_SINGLETON_KEY = Symbol.for("orchajs.runtime");

function getSharedNodeOrcha(): OrchaClient {
  const globalRecord = globalThis as Record<
    symbol,
    OrchaClient | undefined
  >;
  if (!globalRecord[NODE_ORCHA_SINGLETON_KEY]) {
    globalRecord[NODE_ORCHA_SINGLETON_KEY] = createOrcha(
      (configuration) => {
        const projectRoot = resolve(
          configuration.root ??
            process.env.ORCHA_PROJECT_ROOT ??
            process.cwd(),
        );
        const compiler = getRegistryCompiler();
        if (process.env.ORCHA_COMPILING === "1" && compiler) {
          return compiler(configuration, projectRoot);
        }
        const precompiled = isPrecompiledRuntime();
        const manifestFile = compiledManifestPath(projectRoot);
        if (precompiled || existsSync(manifestFile)) {
          return loadCompiledManifest(projectRoot, configuration);
        }
        const registryRoot = resolve(projectRoot, "orcha");
        if (existsSync(registryRoot)) {
          const compiled = compileRegistryAtRuntime(
            configuration.agents,
            registryRoot,
            configuration.actions?.runtime ?? "native",
            "node",
          );
          persistDevManifest(projectRoot, manifestFile, compiled);
          return compiled;
        }
        throw new Error(
          'Orcha agents could not be found in "orcha/" and no precompiled manifest exists at ".orcha/dist/manifest.json". Run "npx orchajs init" or "npx orchajs build".',
        );
      },
      generateProviderResponse,
      nodeRuntimePlatform,
    );
  }
  return globalRecord[NODE_ORCHA_SINGLETON_KEY];
}

export const orcha: OrchaClient = getSharedNodeOrcha();

function isPrecompiledRuntime(): boolean {
  return (
    process.env.ORCHA_USE_BUILD === "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
    process.env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda_") === true
  );
}

function persistDevManifest(
  projectRoot: string,
  manifestPath: string,
  bundle: CompiledBundle,
): void {
  setGlobalCompiledManifest(bundle);
  try {
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(bundle)}\n`, "utf8");
  } catch {
    // Best-effort cache write in development environments.
  }
  try {
    const ownPackageRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const consumerPackageRoot = resolve(projectRoot, "node_modules/orchajs");
    if (
      existsSync(consumerPackageRoot) &&
      realpathSync(consumerPackageRoot) !== realpathSync(ownPackageRoot)
    ) {
      const serialized = JSON.stringify(bundle);
      const esmTarget = resolve(
        consumerPackageRoot,
        "dist/runtime/compiled-manifest.js",
      );
      const cjsTarget = resolve(
        consumerPackageRoot,
        "dist-cjs/runtime/compiled-manifest.js",
      );
      if (existsSync(dirname(esmTarget))) {
        writeFileSync(
          esmTarget,
          `export const compiledManifest = ${serialized};\n`,
          "utf8",
        );
      }
      if (existsSync(dirname(cjsTarget))) {
        writeFileSync(
          cjsTarget,
          `"use strict";\nexports.compiledManifest = ${serialized};\n`,
          "utf8",
        );
      }
    }
  } catch {
    // Best-effort package manifest sync in development environments.
  }
}

function loadCompiledManifest(
  projectRoot: string,
  configuration: OrchaInitConfiguration,
): CompiledBundle {
  const manifestPath = compiledManifestPath(projectRoot);
  if (!existsSync(manifestPath)) {
    const registryRoot = resolve(projectRoot, "orcha");
    if (existsSync(registryRoot)) {
      const compiled = compileRegistryAtRuntime(
        configuration.agents,
        registryRoot,
        configuration.actions?.runtime ?? "native",
        "node",
      );
      persistDevManifest(projectRoot, manifestPath, compiled);
      return compiled;
    }
    throw new Error(
      `ORCHA_PRODUCTION_BUNDLE_MISSING: "${manifestPath}" was not found. Run "npx orchajs build" before packaging, include ".orcha/dist" in the deployment, or keep the "orcha/" directory available at runtime.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Orcha could not read the compiled manifest at "${manifestPath}". Run "npx orchajs build" again.`,
      { cause: error },
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("schemaVersion" in parsed) ||
    parsed.schemaVersion !== 1 ||
    !("agents" in parsed) ||
    typeof parsed.agents !== "object" ||
    parsed.agents === null ||
    Array.isArray(parsed.agents)
  ) {
    throw new Error(
      `Orcha compiled manifest "${manifestPath}" is invalid. Run "npx orchajs build" again.`,
    );
  }

  const bundle = parsed as CompiledBundle;
  const registeredAgents = Object.keys(configuration.agents).sort();
  const compiledAgents = Object.keys(bundle.agents).sort();
  if (
    registeredAgents.length !== compiledAgents.length ||
    registeredAgents.some(
      (name, index) => name !== compiledAgents[index],
    )
  ) {
    const registryRoot = resolve(projectRoot, "orcha");
    if (!isPrecompiledRuntime() && existsSync(registryRoot)) {
      const recompiled = compileRegistryAtRuntime(
        configuration.agents,
        registryRoot,
        configuration.actions?.runtime ?? "native",
        "node",
      );
      persistDevManifest(projectRoot, manifestPath, recompiled);
      return recompiled;
    }
    throw new Error(
      `Orcha compiled manifest does not match the registered agents. Run "npx orchajs build" again. Expected [${registeredAgents.join(", ")}], found [${compiledAgents.join(", ")}].`,
    );
  }
  return bundle;
}

function compiledManifestPath(projectRoot: string): string {
  return resolve(projectRoot, ".orcha/dist/manifest.json");
}

function compileRegistryAtRuntime(
  registrations: OrchaInitConfiguration["agents"],
  registryRoot: string,
  actionRuntime: "native" | "sandbox",
  target: "node" | "browser" | "react-native",
): CompiledBundle {
  const { compileRegistry } = requireRuntimeModule<
    typeof import("./compiler/compile.js")
  >(["orchajs", "compiler"]);
  return compileRegistry(
    registrations,
    registryRoot,
    actionRuntime,
    target,
  );
}
