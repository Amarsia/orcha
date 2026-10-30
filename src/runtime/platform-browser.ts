import { BrowserIndexedDbSessionStore } from "../storage/browser-indexeddb.js";
import type { RuntimePlatform } from "./platform.js";
import { createCloudSessionStore } from "./optional-features.js";
import { portableRandomUUID } from "./random-id.js";

export const browserRuntimePlatform: RuntimePlatform = {
  randomUUID: portableRandomUUID,
  projectRoot(configuration) {
    return configuration.root ?? "/";
  },
  createSessionStore({ configuration, manifest }) {
    const strategy = configuration.storage?.strategy ?? "indexeddb";
    if (strategy !== "indexeddb" && strategy !== "cloud") {
      throw new Error(
        `Browser runtimes require storage strategy "indexeddb" or "cloud", received "${strategy}".`,
      );
    }
    const local = new BrowserIndexedDbSessionStore(
      manifest.key ?? manifest.name,
      configuration.storage?.directory ?? "orchajs",
    );
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
};
