import { RuntimeAgent } from "./agent.js";
import {
  AmarsiaTelemetryClient,
  withAmarsiaTelemetry,
} from "../amarsia/analytics.js";
import type { ProviderResponseGenerator } from "../providers/types.js";
import { isRegistryCompilationActive } from "./compiler-hook.js";
import { setOrchaRuntimeContext } from "./context.js";
import { createInferenceGenerator } from "./optional-features.js";
import type { RuntimePlatform } from "./platform.js";
import type {
  AgentRuntime,
  CompiledAgentManifest,
  CompiledBundle,
  OrchaInitConfiguration,
  ProjectConfiguration,
  ProviderConfiguration,
  ProviderName,
  ResolvedProviderConfigurations,
  SessionStore,
} from "../types.js";

export interface Orcha {
  init(configuration: OrchaInitConfiguration): OrchaClient;
  isInitialized(): boolean;
  /** Number of sessions whose local tail is waiting for cloud acknowledgement. */
  readonly cloudStoragePendingCount: number;
  /** Most recent background cloud storage error, if any. */
  readonly cloudStorageLastError: Error | undefined;
  /** Waits for cloud outboxes to drain, up to the supplied timeout. */
  flushCloudStorage(
    options?: number | { timeoutMs?: number },
  ): Promise<void>;
  /**
   * Closes background runtime resources and makes a best-effort backup flush.
   * Use flushCloudStorage() first when remote delivery must be enforced.
   */
  close(options?: { timeoutMs?: number }): Promise<void>;
  /** Flushes queued Amarsia telemetry without blocking normal agent runs. */
  flushTelemetry(options?: { timeoutMs?: number }): Promise<void>;
  /** @internal Used by the development compiler. */
  getCompiledBundle(): CompiledBundle;
  /** @internal Used to omit direct providers from inferred builds. */
  isInferenceEnabled(): boolean;
  /** @internal Used to include cloud storage only when selected. */
  isCloudStorageEnabled(): boolean;
}

export type OrchaClient = Orcha & Record<string, AgentRuntime>;
export type BundleResolver = (
  configuration: OrchaInitConfiguration,
) => CompiledBundle;

