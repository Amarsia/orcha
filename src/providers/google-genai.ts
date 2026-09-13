import { GoogleGenAI } from "@google/genai/web";
import type { ProviderConfiguration } from "../types.js";
import { generateGoogleContent } from "./google-gemini.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";

export const googleGenAIProvider: ProviderAdapter = {
  name: "googlegenai",
  generate: generateGoogleGenAI,
};

async function generateGoogleGenAI(
  configuration: ProviderConfiguration,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  if (!configuration.apiKey?.trim()) {
    throw new Error(
      'Missing Google GenAI API key in orcha.init({ providers: { googlegenai: "..." } }).',
    );
  }

  const client = new GoogleGenAI({
    apiKey: configuration.apiKey,
    ...(configuration.baseUrl
      ? { httpOptions: { baseUrl: configuration.baseUrl } }
      : {}),
  });
  return generateGoogleContent(
    client,
    request,
    "googlegenai",
  );
}
