import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileRegistry } from "./compiler/compile.js";
import { generateProviderResponse } from "./providers/index.js";
import { setSandboxRuntimeLoader } from "./runtime/actions/execute.js";
import { createOrcha } from "./runtime/create-orcha.js";
import type {
  CompiledBundle,
  OrchaInitConfiguration,
} from "./types.js";

export type { Orcha, OrchaClient } from "./runtime/create-orcha.js";

setSandboxRuntimeLoader(async () => {
  const modulePath = "./runtime/actions/sandbox.js";
  return import(modulePath) as Promise<
    typeof import("./runtime/actions/sandbox.js")
  >;
});

export const orcha = createOrcha(
  (configuration) => {
    const projectRoot = resolve(
      configuration.root ??
        process.env.ORCHA_PROJECT_ROOT ??
        process.cwd(),
    );
    if (
      process.env.ORCHA_COMPILING !== "1" &&
      isPrecompiledRuntime()
    ) {
      return loadCompiledManifest(projectRoot, configuration);
    }
    const registryRoot = resolve(projectRoot, "orcha");
    return compileRegistry(
      configuration.agents,
      registryRoot,
      configuration.actions?.runtime ?? "native",
    );
  },
  generateProviderResponse,
);

function isPrecompiledRuntime(): boolean {
  return (
    process.env.ORCHA_USE_BUILD === "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined ||
    process.env.AWS_EXECUTION_ENV?.startsWith("AWS_Lambda_") === true
  );
}

function loadCompiledManifest(
  projectRoot: string,
  configuration: OrchaInitConfiguration,
): CompiledBundle {
  const manifestPath = resolve(
    projectRoot,
    ".orcha/dist/manifest.json",
  );
  if (!existsSync(manifestPath)) {
    throw new Error(
      `ORCHA_PRODUCTION_BUNDLE_MISSING: "${manifestPath}" was not found. Run "npx orcha build" before packaging, include ".orcha/dist" in the deployment, or configure the Orcha build integration.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Orcha could not read the compiled manifest at "${manifestPath}". Run "npx orcha build" again.`,
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
      `Orcha compiled manifest "${manifestPath}" is invalid. Run "npx orcha build" again.`,
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
    throw new Error(
      `Orcha compiled manifest does not match the registered agents. Run "npx orcha build" again. Expected [${registeredAgents.join(", ")}], found [${compiledAgents.join(", ")}].`,
    );
  }
  return bundle;
}
