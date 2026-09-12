import {
  GoogleGenAI,
  type Content,
  type FinishReason,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
  type ThinkingLevel,
} from "@google/genai/web";
import { OrchaError } from "../errors.js";
import { parseStructuredOutput } from "../runtime/structured-output.js";
import type {
  MessageContent,
  ProviderConfiguration,
  ProviderName,
  Usage,
} from "../types.js";
import type {
  ProviderAdapter,
  ProviderAssistantBlock,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  ProviderStopReason,
  ProviderTextBlock,
  ProviderToolCall,
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
  if (request.outputType === "image" || request.outputType === "audio") {
    throw new OrchaError(
      "unsupported_provider_capability",
      `Google GenAI does not support "${request.outputType}" as a direct agent output.`,
    );
  }

  const client = new GoogleGenAI({
    apiKey: configuration.apiKey,
    ...(configuration.baseUrl
      ? { httpOptions: { baseUrl: configuration.baseUrl } }
      : {}),
  });
  const config: GenerateContentConfig = {
    systemInstruction: request.systemPrompt,
    ...(request.maxTokens
      ? { maxOutputTokens: request.maxTokens }
      : {}),
  };
  if (request.tools.length > 0) {
    config.tools = [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.parameters,
        })),
      },
    ];
  }
  if (request.outputType === "json") {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = request.outputSchema ?? {};
  }
  if (request.reasoningLevel) {
    config.thinkingConfig = {
      thinkingLevel: request.reasoningLevel as ThinkingLevel,
      includeThoughts: true,
    };
  }

  const stream = await client.models.generateContentStream({
    model: request.model,
    contents: toGoogleContents(request.messages),
    config,
  });
  const response = await collectGoogleStream(stream, request.publishOutput);
  return toProviderResponse(request, response);
}

interface CollectedGoogleResponse {
  responseId?: string;
  finishReason?: FinishReason;
  promptBlockReason?: string;
  parts: Part[];
  usage?: GenerateContentResponse["usageMetadata"];
}

async function collectGoogleStream(
  stream: AsyncGenerator<GenerateContentResponse>,
  publishOutput?: (output: string) => void,
): Promise<CollectedGoogleResponse> {
  const collected: CollectedGoogleResponse = { parts: [] };
  let cumulativeText = "";

  for await (const chunk of stream) {
    collected.responseId = chunk.responseId ?? collected.responseId;
    collected.usage = chunk.usageMetadata ?? collected.usage;
    collected.promptBlockReason =
      chunk.promptFeedback?.blockReason ?? collected.promptBlockReason;
    const candidate = chunk.candidates?.[0];
    collected.finishReason =
      candidate?.finishReason ?? collected.finishReason;

    for (const part of candidate?.content?.parts ?? []) {
      collected.parts.push(part);
      if (
        typeof part.text === "string" &&
        part.text &&
        part.thought !== true
      ) {
        cumulativeText += part.text;
        publishOutput?.(cumulativeText);
      }
    }
  }

  return collected;
}

function toProviderResponse(
  request: ProviderRequest,
  response: CollectedGoogleResponse,
): ProviderResponse {
  const content: ProviderAssistantBlock[] = [];
  let toolCallIndex = 0;

  for (const part of response.parts) {
    if (part.functionCall) {
      const call = part.functionCall;
      if (!call.name) {
        throw new Error("Google GenAI returned a function call without a name.");
      }
      const providerCallId = call.id;
      content.push({
        type: "tool_call",
        callId:
          providerCallId ??
          `${response.responseId ?? crypto.randomUUID()}:${toolCallIndex}`,
        name: call.name,
        arguments: call.args ?? {},
        ...(providerCallId || part.thoughtSignature
          ? {
              replay: {
                ...(providerCallId
                  ? { providerId: providerCallId }
                  : {}),
                ...(part.thoughtSignature
                  ? { opaqueData: part.thoughtSignature }
                  : {}),
              },
            }
          : {}),
      });
      toolCallIndex += 1;
      continue;
    }
    if (typeof part.text === "string") {
      appendGoogleTextPart(content, part);
      continue;
    }
    throw new Error("Google GenAI returned an unsupported response part.");
  }

  const toolCalls = content.filter(
    (block): block is ProviderToolCall => block.type === "tool_call",
  );
  const textOutput = content
    .filter(
      (block): block is ProviderTextBlock => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
  const output =
    request.outputType === "json" && toolCalls.length === 0
      ? parseStructuredOutput(textOutput, request.outputSchema ?? {})
      : textOutput;

  return {
    output,
    responseId: response.responseId,
    stopReason: normalizeStopReason(
      response.finishReason,
      toolCalls.length > 0,
      response.promptBlockReason !== undefined,
    ),
    content,
    toolCalls,
    usage: normalizeUsage(response.usage),
  };
}

function appendGoogleTextPart(
  content: ProviderAssistantBlock[],
  part: Part,
): void {
  const text = part.text ?? "";
  if (part.thought === true) {
    const previous = content.at(-1);
    if (previous?.type === "reasoning") {
      previous.text += text;
      if (part.thoughtSignature) {
        previous.replay = {
          ...previous.replay,
          opaqueData: part.thoughtSignature,
        };
      }
      return;
    }
    content.push({
      type: "reasoning",
      text,
      ...(part.thoughtSignature
        ? { replay: { opaqueData: part.thoughtSignature } }
        : {}),
    });
    return;
  }

  const previous = content.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }
  content.push({ type: "text", text });
}

