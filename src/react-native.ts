import { createAmarsiaInferenceGenerator } from "./amarsia/inference.js";
import { generateBrowserProviderResponse } from "./providers/browser.js";
import { setNativeRuntimeLoader } from "./runtime/actions/execute.js";
import { compiledManifest } from "./runtime/compiled-manifest.js";
import { getGlobalCompiledManifest } from "./runtime/compiler-hook.js";
import { createOrcha, type OrchaClient } from "./runtime/create-orcha.js";
import {
  setCloudSessionStoreFactory,
  setInferenceGeneratorFactory,
} from "./runtime/optional-features.js";
import { reactNativeRuntimePlatform } from "./runtime/platform-react-native.js";
import { CloudSessionStore } from "./storage/cloud.js";

setNativeRuntimeLoader(async () => {
  const modulePath = "./runtime/actions/browser-native.js";
  return import(modulePath);
});
setInferenceGeneratorFactory(createAmarsiaInferenceGenerator);
setCloudSessionStoreFactory((options) => new CloudSessionStore(options));

const REACT_NATIVE_ORCHA_SINGLETON_KEY = Symbol.for(
  "orchajs.reactNativeRuntime",
);

function getSharedReactNativeOrcha(): OrchaClient {
  const globalRecord = globalThis as Record<
    symbol,
    OrchaClient | undefined
  >;
  if (!globalRecord[REACT_NATIVE_ORCHA_SINGLETON_KEY]) {
    globalRecord[REACT_NATIVE_ORCHA_SINGLETON_KEY] = createOrcha(
      () => {
        const manifest = getGlobalCompiledManifest() ?? compiledManifest;
        if (manifest) {
          return manifest;
        }
        throw new Error(
          'The React Native runtime requires a compiled Orcha manifest. Run "npx orchajs dev" or "npx orchajs build".',
        );
      },
      generateBrowserProviderResponse,
      reactNativeRuntimePlatform,
    );
  }
  return globalRecord[REACT_NATIVE_ORCHA_SINGLETON_KEY];
}

export const orcha: OrchaClient = getSharedReactNativeOrcha();

export * from "./runtime-entry.js";
