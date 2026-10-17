import { BrowserIndexedDbSessionStore } from "../storage/browser-indexeddb.js";
import type { RuntimePlatform } from "./platform.js";
import { portableRandomUUID } from "./random-id.js";

export const browserRuntimePlatform: RuntimePlatform = {
  randomUUID: portableRandomUUID,
  projectRoot(configuration) {
    return configuration.root ?? "/";
  },
  createSessionStore({ configuration, manifest }) {
    const strategy = configuration.storage?.strategy ?? "indexeddb";
    if (strategy !== "indexeddb") {
      throw new Error(
        `Browser runtimes require storage strategy "indexeddb", received "${strategy}".`,
      );
    }
    return new BrowserIndexedDbSessionStore(
      manifest.key ?? manifest.name,
      configuration.storage?.directory ?? "orchajs",
    );
  },
};