function toGoogleContents(messages: ProviderMessage[]): Content[] {
  const contents: Content[] = [];
  const previousCalls = new Map<
    string,
    {
      name: string;
      providerCallId?: string;
    }
  >();

  for (const message of messages) {
    if (message.role === "user") {
      contents.push({
        role: "user",
        parts:
          typeof message.content === "string"
            ? [{ text: message.content }]
            : message.content.map(toGoogleUserPart),
      });
      continue;
    }
    if (message.role === "assistant") {
      const parts = message.content.map((block) => {
        if (block.type === "tool_call") {
          previousCalls.set(block.callId, {
            name: block.name,
            providerCallId:
              message.provider === "googlegenai"
                ? block.replay?.providerId
                : undefined,
          });
        }
        return toGoogleAssistantPart(block, message.provider);
      });
      contents.push({ role: "model", parts });
      continue;
    }

    contents.push({
      role: "user",
      parts: message.results.map((result) => {
        const call = previousCalls.get(result.callId);
        if (!call) {
          throw new Error(
            `Google GenAI could not match tool result "${result.callId}" to a prior function call.`,
          );
        }
        return {
          functionResponse: {
            name: call.name,
            ...(call.providerCallId
              ? { id: call.providerCallId }
              : {}),
            response: normalizeFunctionResponse(
              result.output,
              result.isError,
            ),
          },
        };
      }),
    });
  }
  return contents;
}

function toGoogleUserPart(content: MessageContent): Part {
  if (content.type === "text") {
    return { text: content.text };
  }
  if (!isGoogleFileUri(content.fileUri)) {
    throw new OrchaError(
      "unsupported_content_type",
      "Google GenAI requires media to use a Gemini Files API URI, a Google Cloud Storage URI, or an inline data URI.",
    );
  }
  if (content.fileUri.startsWith("data:")) {
    const parsed = parseDataUri(content.fileUri);
    return {
      inlineData: {
        mimeType: parsed.mimeType || content.mimeType,
        data: parsed.data,
      },
    };
  }
  return {
    fileData: {
      mimeType: content.mimeType,
      fileUri: content.fileUri,
    },
  };
}

function toGoogleAssistantPart(
  block: ProviderAssistantBlock,
  messageProvider: ProviderName | undefined,
): Part {
  if (block.type === "text") {
    return { text: block.text };
  }
  if (block.type === "reasoning") {
    if (messageProvider !== "googlegenai") {
      return { text: block.text };
    }
    return {
      text: block.text,
      thought: true,
      ...(block.replay?.opaqueData
        ? { thoughtSignature: block.replay.opaqueData }
        : {}),
    };
  }
  const replay =
    messageProvider === "googlegenai" ? block.replay : undefined;
  return {
    functionCall: {
      name: block.name,
      args: block.arguments,
      ...(replay?.providerId
        ? { id: replay.providerId }
        : {}),
    },
    ...(replay?.opaqueData
      ? { thoughtSignature: replay.opaqueData }
      : {}),
  };
}

function normalizeFunctionResponse(
  output: unknown,
  isError: boolean | undefined,
): Record<string, unknown> {
  if (isError) {
    return { error: output };
  }
  return isRecord(output) ? output : { output: output ?? null };
}

function normalizeStopReason(
  reason: FinishReason | undefined,
  hasToolCalls: boolean,
  promptBlocked: boolean,
): ProviderStopReason | undefined {
  if (promptBlocked) {
    return "content_filter";
  }
  if (hasToolCalls) {
    return "tool_call";
  }
  if (reason === "STOP") {
    return "end_turn";
  }
  if (reason === "MAX_TOKENS") {
    return "max_tokens";
  }
  if (
    reason === "SAFETY" ||
    reason === "RECITATION" ||
    reason === "BLOCKLIST" ||
    reason === "PROHIBITED_CONTENT" ||
    reason === "SPII" ||
    reason === "IMAGE_SAFETY" ||
    reason === "IMAGE_PROHIBITED_CONTENT"
  ) {
    return "content_filter";
  }
  return reason === undefined ? undefined : "unknown";
}

function normalizeUsage(
  usage: GenerateContentResponse["usageMetadata"],
): Usage {
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    reasoningTokens: usage?.thoughtsTokenCount ?? null,
    cacheReadTokens: usage?.cachedContentTokenCount ?? 0,
    cacheWriteTokens: 0,
  };
}

function isGoogleFileUri(uri: string): boolean {
  return (
    uri.startsWith("data:") ||
    uri.startsWith("gs://") ||
    uri.startsWith("https://generativelanguage.googleapis.com/")
  );
}

function parseDataUri(uri: string): {
  mimeType: string;
  data: string;
} {
  const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(uri);
  if (!match) {
    throw new OrchaError(
      "unsupported_content_type",
      "Google GenAI inline media must be a base64-encoded data URI.",
    );
  }
  return {
    mimeType: match[1] ?? "",
    data: match[2],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
