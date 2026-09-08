import type {
  CompiledAgentManifest,
  ProviderConfiguration,
  Usage,
} from "../types.js";
import { parseStructuredOutput } from "../runtime/structured-output.js";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  data?: string;
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
  usage: Usage;
}

export async function callAnthropic(
  agent: CompiledAgentManifest,
  provider: ProviderConfiguration,
  messages: AnthropicMessage[],
): Promise<ModelResponse> {
  if (!provider.apiKey?.trim()) {
    throw new Error(
      'Missing Anthropic API key in orcha.init({ providers: { anthropic: "..." } }).',
    );
  }

  const reasoning = getReasoningConfiguration(agent);
  const systemPrompt =
    agent.outputType === "json"
      ? `${agent.systemPrompt}\n\nReturn only valid JSON matching this JSON Schema:\n${JSON.stringify(agent.outputSchema)}`
      : agent.systemPrompt;
  const requestBody: Record<string, unknown> = {
    model: agent.model,
    max_tokens: reasoning.maxTokens,
    system: systemPrompt,
    messages,
  };

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

  const body = (await response.json()) as AnthropicResponse;
  if (!response.ok) {
    throw new Error(
      body.error?.message ?? `Anthropic request failed with HTTP ${response.status}.`,
    );
  }

  const content = body.content ?? [];
  const textOutput = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("");
  const output =
    agent.outputType === "json"
      ? parseStructuredOutput(textOutput, agent.outputSchema ?? {})
      : textOutput;

  return {
    output,
    responseId: body.id,
    stopReason: body.stop_reason,
    content,
    usage: {
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      reasoningTokens: null,
      cacheReadTokens: body.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: body.usage?.cache_creation_input_tokens ?? 0,
    },
  };
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
