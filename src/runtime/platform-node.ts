import { resolve } from "node:path";
import { syncAmarsiaProject } from "../amarsia/sync.js";
import { createSessionStore } from "../storage/create-store.js";
import type { RuntimePlatform } from "./platform.js";

export const nodeRuntimePlatform: RuntimePlatform = {
  projectRoot(configuration) {
    return resolve(
      configuration.root ??
        process.env.ORCHA_PROJECT_ROOT ??
        process.cwd(),
    );
  },
  createSessionStore({ configuration, projectRoot, manifest }) {
    return createSessionStore({
      strategy: configuration.storage?.strategy,
      directory: configuration.storage?.directory,
      projectRoot,
      agentName: manifest.key ?? manifest.name,
    });
  },
  syncProject({ configuration, bundle, projectRoot }) {
    if (!configuration.amarsia?.key) {
      return;
    }
    syncAmarsiaProject({
      key: configuration.amarsia.key,
      endpoint: configuration.amarsia.endpoint,
      bundle,
      projectRoot,
    });
  },
};
