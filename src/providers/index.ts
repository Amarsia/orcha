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
  const loading = import(`./${descriptor.moduleFile}`).then((module) => {
    const provider: unknown = module[descriptor.exportName];
    if (!isProviderAdapter(provider) || provider.name !== name) {
      throw new Error(
        `Provider module "${descriptor.moduleFile}" does not export "${descriptor.exportName}".`,
      );
    }
    return provider;
  });
  loadedProviders.set(name, loading);
  return loading;
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
