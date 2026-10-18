import { RuntimeAgent } from "./agent.js";
import {
  AmarsiaTelemetryClient,
  withAmarsiaTelemetry,
} from "../amarsia/analytics.js";
import type { ProviderResponseGenerator } from "../providers/types.js";
import { setOrchaRuntimeContext } from "./context.js";
import type { RuntimePlatform } from "./platform.js";
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
  readonly #platform: RuntimePlatform;

  constructor(
    resolveBundle: BundleResolver,
    generateProviderResponse: ProviderResponseGenerator,
    platform: RuntimePlatform,
  ) {
    this.#resolveBundle = resolveBundle;
    this.#generateProviderResponse = generateProviderResponse;
    this.#platform = platform;
  }

  attachClient(client: OrchaClient): void {
    this.#client = client;
  }

  init(configuration: OrchaInitConfiguration): OrchaClient {
    const projectRoot = this.#platform.projectRoot(configuration);
    const bundle = configuration.bundle ?? this.#resolveBundle(configuration);
    if (configuration.amarsia?.key && this.#platform.syncProject) {
      this.#platform.syncProject({
        configuration,
        bundle,
        projectRoot,
      });
    }
    const runtimeConfiguration: ProjectConfiguration = {
      providers: Object.fromEntries(
        Object.entries(configuration.providers).map(([name, provider]) => [
          name,
          typeof provider === "string" ? { apiKey: provider } : provider,
        ]),
      ) as ResolvedProviderConfigurations,
      actions: {
        ...configuration.actions,
        runtime: configuration.actions?.runtime ?? "native",
      },
      storage: configuration.storage,
    };
    if (
      bundle.actionRuntime &&
      runtimeConfiguration.actions?.runtime !== bundle.actionRuntime
    ) {
      throw new Error(
        `Production bundle expects local action runtime "${bundle.actionRuntime}".`,
      );
    }
    const createStore = (manifest: CompiledAgentManifest) =>
      this.#platform.createSessionStore({
        configuration,
        projectRoot,
        manifest,
      });
    const telemetry = configuration.amarsia?.key
      ? new AmarsiaTelemetryClient(configuration.amarsia)
      : undefined;
    const createRuntimeStore = (manifest: CompiledAgentManifest) => {
      const store = createStore(manifest);
      return telemetry
        ? withAmarsiaTelemetry({ store, manifest, client: telemetry })
        : store;
    };
    const agents = new Map<string, AgentRuntime>();

    for (const [name, manifest] of Object.entries(bundle.agents)) {
      const subagents = Object.fromEntries(
        Object.entries(manifest.subagents ?? {}).map(
          ([subagentName, subagentManifest]) => [
            subagentName,
            new RuntimeAgent({
              manifest: subagentManifest,
              configuration: runtimeConfiguration,
              store: createRuntimeStore(subagentManifest),
              activeSessions: this.#activeSessions,
              sessionControls: this.#sessionControls,
              generateProviderResponse: this.#generateProviderResponse,
              delegatedOnly: true,
              projectRoot,
              randomUUID: this.#platform.randomUUID,
            }),
          ],
        ),
      );
      agents.set(
        name,
        new RuntimeAgent({
          manifest,
          configuration: runtimeConfiguration,
          store: createRuntimeStore(manifest),
          activeSessions: this.#activeSessions,
          sessionControls: this.#sessionControls,
          generateProviderResponse: this.#generateProviderResponse,
          subagents,
          projectRoot,
          randomUUID: this.#platform.randomUUID,
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

export function createOrcha(
  resolveBundle: BundleResolver,
  generateProviderResponse: ProviderResponseGenerator,
  platform: RuntimePlatform,
): OrchaClient {
  const core = new OrchaRuntimeCore(
    resolveBundle,
    generateProviderResponse,
    platform,
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
