import { ReactNativeJsonlSessionStore } from "../storage/react-native-jsonl.js";
import type { RuntimePlatform } from "./platform.js";

export const reactNativeRuntimePlatform: RuntimePlatform = {
  projectRoot(configuration) {
    return configuration.root ?? "/";
  },
  createSessionStore({ configuration, manifest }) {
    const strategy = configuration.storage?.strategy ?? "react-native";
    if (strategy !== "react-native") {
      throw new Error(
        `React Native requires storage strategy "react-native", received "${strategy}".`,
      );
    }
    return new ReactNativeJsonlSessionStore(manifest.key ?? manifest.name);
  },
};
