import { createAmarsiaInferenceGenerator } from "./amarsia/inference.js";
import { generateBrowserProviderResponse } from "./providers/browser.js";
import { setNativeRuntimeLoader } from "./runtime/actions/execute.js";
import { createOrcha } from "./runtime/create-orcha.js";
import {
  setCloudSessionStoreFactory,
  setInferenceGeneratorFactory,
} from "./runtime/optional-features.js";
import { browserRuntimePlatform } from "./runtime/platform-browser.js";
import { CloudSessionStore } from "./storage/cloud.js";

setNativeRuntimeLoader(async () => {
  const modulePath = "./runtime/actions/browser-native.js";
  return import(modulePath);
});
setInferenceGeneratorFactory(createAmarsiaInferenceGenerator);
setCloudSessionStoreFactory((options) => new CloudSessionStore(options));

export const orcha = createOrcha(
  () => {
    throw new Error(
      "The browser runtime requires a precompiled Orcha bundle. Configure the Orcha integration for your application bundler.",
    );
  },
  generateBrowserProviderResponse,
  browserRuntimePlatform,
);

export * from "./runtime-entry.js";
