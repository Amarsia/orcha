import { resolve } from "node:path";
import { RuntimeAgent } from "./agent.js";
import { NodeJsonlSessionStore } from "../storage/node-jsonl.js";
import type {
  AgentRuntime,
  CompiledBundle,
  OrchaInitConfiguration,
  ProjectConfiguration,
} from "../types.js";

export interface Orcha {
  init(configuration: OrchaInitConfiguration): OrchaClient;
  isInitialized(): boolean;
  /** @internal Used by the development compiler. */
  getCompiledBundle(): CompiledBundle;
}

export type OrchaClient = Orcha & Record<string, AgentRuntime>;
export type BundleResolver = (
  configuration: OrchaInitConfiguration,
) => CompiledBundle;

class OrchaRuntimeCore implements Orcha {
  #agents = new Map<string, AgentRuntime>();
  #bundle: CompiledBundle | undefined;
  #client: OrchaClient | undefined;
  readonly #activeSessions = new Set<string>();
  readonly #resolveBundle: BundleResolver;

  constructor(resolveBundle: BundleResolver) {
    this.#resolveBundle = resolveBundle;
  }

  attachClient(client: OrchaClient): void {
    this.#client = client;
  }

  init(configuration: OrchaInitConfiguration): OrchaClient {
    const projectRoot = resolve(configuration.root ?? process.cwd());
    const bundle = this.#resolveBundle(configuration);
    const runtimeConfiguration: ProjectConfiguration = {
      providers: Object.fromEntries(
        Object.entries(configuration.providers).map(([name, provider]) => [
          name,
          typeof provider === "string" ? { apiKey: provider } : provider,
        ]),
      ),
      actions: configuration.actions,
      storage: configuration.storage,
    };
    const hasLocalActions = Object.values(bundle.agents).some((agent) =>
      Object.values(agent.actions).some((action) => action.execution === "local"),
    );
    if (hasLocalActions && !configuration.actions?.runtime) {
      throw new Error(
        'Local actions require orcha.init({ actions: { runtime: "native" | "sandbox" } }).',
      );
    }
    if (
      bundle.actionRuntime &&
      configuration.actions?.runtime !== bundle.actionRuntime
    ) {
      throw new Error(
        `Production bundle expects local action runtime "${bundle.actionRuntime}".`,
      );
    }
    const strategy = configuration.storage?.strategy ?? "node-jsonl";
    if (strategy !== "node-jsonl") {
      throw new Error(`Storage strategy "${strategy}" is not implemented yet.`);
    }

    const store = new NodeJsonlSessionStore(
      configuration.storage?.directory ?? ".orcha/sessions",
      projectRoot,
    );
    const agents = new Map<string, AgentRuntime>();

    for (const [name, manifest] of Object.entries(bundle.agents)) {
      agents.set(
        name,
        new RuntimeAgent({
          manifest,
          configuration: runtimeConfiguration,
          store,
          activeSessions: this.#activeSessions,
        }),
      );
    }

    this.#bundle = bundle;
    this.#agents = agents;
    return this.#client as OrchaClient;
  }

  isInitialized(): boolean {
    return this.#bundle !== undefined;
  }

  getCompiledBundle(): CompiledBundle {
    if (!this.#bundle) {
      throw new Error("Orcha has not been initialized.");
    }
    return this.#bundle;
  }

  agent(name: string): AgentRuntime | undefined {
    return this.#agents.get(name);
  }
}

export function createOrcha(resolveBundle: BundleResolver): OrchaClient {
  const core = new OrchaRuntimeCore(resolveBundle);
  const client = new Proxy(core, {
    get(target, property) {
      if (typeof property === "string") {
        const agent = core.agent(property);
        if (agent) {
          return agent;
        }
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as OrchaClient;

  core.attachClient(client);
  return client;
}
