import type { ProviderResponseGenerator } from "../providers/types.js";
import type { SessionStore } from "../types.js";

export interface CloudSessionStoreFactoryOptions {
  local: SessionStore;
  key: string;
  endpoint?: string;
  agentName: string;
}

export type CloudSessionStoreFactory = (
  options: CloudSessionStoreFactoryOptions,
) => SessionStore;

export type InferenceGeneratorFactory = (configuration: {
  key: string;
  endpoint?: string;
}) => ProviderResponseGenerator;

let inferenceGeneratorFactory: InferenceGeneratorFactory | undefined;
let cloudSessionStoreFactory: CloudSessionStoreFactory | undefined;

/** @internal Registers the optional inference implementation. */
export function setInferenceGeneratorFactory(
  factory: InferenceGeneratorFactory,
): void {
  inferenceGeneratorFactory = factory;
}

/** @internal Registers the optional cloud storage implementation. */
export function setCloudSessionStoreFactory(
  factory: CloudSessionStoreFactory,
): void {
  cloudSessionStoreFactory = factory;
}

export function createInferenceGenerator(
  configuration: Parameters<InferenceGeneratorFactory>[0],
): ProviderResponseGenerator {
  if (!inferenceGeneratorFactory) {
    throw new Error(
      "Amarsia inference was not included in this Orcha runtime.",
    );
  }
  return inferenceGeneratorFactory(configuration);
}

export function createCloudSessionStore(
  options: CloudSessionStoreFactoryOptions,
): SessionStore {
  if (!cloudSessionStoreFactory) {
    throw new Error(
      "Cloud session storage was not included in this Orcha runtime.",
    );
  }
  return cloudSessionStoreFactory(options);
}
