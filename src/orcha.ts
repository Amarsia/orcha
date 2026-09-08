import { resolve } from "node:path";
import { compileRegistry } from "./compiler/compile.js";
import { createOrcha } from "./runtime/create-orcha.js";

export type { Orcha, OrchaClient } from "./runtime/create-orcha.js";

export const orcha = createOrcha((configuration) => {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ORCHA_COMPILING !== "1"
  ) {
    throw new Error(
      "ORCHA_PRODUCTION_BUNDLE_MISSING: configure the Orcha integration in your application build.",
    );
  }
  const projectRoot = resolve(configuration.root ?? process.cwd());
  const registryRoot = resolve(projectRoot, "orcha");
  return compileRegistry(configuration.agents, registryRoot);
});
