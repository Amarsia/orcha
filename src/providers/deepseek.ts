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

interface DeepSeekStreamChunk {
  id?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: DeepSeekUsage | null;
  error?: {
    message?: string;
  };
}

interface DeepSeekUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_cache_hit_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

interface PartialToolCall {
  id?: string;
  name: string;
  arguments: string;
}

interface CollectedDeepSeekResponse {
  id?: string;
  content: string;
  reasoningContent: string;
  toolCalls: PartialToolCall[];
  finishReason?: string | null;
  usage?: DeepSeekUsage;
}

export const deepSeekProvider: ProviderAdapter = {
  name: "deepseek",
  generate: generateDeepSeek,
};

async function generateDeepSeek(
  configuration: ProviderConfiguration,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  if (!configuration.apiKey?.trim()) {
    throw new Error(
      'Missing DeepSeek API key in orcha.init({ providers: { deepseek: "..." } }).',
    );
  }
  if (request.outputType === "image" || request.outputType === "audio") {
    throw new OrchaError(
      "unsupported_provider_capability",
      `DeepSeek does not support "${request.outputType}" agent output.`,
    );
  }

  const body: Record<string, unknown> = {
    model: request.model,
    messages: [
      {
        role: "system",
        content: systemPrompt(request),
      },
      ...toDeepSeekMessages(request.messages),
    ],
    stream: true,
    stream_options: {
      include_usage: true,
    },
    ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
  };
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
  if (request.outputType === "json") {
    body.response_format = { type: "json_object" };
  }
  if (request.reasoningLevel) {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = request.reasoningLevel;
  }

  const response = await fetch(
    `${configuration.baseUrl ?? "https://api.deepseek.com"}/chat/completions`,
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
    const error = (await response.json()) as DeepSeekStreamChunk;
    throw new Error(
      error.error?.message ??
        `DeepSeek request failed with HTTP ${response.status}.`,
    );
  }

  const collected = await collectDeepSeekStream(
    response,
    request.publishOutput,
  );
  return toProviderResponse(request, collected);
}

function systemPrompt(request: ProviderRequest): string {
  if (request.outputType !== "json") {
    return request.systemPrompt;
  }
  return `${request.systemPrompt}\n\nReturn only valid JSON matching this JSON Schema:\n${JSON.stringify(request.outputSchema ?? {})}`;
}

