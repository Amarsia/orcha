import { resolve } from "node:path";
import { compileRegistry } from "./compiler/compile.js";
import { generateProviderResponse } from "./providers/index.js";
import { setSandboxRuntimeLoader } from "./runtime/actions/execute.js";
import { createOrcha } from "./runtime/create-orcha.js";

export type { Orcha, OrchaClient } from "./runtime/create-orcha.js";

setSandboxRuntimeLoader(async () => {
  const modulePath = "./runtime/actions/sandbox.js";
  return import(modulePath) as Promise<
    typeof import("./runtime/actions/sandbox.js")
  >;
});

export const orcha = createOrcha(
  (configuration) => {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ORCHA_COMPILING !== "1"
    ) {
      throw new Error(
        "ORCHA_PRODUCTION_BUNDLE_MISSING: configure the Orcha integration in your application build.",
      );
    }
    const projectRoot = resolve(
      configuration.root ??
        process.env.ORCHA_PROJECT_ROOT ??
        process.cwd(),
    );
    const registryRoot = resolve(projectRoot, "orcha");
    return compileRegistry(
      configuration.agents,
      registryRoot,
      configuration.actions?.runtime ?? "native",
    );
  },
  generateProviderResponse,
);
