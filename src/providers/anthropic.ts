import type {
  ProviderConfiguration,
  Usage,
} from "../types.js";
import { OrchaError } from "../errors.js";
import { parseStructuredOutput } from "../runtime/structured-output.js";
import { readServerSentEvents } from "./sse.js";
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

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  data?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AnthropicResponse {
  id?: string;
  stop_reason?: string | null;
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export const anthropicProvider: ProviderAdapter = {
  name: "anthropic",
  generate: generateAnthropic,
};

async function generateAnthropic(
  provider: ProviderConfiguration,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  if (!provider.apiKey?.trim()) {
    throw new Error(
      'Missing Anthropic API key in orcha.init({ providers: { anthropic: "..." } }).',
    );
  }

  if (request.outputType === "image" || request.outputType === "audio") {
    throw new OrchaError(
      "unsupported_provider_capability",
      `Anthropic does not support "${request.outputType}" agent output.`,
    );
  }

  const reasoning = getReasoningConfiguration(request);
  const systemPrompt =
    request.outputType === "json"
      ? `${request.systemPrompt}\n\nReturn only valid JSON matching this JSON Schema:\n${JSON.stringify(request.outputSchema)}`
      : request.systemPrompt;
  const requestBody: Record<string, unknown> = {
    model: request.model,
    max_tokens: reasoning.maxTokens,
    system: systemPrompt,
    messages: toAnthropicMessages(request.messages),
    ...(request.publishOutput ? { stream: true } : {}),
  };
  const tools = request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
  if (tools.length > 0) {
    requestBody.tools = tools;
  }

  if (reasoning.thinking) {
    requestBody.thinking = reasoning.thinking;
    if (reasoning.outputConfig) {
      requestBody.output_config = reasoning.outputConfig;
    }
  }

  const response = await fetch(
    `${provider.baseUrl ?? "https://api.anthropic.com"}/v1/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    const body = (await response.json()) as AnthropicResponse;
    throw new Error(
      body.error?.message ?? `Anthropic request failed with HTTP ${response.status}.`,
    );
  }

  const body = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? await readAnthropicStream(response, request.publishOutput)
    : ((await response.json()) as AnthropicResponse);
  return toProviderResponse(request, body);
}

function toProviderResponse(
  request: ProviderRequest,
  body: AnthropicResponse,
): ProviderResponse {
  const content = (body.content ?? []).map(toProviderContentBlock);
  const textOutput = content
    .filter((item): item is ProviderTextBlock => item.type === "text")
    .map((item) => item.text)
    .join("");
  const toolCalls = content.filter(
    (item): item is ProviderToolCall => item.type === "tool_call",
  );
  const output =
    request.outputType === "json" && toolCalls.length === 0
      ? parseStructuredOutput(textOutput, request.outputSchema ?? {})
      : textOutput;
  if (textOutput && request.publishOutput) {
    request.publishOutput(textOutput);
  }

  return {
    output,
    responseId: body.id,
    stopReason: normalizeStopReason(body.stop_reason),
    content,
    toolCalls,
    usage: {
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      reasoningTokens: null,
      cacheReadTokens: body.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: body.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

function normalizeStopReason(
  reason: string | null | undefined,
): ProviderStopReason | undefined {
  if (reason === undefined || reason === null) {
    return undefined;
  }
  if (reason === "end_turn" || reason === "stop_sequence") {
    return "end_turn";
  }
  if (reason === "tool_use") {
    return "tool_call";
  }
  if (reason === "max_tokens") {
    return "max_tokens";
  }
  if (reason === "refusal") {
    return "content_filter";
  }
  return "unknown";
}

function toProviderContentBlock(
  block: AnthropicContentBlock,
): ProviderAssistantBlock {
  if (block.type === "text" && typeof block.text === "string") {
    return { type: "text", text: block.text };
  }
  if (block.type === "thinking" && typeof block.thinking === "string") {
    return {
      type: "reasoning",
      text: block.thinking,
      provider: "anthropic",
      ...(typeof block.signature === "string"
        ? { opaqueData: block.signature }
        : {}),
    };
  }
  if (block.type === "redacted_thinking" && typeof block.data === "string") {
    return {
      type: "reasoning",
      text: "",
      provider: "anthropic",
      opaqueData: block.data,
    };
  }
  if (
    block.type === "tool_use" &&
    typeof block.id === "string" &&
    typeof block.name === "string"
  ) {
    return {
      type: "tool_call",
      callId: block.id,
      name: block.name,
      arguments: block.input ?? {},
    };
  }
  throw new Error(`Anthropic returned unsupported content block "${block.type}".`);
}

async function readAnthropicStream(
  response: Response,
  publishOutput?: (output: string) => void,
): Promise<AnthropicResponse> {
  const body: AnthropicResponse = {
    content: [],
    usage: {},
  };
  const partialToolInputs = new Map<number, string>();
  let cumulativeText = "";

  for await (const event of readServerSentEvents(response)) {
    applyAnthropicStreamEvent(
      event,
      body,
      partialToolInputs,
      (textDelta) => {
        cumulativeText += textDelta;
        publishOutput?.(cumulativeText);
      },
    );
  }

  for (const [index, input] of partialToolInputs) {
    const block = body.content?.[index];
    if (block?.type === "tool_use") {
      block.input = input ? parseToolInput(input, block.name) : {};
    }
  }
  return body;
}

function applyAnthropicStreamEvent(
  event: Record<string, unknown>,
  body: AnthropicResponse,
  partialToolInputs: Map<number, string>,
  publishTextDelta: (text: string) => void,
): void {
  if (event.type === "error") {
    const error = isRecord(event.error) ? event.error : {};
    throw new Error(
      typeof error.message === "string"
        ? error.message
        : "Anthropic streaming request failed.",
    );
  }

  if (event.type === "message_start" && isRecord(event.message)) {
    const message = event.message;
    body.id = typeof message.id === "string" ? message.id : undefined;
    if (isRecord(message.usage)) {
      body.usage = {
        input_tokens: numberOrUndefined(message.usage.input_tokens),
        output_tokens: numberOrUndefined(message.usage.output_tokens),
        cache_read_input_tokens: numberOrUndefined(
          message.usage.cache_read_input_tokens,
        ),
        cache_creation_input_tokens: numberOrUndefined(
          message.usage.cache_creation_input_tokens,
        ),
      };
    }
    return;
  }

  const index = numberOrUndefined(event.index);
  if (index === undefined) {
    if (event.type === "message_delta" && isRecord(event.delta)) {
      body.stop_reason =
        typeof event.delta.stop_reason === "string"
          ? event.delta.stop_reason
          : body.stop_reason;
      if (isRecord(event.usage)) {
        body.usage = {
          ...body.usage,
          output_tokens:
            numberOrUndefined(event.usage.output_tokens) ??
            body.usage?.output_tokens,
        };
      }
    }
    return;
  }

  if (
    event.type === "content_block_start" &&
    isRecord(event.content_block) &&
    typeof event.content_block.type === "string"
  ) {
    const block = {
      ...event.content_block,
      type: event.content_block.type,
    } as AnthropicContentBlock;
    if (block.type === "tool_use") {
      block.input = {};
      partialToolInputs.set(index, "");
    }
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      publishTextDelta(block.text);
    }
    if (!body.content) {
      body.content = [];
    }
    body.content[index] = block;
    return;
  }

  if (event.type !== "content_block_delta" || !isRecord(event.delta)) {
    return;
  }
  const block = body.content?.[index];
  if (!block) {
    throw new Error(
      `Anthropic streamed a delta for unknown content block ${index}.`,
    );
  }
  const delta = event.delta;
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    block.text = `${block.text ?? ""}${delta.text}`;
    publishTextDelta(delta.text);
  } else if (
    delta.type === "thinking_delta" &&
    typeof delta.thinking === "string"
  ) {
    block.thinking = `${block.thinking ?? ""}${delta.thinking}`;
  } else if (
    delta.type === "signature_delta" &&
    typeof delta.signature === "string"
  ) {
    block.signature = `${block.signature ?? ""}${delta.signature}`;
  } else if (
    delta.type === "input_json_delta" &&
    typeof delta.partial_json === "string"
  ) {
    partialToolInputs.set(
      index,
      `${partialToolInputs.get(index) ?? ""}${delta.partial_json}`,
    );
  }
}

function parseToolInput(
  input: string,
  toolName: string | undefined,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw new Error(
      `Anthropic returned invalid arguments for tool "${toolName ?? "unknown"}".`,
      { cause: error },
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(
      `Anthropic returned non-object arguments for tool "${toolName ?? "unknown"}".`,
    );
  }
  return parsed;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function toAnthropicMessages(
  messages: ProviderMessage[],
): Array<{ role: "user" | "assistant"; content: string | unknown[] }> {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content.map((block) => {
          if (block.type === "text") {
            return block;
          }
          if (block.type === "reasoning") {
            if (block.provider !== "anthropic") {
              return {
                type: "text",
                text: block.text,
              };
            }
            return !block.text && block.opaqueData
              ? {
                  type: "redacted_thinking",
                  data: block.opaqueData,
                }
              : {
                  type: "thinking",
                  thinking: block.text,
                  signature: block.opaqueData,
                };
          }
          return {
            type: "tool_use",
            id: block.callId,
            name: block.name,
            input: block.arguments,
          };
        }),
      };
    }
    if (message.role === "tool") {
      return {
        role: "user",
        content: message.results.map((result) => ({
          type: "tool_result",
          tool_use_id: result.callId,
          content: JSON.stringify(result.output ?? null),
          ...(result.isError ? { is_error: true } : {}),
        })),
      };
    }
    if (typeof message.content === "string") {
      return message;
    }
    return {
      role: "user",
      content: message.content.map((block) => {
        if (!isRecord(block) || typeof block.type !== "string") {
          throw new OrchaError(
            "invalid_input",
            "Anthropic message content contains an invalid block.",
          );
        }
        if (
          block.type === "text"
        ) {
          return block;
        }
        if (
          block.type === "image" &&
          typeof block.fileUri === "string"
        ) {
          return {
            type: "image",
            source: {
              type: "url",
              url: block.fileUri,
            },
          };
        }
        if (
          block.type === "url" &&
          typeof block.fileUri === "string" &&
          block.mimeType === "application/pdf"
        ) {
          return {
            type: "document",
            source: {
              type: "url",
              url: block.fileUri,
            },
          };
        }
        throw new OrchaError(
          "unsupported_content_type",
          `Anthropic does not support content type "${block.type}" with MIME type "${String(block.mimeType)}".`,
        );
      }),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getReasoningConfiguration(request: ProviderRequest): {
  maxTokens: number;
  thinking?: Record<string, unknown>;
  outputConfig?: Record<string, unknown>;
} {
  const baseMaxTokens = request.maxTokens ?? 10_000;
  if (!request.reasoningLevel) {
    return { maxTokens: baseMaxTokens };
  }
  return {
    maxTokens: baseMaxTokens,
    thinking: { type: "adaptive" },
    outputConfig: { effort: request.reasoningLevel },
  };
}
