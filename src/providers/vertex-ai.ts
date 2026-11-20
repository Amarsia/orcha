import { GoogleGenAI } from "@google/genai/node";
import type {
  ProviderConfiguration,
  VertexAIProviderConfiguration,
} from "../types.js";
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

const vertexClientPool = new ClientPool<GoogleGenAI>({ maxEntries: 16 });

export const vertexAIProvider: ProviderAdapter = {
  name: "vertexai",
  generate: generateVertexAI,
};

function validateVertexConfiguration(
  configuration: ProviderConfiguration,
): VertexAIProviderConfiguration {
  const vertexConfiguration = configuration as VertexAIProviderConfiguration;
  if (!vertexConfiguration.project?.trim()) {
    throw new Error(
      'Missing Google Cloud project in orcha.init({ providers: { vertexai: { project: "...", location: "..." } } }).',
    );
  }
  if (!vertexConfiguration.location?.trim()) {
    throw new Error(
      'Missing Google Cloud location in orcha.init({ providers: { vertexai: { project: "...", location: "..." } } }).',
    );
  }
  if (
    vertexConfiguration.credentials &&
    (!vertexConfiguration.credentials.clientEmail.trim() ||
      !vertexConfiguration.credentials.privateKey.trim())
  ) {
    throw new Error(
      "Vertex AI service-account credentials require non-empty clientEmail and privateKey values.",
    );
  }
  return vertexConfiguration;
}

async function generateVertexAI(
  configuration: ProviderConfiguration,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const vertexConfiguration = validateVertexConfiguration(configuration);
  const client = getPooledVertexClient(vertexConfiguration);
  return generateGoogleContent(
    toGoogleContentClient(client),
    request,
    "vertexai",
  );
}

function getPooledVertexClient(
  configuration: VertexAIProviderConfiguration,
): GoogleGenAI {
  const cacheKey = JSON.stringify([
    configuration.project,
    configuration.location,
    configuration.baseUrl ?? "",
    configuration.credentials?.clientEmail ?? "",
    configuration.credentials?.privateKey ?? "",
  ]);
  return vertexClientPool.getOrCreate(
    cacheKey,
    () =>
      new GoogleGenAI({
        vertexai: true,
        apiVersion: "v1",
        project: configuration.project,
        location: configuration.location,
        ...(configuration.credentials
          ? {
              googleAuthOptions: {
                credentials: {
                  client_email: configuration.credentials.clientEmail,
                  private_key: configuration.credentials.privateKey,
                },
              },
            }
          : {}),
        ...(configuration.baseUrl
          ? { httpOptions: { baseUrl: configuration.baseUrl } }
          : {}),
      }),
  );
}
