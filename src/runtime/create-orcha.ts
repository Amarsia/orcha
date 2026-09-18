import { resolve } from "node:path";
import { RuntimeAgent } from "./agent.js";
import { NodeJsonlSessionStore } from "../storage/node-jsonl.js";
import type { ProviderResponseGenerator } from "../providers/types.js";
import { setOrchaRuntimeContext } from "./context.js";
import type {
  AgentRuntime,
  CompiledAgentManifest,
  CompiledBundle,
  OrchaInitConfiguration,
  ProjectConfiguration,
  ResolvedProviderConfigurations,
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
  readonly #sessionControls = new Map<
    string,
    {
      pauseRequested: boolean;
      controller: AbortController;
    }
  >();
  readonly #resolveBundle: BundleResolver;
  readonly #generateProviderResponse: ProviderResponseGenerator;

  constructor(
    resolveBundle: BundleResolver,
    generateProviderResponse: ProviderResponseGenerator,
  ) {
    this.#resolveBundle = resolveBundle;
    this.#generateProviderResponse = generateProviderResponse;
  }

  attachClient(client: OrchaClient): void {
    this.#client = client;
  }

  init(configuration: OrchaInitConfiguration): OrchaClient {
    const projectRoot = resolve(
      configuration.root ??
        process.env.ORCHA_PROJECT_ROOT ??
        process.cwd(),
    );
    const bundle = this.#resolveBundle(configuration);
    const runtimeConfiguration: ProjectConfiguration = {
      providers: Object.fromEntries(
        Object.entries(configuration.providers).map(([name, provider]) => [
          name,
          typeof provider === "string" ? { apiKey: provider } : provider,
        ]),
      ) as ResolvedProviderConfigurations,
      actions: configuration.actions,
      storage: configuration.storage,
    };
    const hasLocalActions = allCompiledAgents(bundle.agents).some((agent) =>
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

    const storageDirectory =
      configuration.storage?.directory ?? ".orcha/sessions";
    const createStore = (manifest: CompiledAgentManifest) =>
      new NodeJsonlSessionStore(
        storageDirectory,
        projectRoot,
        manifest.key ?? manifest.name,
      );
    const agents = new Map<string, AgentRuntime>();

    for (const [name, manifest] of Object.entries(bundle.agents)) {
      const subagents = Object.fromEntries(
        Object.entries(manifest.subagents ?? {}).map(
          ([subagentName, subagentManifest]) => [
            subagentName,
            new RuntimeAgent({
              manifest: subagentManifest,
              configuration: runtimeConfiguration,
              store: createStore(subagentManifest),
              activeSessions: this.#activeSessions,
              sessionControls: this.#sessionControls,
              generateProviderResponse: this.#generateProviderResponse,
              delegatedOnly: true,
              projectRoot,
            }),
          ],
        ),
      );
      agents.set(
        name,
        new RuntimeAgent({
          manifest,
          configuration: runtimeConfiguration,
          store: createStore(manifest),
          activeSessions: this.#activeSessions,
          sessionControls: this.#sessionControls,
          generateProviderResponse: this.#generateProviderResponse,
          subagents,
          projectRoot,
        }),
      );
    }

    this.#bundle = bundle;
    this.#agents = agents;
    setOrchaRuntimeContext(this.#client as OrchaClient, {
      projectRoot,
      registrations: { ...configuration.agents },
      bundle,
      configuration: runtimeConfiguration,
      generateProviderResponse: this.#generateProviderResponse,
    });
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

function allCompiledAgents(
  agents: CompiledBundle["agents"],
): CompiledAgentManifest[] {
  return Object.values(agents).flatMap((agent) => [
    agent,
    ...Object.values(agent.subagents ?? {}),
  ]);
}

export function createOrcha(
  resolveBundle: BundleResolver,
  generateProviderResponse: ProviderResponseGenerator,
): OrchaClient {
  const core = new OrchaRuntimeCore(
    resolveBundle,
    generateProviderResponse,
  );
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
