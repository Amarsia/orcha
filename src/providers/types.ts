import type {
  MessageContent,
  ProviderConfiguration,
  ProviderName,
  Usage,
} from "../types.js";

export interface ProviderTextBlock {
  type: "text";
  text: string;
}

/** Provider-owned state required to replay a normalized block verbatim. */
export interface ProviderReplayMetadata {
  providerId?: string;
  opaqueData?: string;
}

export interface ProviderReasoningBlock {
  type: "reasoning";
  text: string;
  replay?: ProviderReplayMetadata;
}

export interface ProviderToolCall {
  type: "tool_call";
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  replay?: ProviderReplayMetadata;
}

export type ProviderAssistantBlock =
  | ProviderTextBlock
  | ProviderReasoningBlock
  | ProviderToolCall;

export interface ProviderToolResult {
  callId: string;
  output: unknown;
  isError?: boolean;
}

export type ProviderMessage =
  | {
      role: "user";
      content: string | MessageContent[];
    }
  | {
      role: "assistant";
      provider?: ProviderName;
      content: ProviderAssistantBlock[];
    }
  | {
      role: "tool";
      results: ProviderToolResult[];
    };

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  model: string;
  region?: string;
  maxTokens?: number;
  reasoningLevel?: string;
  outputType?: "text" | "json" | "image" | "audio";
  outputSchema?: Record<string, unknown>;
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ProviderToolDefinition[];
  publishOutput?: (output: string) => void;
}

export type ProviderStopReason =
  | "end_turn"
  | "tool_call"
  | "max_tokens"
  | "content_filter"
  | "unknown";

export interface ProviderResponse {
  output: unknown;
  responseId?: string;
  stopReason?: ProviderStopReason;
  content: ProviderAssistantBlock[];
  toolCalls: ProviderToolCall[];
  usage: Usage;
}

export interface ProviderAdapter {
  readonly name: ProviderName;
  generate(
    configuration: ProviderConfiguration,
    request: ProviderRequest,
  ): Promise<ProviderResponse>;
}

export type ProviderResponseGenerator = (
  name: ProviderName,
  configuration: ProviderConfiguration,
  request: ProviderRequest,
) => Promise<ProviderResponse>;
