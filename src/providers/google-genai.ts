import { GoogleGenAI } from "@google/genai/web";
import type { ProviderConfiguration } from "../types.js";
import { ClientPool } from "./client-pool.js";
import {
  generateGoogleContent,
  toGoogleContentClient,
} from "./google-gemini.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";

const googleGenAIClientPool = new ClientPool<GoogleGenAI>({ maxEntries: 16 });

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

  const client = getPooledGoogleGenAIClient(configuration);
  return generateGoogleContent(
    toGoogleContentClient(client),
    request,
    "googlegenai",
  );
}

function getPooledGoogleGenAIClient(
  configuration: ProviderConfiguration,
): GoogleGenAI {
  const cacheKey = JSON.stringify([
    configuration.apiKey,
    configuration.baseUrl ?? "",
  ]);
  return googleGenAIClientPool.getOrCreate(
    cacheKey,
    () =>
      new GoogleGenAI({
        apiKey: configuration.apiKey,
        ...(configuration.baseUrl
          ? { httpOptions: { baseUrl: configuration.baseUrl } }
          : {}),
      }),
  );
}
