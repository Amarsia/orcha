import { ReactNativeJsonlSessionStore } from "../storage/react-native-jsonl.js";
import type { RuntimePlatform } from "./platform.js";
import { createCloudSessionStore } from "./optional-features.js";
import { portableRandomUUID } from "./random-id.js";

export const reactNativeRuntimePlatform: RuntimePlatform = {
  randomUUID: portableRandomUUID,
  projectRoot(configuration) {
    return configuration.root ?? "/";
  },
  createSessionStore({ configuration, manifest }) {
    const strategy = configuration.storage?.strategy ?? "react-native";
    if (strategy !== "react-native" && strategy !== "cloud") {
      throw new Error(
        `React Native requires storage strategy "react-native" or "cloud", received "${strategy}".`,
      );
    }
    const local = new ReactNativeJsonlSessionStore(
      manifest.key ?? manifest.name,
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