class OrchaRuntimeCore implements Orcha {
  #agents = new Map<string, AgentRuntime>();
  #bundle: CompiledBundle | undefined;
  #inferenceEnabled = false;
  #cloudStorageEnabled = false;
  #client: OrchaClient | undefined;
  #telemetry: AmarsiaTelemetryClient | undefined;
  #stores = new Set<SessionStore>();
  #closing: Promise<void> | undefined;
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
    if (this.#bundle || this.#closing) {
      throw new Error(
        "Orcha is already initialized. Await orcha.close() before initializing it again.",
      );
    }
    const projectRoot = this.#platform.projectRoot(configuration);
    const bundle = configuration.bundle ?? this.#resolveBundle(configuration);
    const inferenceEnabled = configuration.amarsia?.inference === true;
    if (isRegistryCompilationActive()) {
      this.#bundle = bundle;
      this.#inferenceEnabled = inferenceEnabled;
      this.#cloudStorageEnabled =
        configuration.storage?.strategy === "cloud";
      return this.#client as OrchaClient;
    }
    if (inferenceEnabled && !configuration.amarsia?.key.trim()) {
      throw new Error(
        "Amarsia inference requires a non-empty amarsia.key.",
      );
    }
    if (configuration.amarsia?.key && this.#platform.syncProject) {
      this.#platform.syncProject({
        configuration,
        bundle,
        projectRoot,
      });
    }
    const runtimeConfiguration: ProjectConfiguration = {
      providers: Object.fromEntries(
        Object.entries(configuration.providers ?? {}).map(([name, provider]) => [
          name,
          typeof provider === "string" ? { apiKey: provider } : provider,
        ]),
      ) as ResolvedProviderConfigurations,
      actions: {
        ...configuration.actions,
        runtime: configuration.actions?.runtime ?? "native",
      },
      mcp: configuration.mcp,
      storage: configuration.storage,
    };
    if (inferenceEnabled) {
      for (const provider of compiledProviderNames(bundle)) {
        const providers =
          runtimeConfiguration.providers as Record<
            ProviderName,
            ProviderConfiguration | undefined
          >;
        providers[provider] ??= { apiKey: "" };
      }
    }
    const inferenceGenerator = inferenceEnabled
      ? createInferenceGenerator(configuration.amarsia!)
      : undefined;
    const generateProviderResponse: ProviderResponseGenerator =
      inferenceGenerator ?? this.#generateProviderResponse;
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
    this.#telemetry = telemetry;
    const createRuntimeStore = (manifest: CompiledAgentManifest) => {
      const store = createStore(manifest);
      const runtimeStore = telemetry
        ? withAmarsiaTelemetry({ store, manifest, client: telemetry })
        : store;
      this.#stores.add(runtimeStore);
      return runtimeStore;
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
              generateProviderResponse,
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
          generateProviderResponse,
          subagents,
          projectRoot,
          randomUUID: this.#platform.randomUUID,
        }),
      );
    }

    this.#bundle = bundle;
    this.#inferenceEnabled = inferenceEnabled;
    this.#cloudStorageEnabled =
      configuration.storage?.strategy === "cloud";
    this.#agents = agents;
    setOrchaRuntimeContext(this.#client as OrchaClient, {
      projectRoot,
      registrations: { ...configuration.agents },
      bundle,
      configuration: runtimeConfiguration,
      generateProviderResponse,
    });
    return this.#client as OrchaClient;
  }

  isInitialized(): boolean {
    return this.#bundle !== undefined;
  }

  get cloudStoragePendingCount(): number {
    let pending = 0;
    for (const store of this.#stores) {
      pending += store.cloudStoragePendingCount ?? 0;
    }
    return pending;
  }

  get cloudStorageLastError(): Error | undefined {
    let error: Error | undefined;
    for (const store of this.#stores) {
      error = store.cloudStorageLastError ?? error;
    }
    return error;
  }

  async flushCloudStorage(
    options: number | { timeoutMs?: number } = {},
  ): Promise<void> {
    const normalized =
      typeof options === "number" ? { timeoutMs: options } : options;
    await Promise.all(
      [...this.#stores].map((store) =>
        store.flushCloudStorage?.(normalized),
      ),
    );
  }

  async close(options: { timeoutMs?: number } = {}): Promise<void> {
    if (this.#closing) return this.#closing;
    const close = (async () => {
      const backupOperations = [
        this.#telemetry?.close(options),
        ...[...this.#stores].map((store) =>
          store.closeCloudStorage?.(options),
        ),
      ].filter((operation): operation is Promise<void> =>
        operation !== undefined
      );
      const resourceOperations = [
        ...[...this.#agents.values()].flatMap((agent) =>
          agent instanceof RuntimeAgent ? [agent._close()] : [],
        ),
      ];
      const [, resourceResults] = await Promise.all([
        Promise.allSettled(backupOperations),
        Promise.allSettled(resourceOperations),
      ]);
      const failure = resourceResults.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      this.#stores.clear();
      this.#agents.clear();
      this.#telemetry = undefined;
      this.#bundle = undefined;
      this.#inferenceEnabled = false;
      this.#cloudStorageEnabled = false;
      if (failure) throw failure.reason;
    })();
    this.#closing = close;
    try {
      await close;
    } finally {
      this.#closing = undefined;
    }
  }

  async flushTelemetry(options?: { timeoutMs?: number }): Promise<void> {
    await this.#telemetry?.drain(options);
  }

  getCompiledBundle(): CompiledBundle {
    if (!this.#bundle) {
      throw new Error("Orcha has not been initialized.");
    }
    return this.#bundle;
  }

  isInferenceEnabled(): boolean {
    return this.#inferenceEnabled;
  }

  isCloudStorageEnabled(): boolean {
    return this.#cloudStorageEnabled;
  }

  agent(name: string): AgentRuntime | undefined {
    return this.#agents.get(name);
  }
}

function compiledProviderNames(
  bundle: CompiledBundle,
): Set<ProviderName> {
  const names = new Set<ProviderName>();
  const visit = (manifest: CompiledAgentManifest) => {
    names.add(manifest.provider);
    for (const evaluation of Object.values(manifest.evaluations ?? {})) {
      if (evaluation.enabled !== false) names.add(evaluation.provider);
    }
    Object.values(manifest.subagents ?? {}).forEach(visit);
  };
  Object.values(bundle.agents).forEach(visit);
  return names;
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
