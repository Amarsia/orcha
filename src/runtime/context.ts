import type { ProviderResponseGenerator } from "../providers/types.js";
import type {
  AgentRegistration,
  CompiledBundle,
  ProjectConfiguration,
} from "../types.js";

export interface OrchaRuntimeContext {
  projectRoot: string;
  registrations: Record<string, AgentRegistration>;
  bundle: CompiledBundle;
  configuration: ProjectConfiguration;
  generateProviderResponse: ProviderResponseGenerator;
}

const RUNTIME_CONTEXTS_KEY = Symbol.for("orchajs.runtimeContexts");

function getContextsMap(): WeakMap<object, OrchaRuntimeContext> {
  const globalRecord = globalThis as Record<
    symbol,
    WeakMap<object, OrchaRuntimeContext> | undefined
  >;
  if (!globalRecord[RUNTIME_CONTEXTS_KEY]) {
    globalRecord[RUNTIME_CONTEXTS_KEY] = new WeakMap<
      object,
      OrchaRuntimeContext
    >();
  }
  return globalRecord[RUNTIME_CONTEXTS_KEY];
}

export function setOrchaRuntimeContext(
  client: object,
  context: OrchaRuntimeContext,
): void {
  getContextsMap().set(client, context);
}

export function getOrchaRuntimeContext(
  client: object,
): OrchaRuntimeContext {
  const context = getContextsMap().get(client);
  if (!context) {
    throw new Error(
      "runTests() requires an initialized Orcha client.",
    );
  }
  return context;
}
