import type {
  CompiledAgentManifest,
  ProviderConfiguration,
  Usage,
} from "../types.js";
import { OrchaError } from "../errors.js";
import { parseStructuredOutput } from "../runtime/structured-output.js";

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | unknown[];
}

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

export interface ModelResponse {
  output: unknown;
  responseId?: string;
  stopReason?: string | null;
  content: AnthropicContentBlock[];
  toolCalls: Array<{
    callId: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: Usage;
}

export async function callAnthropic(
  agent: CompiledAgentManifest,
  provider: ProviderConfiguration,
  messages: AnthropicMessage[],
  toolNames: string[] = [],
  prompt = agent.systemPrompt,
  publishOutput?: (output: string) => void,
): Promise<ModelResponse> {
  if (!provider.apiKey?.trim()) {
    throw new Error(
      'Missing Anthropic API key in orcha.init({ providers: { anthropic: "..." } }).',
    );
  }

  const reasoning = getReasoningConfiguration(agent);
  const systemPrompt =
    agent.outputType === "json"
      ? `${prompt}\n\nReturn only valid JSON matching this JSON Schema:\n${JSON.stringify(agent.outputSchema)}`
      : prompt;
  const requestBody: Record<string, unknown> = {
    model: agent.model,
    max_tokens: reasoning.maxTokens,
    system: systemPrompt,
    messages: toAnthropicMessages(messages),
    ...(publishOutput ? { stream: true } : {}),
  };
  const tools = toolNames
    .map((name) => agent.actions[name])
    .filter((action) => action !== undefined)
    .map((action) => ({
      name: action.name,
      description: action.description,
      input_schema: action.parameters,
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
    ? await readAnthropicStream(response, publishOutput)
    : ((await response.json()) as AnthropicResponse);
  return toModelResponse(agent, body, publishOutput);
}

function toModelResponse(
  agent: CompiledAgentManifest,
  body: AnthropicResponse,
  publishOutput?: (output: string) => void,
): ModelResponse {
  const content = body.content ?? [];
  const textOutput = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
  const toolCalls = content.flatMap((item) =>
    item.type === "tool_use" && item.id && item.name
      ? [
          {
            callId: item.id,
            name: item.name,
            arguments: item.input ?? {},
          },
        ]
      : [],
  );
  const output =
    agent.outputType === "json" && toolCalls.length === 0
      ? parseStructuredOutput(textOutput, agent.outputSchema ?? {})
      : textOutput;
  if (textOutput && publishOutput) {
    publishOutput(textOutput);
  }

  return {
    output,
    responseId: body.id,
    stopReason: body.stop_reason,
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

async function readAnthropicStream(
  response: Response,
  publishOutput?: (output: string) => void,
): Promise<AnthropicResponse> {
  if (!response.body) {
    throw new Error("Anthropic returned an empty streaming response.");
  }

  const body: AnthropicResponse = {
    content: [],
    usage: {},
  };
  const partialToolInputs = new Map<number, string>();
  let cumulativeText = "";
  let buffer = "";
  let dataLines: string[] = [];

  const dispatchEvent = (): void => {
    if (dataLines.length === 0) {
      return;
    }
    const rawData = dataLines.join("\n");
    dataLines = [];
    if (rawData === "[DONE]") {
      return;
    }
    const event = JSON.parse(rawData) as Record<string, unknown>;
    applyAnthropicStreamEvent(
      event,
      body,
      partialToolInputs,
      (textDelta) => {
        cumulativeText += textDelta;
        publishOutput?.(cumulativeText);
      },
    );
  };

  const processLine = (line: string): void => {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!normalized) {
      dispatchEvent();
      return;
    }
    if (normalized.startsWith("data:")) {
      dataLines.push(normalized.slice(5).trimStart());
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      processLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
    if (done) {
      break;
    }
  }
  if (buffer) {
    processLine(buffer);
  }
  dispatchEvent();

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
  messages: AnthropicMessage[],
): AnthropicMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant" || typeof message.content === "string") {
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
          block.type === "text" ||
          block.type === "tool_result"
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

function getReasoningConfiguration(agent: CompiledAgentManifest): {
  maxTokens: number;
  thinking?: Record<string, unknown>;
  outputConfig?: Record<string, unknown>;
} {
  const level = agent.reasoningLevel ?? "disabled";
  const baseMaxTokens = agent.maxTokens ?? 1024;
  if (level === "disabled") {
    return { maxTokens: baseMaxTokens };
  }

  if (requiresAdaptiveThinking(agent.model)) {
    return {
      maxTokens: baseMaxTokens,
      thinking: { type: "adaptive" },
      outputConfig: { effort: level },
    };
  }

  const budget = {
    low: 1024,
    medium: 4096,
    high: 8192,
  }[level];
  return {
    maxTokens: baseMaxTokens + budget,
    thinking: {
      type: "enabled",
      budget_tokens: budget,
    },
  };
}

function requiresAdaptiveThinking(model: string): boolean {
  return [
    "claude-sonnet-4-6",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-opus-4-7",
    "claude-opus-4-8",
  ].some((name) => model.includes(name));
}
