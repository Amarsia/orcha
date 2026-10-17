import { OrchaError } from "../errors.js";
import type { ProviderName } from "../types.js";
import type {
  ProviderAdapter,
  ProviderResponseGenerator,
} from "./types.js";

const loadedProviders = new Map<
  ProviderName,
  Promise<ProviderAdapter>
>();

const loaders: Partial<
  Record<ProviderName, () => Promise<ProviderAdapter>>
> = {
  anthropic: () =>
    import("./anthropic.js").then((module) => module.anthropicProvider),
  deepseek: () =>
    import("./deepseek.js").then((module) => module.deepSeekProvider),
  googlegenai: () =>
    import("./google-genai.js").then((module) => module.googleGenAIProvider),
  openai: () =>
    import("./openai.js").then((module) => module.openAIProvider),
};

export const generateBrowserProviderResponse: ProviderResponseGenerator =
  async (name, configuration, request) => {
    const loader = loaders[name];
    if (!loader) {
      throw new OrchaError(
        "provider_error",
        `Provider "${name}" is not available in browser or React Native runtimes.`,
      );
    }
    let provider = loadedProviders.get(name);
    if (!provider) {
      provider = loader();
      loadedProviders.set(name, provider);
    }
    return (await provider).generate(configuration, request);
  };
