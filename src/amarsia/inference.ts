import { OrchaError } from "../errors.js";
import { readLocalFileContent } from "../file-content.js";
import { readServerSentEvents } from "../providers/sse.js";
import type {
  ProviderAssistantBlock,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  ProviderResponseGenerator,
  ProviderStopReason,
  ProviderToolCall,
} from "../providers/types.js";
import { parseStructuredOutput } from "../runtime/structured-output.js";
import type { MessageContent, ProviderName, Usage } from "../types.js";
import { resolveAmarsiaEndpoint } from "./endpoint.js";

interface GatewayResponse {
  id?: string;
  status?: "completed" | "failed" | "incomplete" | "in_progress";
  output?: GatewayOutputItem[];
  output_text?: string;
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
    cache_write_tokens?: number;
  };
  error?: { message?: string } | null;
}

interface GatewayOutputItem {
  type?: string;
  id?: string;
  content?: Array<Record<string, unknown>>;
  call_id?: string;
  name?: string;
  arguments?: string | Record<string, unknown>;
  summary?: Array<Record<string, unknown>>;
  encrypted_content?: string | null;
}

export interface AmarsiaInferenceConfiguration {
  key: string;
  endpoint?: string;
}

const SUPPORTED_AMARSIA_PROVIDERS = new Set<ProviderName>([
  "openai",
  "anthropic",
  "googlegenai",
  "vertexai",
  "deepseek",
]);

export function createAmarsiaInferenceGenerator(
  configuration: AmarsiaInferenceConfiguration,
): ProviderResponseGenerator {
  const endpoint = resolveAmarsiaEndpoint(configuration.endpoint);
  return (provider, _providerConfiguration, request) =>
    generateThroughAmarsia(endpoint, configuration.key, provider, request);
}