function toDeepSeekMessages(messages: ProviderMessage[]): unknown[] {
  const output: unknown[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      output.push({
        role: "user",
        content:
          typeof message.content === "string"
            ? message.content
            : textOnlyContent(message.content),
      });
      continue;
    }
    if (message.role === "tool") {
      for (const result of message.results) {
        output.push({
          role: "tool",
          tool_call_id: result.callId,
          content: JSON.stringify(result.output ?? null),
        });
      }
      continue;
    }

    const text: string[] = [];
    const reasoning: string[] = [];
    const toolCalls: unknown[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        text.push(block.text);
      } else if (block.type === "reasoning") {
        if (message.provider === "deepseek") {
          reasoning.push(block.text);
        } else if (block.text) {
          text.push(block.text);
        }
      } else {
        toolCalls.push({
          id: block.callId,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.arguments),
          },
        });
      }
    }
    output.push({
      role: "assistant",
      content: text.join(""),
      ...(reasoning.length > 0
        ? { reasoning_content: reasoning.join("") }
        : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }

  return output;
}

function textOnlyContent(content: MessageContent[]): string {
  const text: string[] = [];
  for (const block of content) {
    if (block.type !== "text") {
      throw new OrchaError(
        "unsupported_content_type",
        `DeepSeek does not support "${block.type}" message content.`,
      );
    }
    text.push(block.text);
  }
  return text.join("");
}

async function collectDeepSeekStream(
  response: Response,
  publishOutput?: (output: string) => void,
): Promise<CollectedDeepSeekResponse> {
  const collected: CollectedDeepSeekResponse = {
    content: "",
    reasoningContent: "",
    toolCalls: [],
  };

  for await (const event of readServerSentEvents(response)) {
    const chunk = event as DeepSeekStreamChunk;
    if (chunk.error) {
      throw new Error(
        chunk.error.message ?? "DeepSeek streaming request failed.",
      );
    }
    collected.id = chunk.id ?? collected.id;
    collected.usage = chunk.usage ?? collected.usage;
    const choice = chunk.choices?.[0];
    collected.finishReason =
      choice?.finish_reason ?? collected.finishReason;
    const delta = choice?.delta;

    if (typeof delta?.reasoning_content === "string") {
      collected.reasoningContent += delta.reasoning_content;
    }
    if (typeof delta?.content === "string") {
      collected.content += delta.content;
      publishOutput?.(collected.content);
    }
    for (const toolCall of delta?.tool_calls ?? []) {
      const index = toolCall.index;
      if (index === undefined) {
        throw new Error(
          "DeepSeek streamed a tool call without an index.",
        );
      }
      const partial = collected.toolCalls[index] ?? {
        name: "",
        arguments: "",
      };
      partial.id = toolCall.id ?? partial.id;
      partial.name += toolCall.function?.name ?? "";
      partial.arguments += toolCall.function?.arguments ?? "";
      collected.toolCalls[index] = partial;
    }
  }

  if (collected.finishReason === "insufficient_system_resource") {
    throw new Error(
      "DeepSeek stopped because inference capacity was unavailable.",
    );
  }
  return collected;
}

function toProviderResponse(
  request: ProviderRequest,
  response: CollectedDeepSeekResponse,
): ProviderResponse {
  const content: ProviderAssistantBlock[] = [];
  if (response.reasoningContent) {
    content.push({
      type: "reasoning",
      text: response.reasoningContent,
    });
  }
  if (response.content) {
    content.push({
      type: "text",
      text: response.content,
    });
  }

  for (const call of response.toolCalls) {
    if (!call.id || !call.name) {
      throw new Error(
        "DeepSeek returned an incomplete function call.",
      );
    }
    content.push({
      type: "tool_call",
      callId: call.id,
      name: call.name,
      arguments: parseToolArguments(call.arguments, call.name),
    });
  }

  const toolCalls = content.filter(
    (block): block is ProviderToolCall => block.type === "tool_call",
  );
  const output =
    request.outputType === "json" && toolCalls.length === 0
      ? parseStructuredOutput(
          response.content,
          request.outputSchema ?? {},
        )
      : response.content;

  return {
    output,
    responseId: response.id,
    stopReason: normalizeStopReason(response.finishReason, toolCalls),
    content,
    toolCalls,
    usage: normalizeUsage(response.usage),
  };
}

function parseToolArguments(
  value: string,
  toolName: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "{}");
  } catch (error) {
    throw new Error(
      `DeepSeek returned invalid arguments for tool "${toolName}".`,
      { cause: error },
    );
  }
  if (!isRecord(parsed)) {
    throw new Error(
      `DeepSeek returned non-object arguments for tool "${toolName}".`,
    );
  }
  return parsed;
}

function normalizeStopReason(
  reason: string | null | undefined,
  toolCalls: ProviderToolCall[],
): ProviderStopReason | undefined {
  if (toolCalls.length > 0 || reason === "tool_calls") {
    return "tool_call";
  }
  if (reason === "stop") {
    return "end_turn";
  }
  if (reason === "length") {
    return "max_tokens";
  }
  if (reason === "content_filter") {
    return "content_filter";
  }
  return reason === undefined || reason === null ? undefined : "unknown";
}

function normalizeUsage(usage: DeepSeekUsage | undefined): Usage {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    reasoningTokens:
      usage?.completion_tokens_details?.reasoning_tokens ?? null,
    cacheReadTokens: usage?.prompt_cache_hit_tokens ?? 0,
    cacheWriteTokens: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
