import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { syncAmarsiaProject } from "../amarsia/sync.js";
import { createSessionStore } from "../storage/create-store.js";
import { createCloudSessionStore } from "./optional-features.js";
import type { RuntimePlatform } from "./platform.js";

export const nodeRuntimePlatform: RuntimePlatform = {
  randomUUID,
  projectRoot(configuration) {
    return resolve(
      configuration.root ??
        process.env.ORCHA_PROJECT_ROOT ??
        process.cwd(),
    );
  },
  createSessionStore({ configuration, projectRoot, manifest }) {
    const strategy = configuration.storage?.strategy;
    const local = createSessionStore({
      strategy: strategy === "cloud" ? "node-jsonl" : strategy,
      directory: configuration.storage?.directory,
      projectRoot,
      agentName: manifest.key ?? manifest.name,
    });
    if (strategy !== "cloud") {
      return local;
    }
    if (!configuration.amarsia?.key) {
      throw new Error('Storage strategy "cloud" requires amarsia.key.');
    }
    return createCloudSessionStore({
      local,
      key: configuration.amarsia.key,
      endpoint: configuration.amarsia.endpoint,
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
