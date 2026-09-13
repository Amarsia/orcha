import { GoogleGenAI } from "@google/genai/node";
import type { ProviderConfiguration } from "../types.js";
import { generateGoogleContent } from "./google-gemini.js";
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";

export const vertexAIProvider: ProviderAdapter = {
  name: "vertexai",
  generate: generateVertexAI,
};

async function generateVertexAI(
  configuration: ProviderConfiguration,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  if (!configuration.project?.trim()) {
    throw new Error(
      'Missing Google Cloud project in orcha.init({ providers: { vertexai: { project: "...", location: "..." } } }).',
    );
  }
  if (!configuration.location?.trim()) {
    throw new Error(
      'Missing Google Cloud location in orcha.init({ providers: { vertexai: { project: "...", location: "..." } } }).',
    );
  }
  if (
    configuration.credentials &&
    (!configuration.credentials.clientEmail.trim() ||
      !configuration.credentials.privateKey.trim())
  ) {
    throw new Error(
      "Vertex AI service-account credentials require non-empty clientEmail and privateKey values.",
    );
  }

  const client = new GoogleGenAI({
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
  });
  return generateGoogleContent(client, request, "vertexai");
}
