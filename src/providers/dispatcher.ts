import { OrchaError } from "../errors.js";
import type { ProviderName } from "../types.js";
import type {
  ProviderAdapter,
  ProviderResponseGenerator,
} from "./types.js";

export type ProviderAdapterRegistry = Partial<
  Record<ProviderName, ProviderAdapter>
>;

export function createProviderResponseGenerator(
  providers: ProviderAdapterRegistry,
): ProviderResponseGenerator {
  return async (name, configuration, request) => {
    const provider = providers[name];
    if (!provider) {
      throw new OrchaError(
        "provider_error",
        `Provider "${name}" is not included in this Orcha runtime.`,
      );
    }
    return provider.generate(configuration, request);
  };
}
