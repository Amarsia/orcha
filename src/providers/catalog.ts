import type { ProviderName } from "../types.js";

export interface BuiltInProviderDescriptor {
  moduleFile: string;
  exportName: string;
}

export const builtInProviderCatalog = {
  anthropic: {
    moduleFile: "anthropic.js",
    exportName: "anthropicProvider",
  },
  deepseek: {
    moduleFile: "deepseek.js",
    exportName: "deepSeekProvider",
  },
  googlegenai: {
    moduleFile: "google-genai.js",
    exportName: "googleGenAIProvider",
  },
  openai: {
    moduleFile: "openai.js",
    exportName: "openAIProvider",
  },
} as const satisfies Partial<
  Record<ProviderName, BuiltInProviderDescriptor>
>;

export function isBuiltInProvider(
  name: string,
): name is keyof typeof builtInProviderCatalog {
  return Object.hasOwn(builtInProviderCatalog, name);
}
