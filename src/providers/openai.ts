import { OrchaError } from "../errors.js";
import { parseStructuredOutput } from "../runtime/structured-output.js";
import type {
  MessageContent,
  ProviderConfiguration,
  Usage,
} from "../types.js";
import { readServerSentEvents } from "./sse.js";
import type {
  ProviderAdapter,
  ProviderAssistantBlock,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  ProviderStopReason,
  ProviderToolCall,
} from "./types.js";

interface OpenAIResponse {
  id?: string;
  status?: "completed" | "failed" | "incomplete" | "in_progress";
  output?: OpenAIOutputItem[];
  output_text?: string;
  incomplete_details?: {
    reason?: string;
  } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
    };
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
  error?: {
    message?: string;
  } | null;
}

interface OpenAIOutputItem {
  type?: string;
  id?: string;
  role?: string;
  status?: string;
  content?: Array<Record<string, unknown>>;
  call_id?: string;
  name?: string;
  arguments?: string;
  summary?: Array<Record<string, unknown>>;
  encrypted_content?: string | null;
}

export const openAIProvider: ProviderAdapter = {
  name: "openai",
  generate: generateOpenAI,
};

async function generateOpenAI(
  configuration: ProviderConfiguration,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  if (!configuration.apiKey?.trim()) {
    throw new Error(
      'Missing OpenAI API key in orcha.init({ providers: { openai: "..." } }).',
    );
  }
  if (request.outputType === "image" || request.outputType === "audio") {
    throw new OrchaError(
      "unsupported_provider_capability",
      `OpenAI Responses does not support "${request.outputType}" as a direct agent output.`,
    );
  }

  const body: Record<string, unknown> = {
    model: request.model,
    instructions: request.systemPrompt,
    input: toOpenAIInput(request.messages),
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
  if (request.reasoningLevel) {
    body.reasoning = {
      effort: request.reasoningLevel,
      summary: "auto",
    };
    body.include = ["reasoning.encrypted_content"];
  }

  const response = await fetch(
    `${configuration.baseUrl ?? "https://api.openai.com"}/v1/responses`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${configuration.apiKey}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errorBody = (await response.json()) as OpenAIResponse;
    throw new Error(
      errorBody.error?.message ??
        `OpenAI request failed with HTTP ${response.status}.`,
    );
  }

  const responseBody = response.headers
    .get("content-type")
    ?.includes("text/event-stream")
    ? await readOpenAIStream(response, request.publishOutput)
    : ((await response.json()) as OpenAIResponse);
  return toProviderResponse(request, responseBody);
}

function toOpenAIInput(messages: ProviderMessage[]): unknown[] {
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      input.push({
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : message.content.map(toOpenAIUserContent),
      });
      continue;
    }
    if (message.role === "tool") {
      for (const result of message.results) {
        input.push({
          type: "function_call_output",
          call_id: result.callId,
          output: JSON.stringify(result.output ?? null),
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
        });
      } else if (block.provider === "openai" && block.replayId) {
        input.push({
          type: "reasoning",
          id: block.replayId,
          summary: block.text
            ? [{ type: "summary_text", text: block.text }]
            : [],
          ...(block.opaqueData
            ? { encrypted_content: block.opaqueData }
            : {}),
        });
      } else if (block.text) {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text: block.text }],
        });
      }
    }
  }
  return input;
}

function toOpenAIUserContent(content: MessageContent): unknown {
  if (content.type === "text") {
    return { type: "input_text", text: content.text };
  }
  if (content.type === "image") {
    return {
      type: "input_image",
      image_url: content.fileUri,
      detail: "auto",
    };
  }
  if (content.type === "url") {
    return {
      type: "input_file",
      file_url: content.fileUri,
    };
  }
  throw new OrchaError(
    "unsupported_content_type",
    `OpenAI Responses does not support ${content.type} content from a URI.`,
  );
}