async function generateThroughAmarsia(
  endpoint: string,
  key: string,
  provider: ProviderName,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  if (!key.trim()) {
    throw new Error(
      "Amarsia inference requires a non-empty amarsia.key.",
    );
  }
  if (!SUPPORTED_AMARSIA_PROVIDERS.has(provider)) {
    throw new OrchaError(
      "unsupported_provider_capability",
      `Amarsia inference supports only OpenAI, Anthropic, Google GenAI, Vertex AI, and DeepSeek; received "${provider}".`,
    );
  }
  if (request.outputType === "image" || request.outputType === "audio") {
    throw new OrchaError(
      "unsupported_provider_capability",
      `Amarsia Responses does not support "${request.outputType}" as a direct agent output.`,
    );
  }

  const gatewayProvider =
    provider === "vertexai" ? "googlegenai" : provider;
  const body: Record<string, unknown> = {
    provider: gatewayProvider,
    model: request.model,
    instructions: request.systemPrompt,
    input: await toResponsesInput(request.messages),
    ...(provider === "vertexai"
      ? { region: "global" }
      : request.region && request.region !== "provider_managed"
      ? { region: request.region }
      : {}),
    ...(request.maxTokens
      ? { max_output_tokens: request.maxTokens }
      : {}),
    ...(request.publishOutput ? { stream: true } : {}),
  };
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }
  if (request.outputType === "json") {
    body.text = {
      format: {
        type: "json_schema",
        name: "orcha_output",
        schema: request.outputSchema ?? {},
        strict: true,
      },
    };
  }
  body.reasoning = {
    summary: "auto",
    ...(request.reasoningLevel ? { effort: request.reasoningLevel } : {}),
  };
  body.include = ["reasoning.encrypted_content"];
  if (request.trace) {
    body.metadata = {
      agent_external_id: request.trace.agentExternalId,
      session_id: request.trace.sessionId,
    };
  }

  const response = await fetch(`${endpoint}/v3/model/v1/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
    signal: request.signal,
  });
  if (!response.ok) {
    const message = await responseError(response);
    throw new Error(
      message ??
        `Amarsia inference request failed with HTTP ${response.status}.`,
    );
  }

  const responseBody = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? await readGatewayStream(response, request.publishOutput)
    : ((await response.json()) as GatewayResponse);
  return toProviderResponse(request, responseBody);
}

async function toResponsesInput(
  messages: ProviderMessage[],
): Promise<unknown[]> {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      input.push({
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : await Promise.all(
                message.content.map(toResponsesUserContent),
              ),
      });
      continue;
    }
    if (message.role === "tool") {
      for (const result of message.results) {
        input.push({
          type: "function_call_output",
          call_id: result.callId,
          output: JSON.stringify(result.output ?? null),
          ...(result.isError ? { is_error: true } : {}),
        });
      }
      continue;
    }
    for (const block of message.content) {
      if (block.type === "text") {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text: block.text }],
        });
      } else if (block.type === "tool_call") {
        input.push({
          type: "function_call",
          call_id: block.callId,
          name: block.name,
          arguments: JSON.stringify(block.arguments),
          ...(block.replay?.providerId
            ? { id: block.replay.providerId }
            : {}),
          ...(block.replay?.opaqueData
            ? { encrypted_content: block.replay.opaqueData }
            : {}),
        });
      } else {
        input.push({
          type: "reasoning",
          ...(block.replay?.providerId
            ? { id: block.replay.providerId }
            : {}),
          summary: block.text
            ? [{ type: "summary_text", text: block.text }]
            : [],
          ...(block.replay?.opaqueData
            ? { encrypted_content: block.replay.opaqueData }
            : {}),
        });
      }
    }
  }
  return input;
}

async function toResponsesUserContent(
  content: MessageContent,
): Promise<unknown> {
  if (content.type === "text") {
    return { type: "input_text", text: content.text };
  }
  if (content.type === "file") {
    const file = await readLocalFileContent(content);
    return content.mimeType.startsWith("image/")
      ? {
          type: "input_image",
          image_url: file.dataUri,
          detail: "auto",
        }
      : {
          type: "input_file",
          file_data: file.dataUri,
          filename: file.fileName,
        };
  }
  if (content.type === "image") {
    return {
      type: "input_image",
      image_url: content.fileUri,
      detail: "auto",
    };
  }
  if (content.type === "url") {
    return { type: "input_file", file_url: content.fileUri };
  }
  throw new OrchaError(
    "unsupported_content_type",
    `Amarsia Responses does not support ${content.type} content from a URI.`,
  );
}

async function readGatewayStream(
  response: Response,
  publishOutput?: (output: string) => void,
): Promise<GatewayResponse> {
  let text = "";
  let terminal: GatewayResponse | undefined;
  for await (const event of readServerSentEvents(response)) {
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      text += event.delta;
      publishOutput?.(text);
    } else if (
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    ) {
      if (!isRecord(event.response)) {
        throw new Error(
          "Amarsia returned an invalid terminal stream event.",
        );
      }
      terminal = event.response as GatewayResponse;
    } else if (
      event.type === "response.failed" ||
      event.type === "error"
    ) {
      const error = isRecord(event.error) ? event.error : event;
      throw new Error(
        typeof error.message === "string"
          ? error.message
          : "Amarsia inference streaming request failed.",
      );
    }
  }
  if (!terminal) {
    throw new Error(
      "Amarsia inference stream ended without a terminal response.",
    );
  }
  return terminal;
}

function toProviderResponse(
  request: ProviderRequest,
  response: GatewayResponse,
): ProviderResponse {
  if (response.status === "failed") {
    throw new Error(
      response.error?.message ?? "Amarsia failed to generate a response.",
    );
  }
  if (
    response.status === "incomplete" &&
    response.incomplete_details?.reason !== "max_output_tokens"
  ) {
    throw new Error(
      `Amarsia returned an incomplete response: ${
        response.incomplete_details?.reason ?? "unknown reason"
      }.`,
    );
  }

  const content: ProviderAssistantBlock[] = [];
  let refused = false;
  for (const item of response.output ?? []) {
    if (item.type === "message") {
      for (const part of item.content ?? []) {
        if (
          part.type === "output_text" &&
          typeof part.text === "string"
        ) {
          content.push({ type: "text", text: part.text });
        } else if (
          part.type === "refusal" &&
          typeof part.refusal === "string"
        ) {
          refused = true;
          content.push({ type: "text", text: part.refusal });
        }
      }
    } else if (
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string"
    ) {
      content.push({
        type: "tool_call",
        callId: item.call_id,
        name: item.name,
        arguments: parseArguments(item.arguments, item.name),
        replay: replay(item),
      });
    } else if (item.type === "reasoning") {
      content.push({
        type: "reasoning",
        text: [...(item.content ?? []), ...(item.summary ?? [])]
          .filter(
            (part) =>
              (part.type === "reasoning_text" ||
                part.type === "summary_text") &&
              typeof part.text === "string",
          )
          .map((part) => part.text as string)
          .join(""),
        replay: replay(item),
      });
    } else {
      throw new Error(
        `Amarsia returned unsupported output item "${String(item.type)}".`,
      );
    }
  }

  const toolCalls = content.filter(
    (block): block is ProviderToolCall => block.type === "tool_call",
  );
  const textOutput =
    response.output_text ??
    content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  const stopReason = normalizeStopReason(response, toolCalls, refused);
  const output =
    request.outputType === "json" &&
    toolCalls.length === 0 &&
    stopReason !== "max_tokens"
      ? parseStructuredOutput(textOutput, request.outputSchema ?? {})
      : textOutput;
  if (textOutput) {
    request.publishOutput?.(textOutput);
  }
  return {
    output,
    responseId: response.id,
    stopReason,
    content,
    toolCalls,
    usage: normalizeUsage(response.usage),
  };
}

function replay(item: GatewayOutputItem):
  | { providerId?: string; opaqueData?: string }
  | undefined {
  const value = {
    ...(typeof item.id === "string" ? { providerId: item.id } : {}),
    ...(typeof item.encrypted_content === "string"
      ? { opaqueData: item.encrypted_content }
      : {}),
  };
  return Object.keys(value).length > 0 ? value : undefined;
}

function parseArguments(
  value: GatewayOutputItem["arguments"],
  name: string,
): Record<string, unknown> {
  const parsed =
    typeof value === "string" ? JSON.parse(value) : value;
  if (!isRecord(parsed)) {
    throw new Error(
      `Amarsia returned non-object arguments for tool "${name}".`,
    );
  }
  return parsed;
}

function normalizeStopReason(
  response: GatewayResponse,
  toolCalls: ProviderToolCall[],
  refused: boolean,
): ProviderStopReason {
  if (refused) return "content_filter";
  if (toolCalls.length > 0) return "tool_call";
  if (response.status === "incomplete") {
    return response.incomplete_details?.reason === "max_output_tokens"
      ? "max_tokens"
      : "unknown";
  }
  return response.status === "completed" ? "end_turn" : "unknown";
}

function normalizeUsage(usage: GatewayResponse["usage"]): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens:
      usage?.output_tokens_details?.reasoning_tokens ?? null,
    cacheReadTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: usage?.cache_write_tokens ?? 0,
  };
}

async function responseError(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
      message?: string;
    };
    return body.error?.message ?? body.message;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
