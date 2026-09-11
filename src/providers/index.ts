import { OrchaError } from "../errors.js";
import type {
  ProviderConfiguration,
  ProviderName,
} from "../types.js";
import { anthropicProvider } from "./anthropic.js";
import { openAIProvider } from "./openai.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";

const builtInProviders: Partial<Record<ProviderName, ProviderAdapter>> = {
  anthropic: anthropicProvider,
  openai: openAIProvider,
};

export function isBuiltInProvider(
  name: string,
): name is ProviderName {
  return Object.hasOwn(builtInProviders, name);
}

export async function generateProviderResponse(
  name: ProviderName,
  configuration: ProviderConfiguration,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const provider = builtInProviders[name];
  if (!provider) {
    throw new OrchaError(
      "provider_error",
      `Provider "${name}" is not implemented by this version of OrchaJS.`,
    );
  }
  return provider.generate(configuration, request);
}
