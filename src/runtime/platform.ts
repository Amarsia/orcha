import type {
  CompiledAgentManifest,
  CompiledBundle,
  OrchaInitConfiguration,
  SessionStore,
} from "../types.js";

export interface RuntimePlatform {
  projectRoot(configuration: OrchaInitConfiguration): string;
  createSessionStore(options: {
    configuration: OrchaInitConfiguration;
    projectRoot: string;
    manifest: CompiledAgentManifest;
  }): SessionStore;
  syncProject?(options: {
    configuration: OrchaInitConfiguration;
    bundle: CompiledBundle;
    projectRoot: string;
  }): void;
}
