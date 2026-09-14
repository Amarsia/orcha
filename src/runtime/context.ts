import type { ProviderResponseGenerator } from "../providers/types.js";
import type {
  CompiledBundle,
  ProjectConfiguration,
} from "../types.js";

export interface OrchaRuntimeContext {
  projectRoot: string;
  registrations: Record<string, string>;
  bundle: CompiledBundle;
  configuration: ProjectConfiguration;
  generateProviderResponse: ProviderResponseGenerator;
}

const contexts = new WeakMap<object, OrchaRuntimeContext>();

export function setOrchaRuntimeContext(
  client: object,
  context: OrchaRuntimeContext,
): void {
  contexts.set(client, context);
}

export function getOrchaRuntimeContext(
  client: object,
): OrchaRuntimeContext {
  const context = contexts.get(client);
  if (!context) {
    throw new Error(
      "runTests() requires an initialized Orcha client.",
    );
  }
  return context;
}