async function readOpenAIStream(
  response: Response,
  publishOutput?: (output: string) => void,
): Promise<OpenAIResponse> {
  let cumulativeText = "";
  let completedResponse: OpenAIResponse | undefined;

  for await (const event of readServerSentEvents(response)) {
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      cumulativeText += event.delta;
      publishOutput?.(cumulativeText);
      continue;
    }
    if (
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    ) {
      if (!isRecord(event.response)) {
        throw new Error("OpenAI returned an invalid terminal stream event.");
      }
      completedResponse = event.response as OpenAIResponse;
      continue;
    }
    if (event.type === "response.failed" || event.type === "error") {
      const error = isRecord(event.error) ? event.error : event;
      throw new Error(
        typeof error.message === "string"
          ? error.message
          : "OpenAI streaming request failed.",
      );
    }
  }

  if (!completedResponse) {
    throw new Error(
      "OpenAI streaming response ended without a terminal response.",
    );
  }
  return completedResponse;
}

function toProviderResponse(
  request: ProviderRequest,
  response: OpenAIResponse,
): ProviderResponse {
  if (response.status === "failed") {
    throw new Error(
      response.error?.message ?? "OpenAI failed to generate a response.",
    );
  }
  if (
    response.status === "incomplete" &&
    response.incomplete_details?.reason !== "max_output_tokens"
  ) {
    throw new Error(
      `OpenAI returned an incomplete response: ${
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
      continue;
    }
    if (
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string" &&
      typeof item.arguments === "string"
    ) {
      content.push({
        type: "tool_call",
        callId: item.call_id,
        name: item.name,
        arguments: parseFunctionArguments(item.arguments, item.name),
      });
      continue;
    }
    if (item.type === "reasoning" && typeof item.id === "string") {
      const reasoningText = [...(item.content ?? []), ...(item.summary ?? [])]
        .filter(
          (part) =>
            (part.type === "reasoning_text" ||
              part.type === "summary_text") &&
            typeof part.text === "string",
        )
        .map((part) => part.text as string)
        .join("");
      content.push({
        type: "reasoning",
        text: reasoningText,
        provider: "openai",
        replayId: item.id,
        ...(typeof item.encrypted_content === "string"
          ? { opaqueData: item.encrypted_content }
          : {}),
      });
      continue;
    }
    throw new Error(
      `OpenAI returned unsupported output item "${String(item.type)}".`,
    );
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
  const output =
    request.outputType === "json" && toolCalls.length === 0
      ? parseStructuredOutput(textOutput, request.outputSchema ?? {})
      : textOutput;
  if (textOutput) {
    request.publishOutput?.(textOutput);
  }

  return {
    output,
    responseId: response.id,
    stopReason: normalizeStopReason(response, toolCalls, refused),
    content,
    toolCalls,
    usage: normalizeUsage(response.usage),
  };
}

function parseFunctionArguments(
  argumentsJson: string,
  name: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch (error) {
    throw new Error(`OpenAI returned invalid arguments for tool "${name}".`, {
      cause: error,
    });
  }
  if (!isRecord(parsed)) {
    throw new Error(`OpenAI returned non-object arguments for tool "${name}".`);
  }
  return parsed;
}

function normalizeStopReason(
  response: OpenAIResponse,
  toolCalls: ProviderToolCall[],
  refused: boolean,
): ProviderStopReason {
  if (refused) {
    return "content_filter";
  }
  if (toolCalls.length > 0) {
    return "tool_call";
  }
  if (response.status === "incomplete") {
    return response.incomplete_details?.reason === "max_output_tokens"
      ? "max_tokens"
      : "unknown";
  }
  return response.status === "completed" ? "end_turn" : "unknown";
}

function normalizeUsage(usage: OpenAIResponse["usage"]): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    reasoningTokens:
      usage?.output_tokens_details?.reasoning_tokens ?? null,
    cacheReadTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    cacheWriteTokens: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
