import { OrchaError } from "../errors.js";
import type { ProviderName } from "../types.js";
import {
  builtInProviderCatalog,
  isBuiltInProvider,
} from "./catalog.js";
import type {
  ProviderAdapter,
  ProviderResponseGenerator,
} from "./types.js";

export { isBuiltInProvider } from "./catalog.js";

const loadedProviders = new Map<
  ProviderName,
  Promise<ProviderAdapter>
>();

export const generateProviderResponse: ProviderResponseGenerator =
  async (name, configuration, request) => {
    const provider = await loadProvider(name);
    return provider.generate(configuration, request);
  };

function loadProvider(name: ProviderName): Promise<ProviderAdapter> {
  const existing = loadedProviders.get(name);
  if (existing) {
    return existing;
  }
  if (!isBuiltInProvider(name)) {
    throw new OrchaError(
      "provider_error",
      `Provider "${name}" is not implemented by this version of OrchaJS.`,
    );
  }

  const descriptor = builtInProviderCatalog[name];
  const loading = import(`./${descriptor.moduleFile}`)
    .then((module) => {
      const provider: unknown = module[descriptor.exportName];
      if (!isProviderAdapter(provider) || provider.name !== name) {
        throw new Error(
          `Provider module "${descriptor.moduleFile}" does not export "${descriptor.exportName}".`,
        );
      }
      return provider;
    })
    .catch((error: unknown) => {
      loadedProviders.delete(name);
      const dependency = missingProviderDependency(name, error);
      if (dependency) {
        const nodeRequirement =
          dependency === "@google/genai"
            ? " Node.js 20 or newer is also required."
            : "";
        throw new OrchaError(
          "provider_error",
          `Provider "${name}" requires the optional "${dependency}" package.${nodeRequirement} Install it in the application that uses this provider.`,
          { cause: error },
        );
      }
      throw error;
    });
  loadedProviders.set(name, loading);
  return loading;
}

function missingProviderDependency(
  name: ProviderName,
  error: unknown,
): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  if (
    name === "bedrock" &&
    error.message.includes("@aws-sdk/client-bedrock-runtime")
  ) {
    return "@aws-sdk/client-bedrock-runtime";
  }
  if (
    (name === "googlegenai" || name === "vertexai") &&
    error.message.includes("@google/genai")
  ) {
    return "@google/genai";
  }
  return undefined;
}

function isProviderAdapter(value: unknown): value is ProviderAdapter {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    "generate" in value &&
    typeof value.generate === "function"
  );
}
