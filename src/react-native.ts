import { generateBrowserProviderResponse } from "./providers/browser.js";
import { setNativeRuntimeLoader } from "./runtime/actions/execute.js";
import { createOrcha } from "./runtime/create-orcha.js";
import { reactNativeRuntimePlatform } from "./runtime/platform-react-native.js";

setNativeRuntimeLoader(async () => {
  const modulePath = "./runtime/actions/browser-native.js";
  return import(modulePath);
});

export const orcha = createOrcha(
  () => {
    throw new Error(
      "The React Native runtime requires a precompiled Orcha bundle. Configure the Orcha Metro integration.",
    );
  },
  generateBrowserProviderResponse,
  reactNativeRuntimePlatform,
);

export * from "./runtime-entry.js";
