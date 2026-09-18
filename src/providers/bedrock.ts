import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ContentBlock,
  type ConverseStreamCommandInput,
  type ConverseStreamOutput,
  type Message,
  type TokenUsage,
} from "@aws-sdk/client-bedrock-runtime";
import { OrchaError } from "../errors.js";
import { parseStructuredOutput } from "../runtime/structured-output.js";
import type {
  BedrockProviderConfiguration,
  MessageContent,
  ProviderConfiguration,
} from "../types.js";
import type {
  ProviderAdapter,
  ProviderAssistantBlock,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  ProviderStopReason,
  ProviderToolCall,
} from "./types.js";

interface PartialTextBlock {
  type: "text";
  text: string;
}

interface PartialReasoningBlock {
  type: "reasoning";
  text: string;
  signature?: string;
  redactedContent?: Uint8Array;
}

interface PartialToolCall {
  type: "tool_call";
  callId: string;
  name: string;
  input: string;
}

type PartialBlock =
  | PartialTextBlock
  | PartialReasoningBlock
  | PartialToolCall;

type BedrockDocument =
  | null
  | boolean
  | number
  | string
  | BedrockDocument[]
  | { [key: string]: BedrockDocument };

interface CollectedBedrockResponse {
  requestId?: string;
  blocks: ProviderAssistantBlock[];
  stopReason?: string;
  usage?: TokenUsage;
}

export interface BedrockContentClient {
  send(
    command: ConverseStreamCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<{
    stream?: AsyncIterable<ConverseStreamOutput>;
    $metadata: { requestId?: string };
  }>;
}

export const bedrockProvider: ProviderAdapter = {
  name: "bedrock",
  generate: generateBedrock,
};

async function generateBedrock(
  configuration: ProviderConfiguration,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const bedrockConfiguration = validateConfiguration(configuration);
  if (request.outputType === "image" || request.outputType === "audio") {
    throw new OrchaError(
      "unsupported_provider_capability",
      `Amazon Bedrock Converse does not support "${request.outputType}" as a direct agent output.`,
    );
  }

  const client = new BedrockRuntimeClient({
    region: bedrockConfiguration.region,
    ...(bedrockConfiguration.baseUrl
      ? { endpoint: bedrockConfiguration.baseUrl }
      : {}),
    ...(bedrockConfiguration.credentials
      ? { credentials: bedrockConfiguration.credentials }
      : {}),
  });
  return generateBedrockContent(client, request);
}

export async function generateBedrockContent(
  client: BedrockContentClient,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const input: ConverseStreamCommandInput = {
    modelId: request.model,
    system: [{ text: systemPrompt(request) }],
    messages: await toBedrockMessages(request.messages),
    ...(request.maxTokens
      ? { inferenceConfig: { maxTokens: request.maxTokens } }
      : {}),
  };

  if (request.tools.length > 0) {
    input.toolConfig = {
      tools: request.tools.map((tool) => ({
        toolSpec: {
          name: tool.name,
          description: tool.description,
          inputSchema: {
            json: toBedrockDocument(tool.parameters),
          },
        },
      })),
    };
  }
  if (request.reasoningLevel && isAnthropicModel(request.model)) {
    input.additionalModelRequestFields = {
      thinking: { type: "adaptive" },
      output_config: { effort: request.reasoningLevel },
    };
  }

  const response = await client.send(
    new ConverseStreamCommand(input),
    { abortSignal: request.signal },
  );
  if (!response.stream) {
    throw new Error("Amazon Bedrock returned no response stream.");
  }

  const collected = await collectBedrockStream(
    response.stream,
    response.$metadata.requestId,
    request.publishOutput,
  );
  return toProviderResponse(request, collected);
}

function validateConfiguration(
  configuration: ProviderConfiguration,
): BedrockProviderConfiguration {
  if (
    !("region" in configuration) ||
    typeof configuration.region !== "string" ||
    !configuration.region.trim()
  ) {
    throw new Error(
      'Missing AWS region in orcha.init({ providers: { bedrock: { region: "..." } } }).',
    );
  }
  if (
    configuration.credentials &&
    (!configuration.credentials.accessKeyId.trim() ||
      !configuration.credentials.secretAccessKey.trim())
  ) {
    throw new Error(
      "Bedrock credentials require accessKeyId and secretAccessKey.",
    );
  }
  return configuration;
}

function systemPrompt(request: ProviderRequest): string {
  if (request.outputType !== "json") {
    return request.systemPrompt;
  }
  return `${request.systemPrompt}\n\nReturn only valid JSON matching this JSON Schema:\n${JSON.stringify(request.outputSchema ?? {})}`;
}

async function toBedrockMessages(
  messages: ProviderMessage[],
): Promise<Message[]> {
  const output: Message[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      output.push({
        role: "user",
        content:
          typeof message.content === "string"
            ? [{ text: message.content }]
            : await Promise.all(
                message.content.map(toBedrockUserBlock),
              ),
      });
      continue;
    }
    if (message.role === "tool") {
      output.push({
        role: "user",
        content: message.results.map((result) => ({
          toolResult: {
            toolUseId: result.callId,
            content: [
              { json: toBedrockDocument(result.output) },
            ],
            ...(result.isError ? { status: "error" as const } : {}),
          },
        })),
      });
      continue;
    }

    output.push({
      role: "assistant",
      content: message.content.map((block) =>
        toBedrockAssistantBlock(
          block,
          message.provider === "bedrock",
        ),
      ),
    });
  }
  return output;
}

async function toBedrockUserBlock(
  block: MessageContent,
): Promise<ContentBlock> {
  if (block.type === "text") {
    return { text: block.text };
  }
  if (
    (block.type === "image" || block.type === "url") &&
    block.mimeType.startsWith("image/")
  ) {
    const format = imageFormat(block.mimeType);
    const response = await fetch(block.fileUri);
    if (!response.ok) {
      throw new Error(
        `Could not load Bedrock image input: HTTP ${response.status}.`,
      );
    }
    return {
      image: {
        format,
        source: {
          bytes: new Uint8Array(await response.arrayBuffer()),
        },
      },
    };
  }
  throw new OrchaError(
    "unsupported_content_type",
    `Amazon Bedrock does not support Orcha content type "${block.type}" with MIME type "${block.mimeType}".`,
  );
}

function imageFormat(
  mimeType: string,
): "png" | "jpeg" | "gif" | "webp" {
  const subtype = mimeType.toLowerCase().split(";")[0]?.split("/")[1];
  if (
    subtype === "png" ||
    subtype === "jpeg" ||
    subtype === "gif" ||
    subtype === "webp"
  ) {
    return subtype;
  }
  if (subtype === "jpg") {
    return "jpeg";
  }
  throw new OrchaError(
    "unsupported_content_type",
    `Amazon Bedrock does not support image MIME type "${mimeType}".`,
  );
}

function toBedrockAssistantBlock(
  block: ProviderAssistantBlock,
  replayBedrockState: boolean,
): ContentBlock {
  if (block.type === "text") {
    return { text: block.text };
  }
  if (block.type === "tool_call") {
    return {
      toolUse: {
        toolUseId: block.callId,
        name: block.name,
        input: toBedrockDocument(block.arguments),
      },
    };
  }
  if (!replayBedrockState) {
    return { text: block.text };
  }
  if (!block.text && block.replay?.opaqueData) {
    return {
      reasoningContent: {
        redactedContent: Uint8Array.from(
          Buffer.from(block.replay.opaqueData, "base64"),
        ),
      },
    };
  }
  return {
    reasoningContent: {
      reasoningText: {
        text: block.text,
        ...(block.replay?.opaqueData
          ? { signature: block.replay.opaqueData }
          : {}),
      },
    },
  };
}

async function collectBedrockStream(
  stream: AsyncIterable<ConverseStreamOutput>,
  requestId?: string,
  publishOutput?: (output: string) => void,
): Promise<CollectedBedrockResponse> {
  const blocks = new Map<number, PartialBlock>();
  let stopReason: string | undefined;
  let usage: TokenUsage | undefined;
  let cumulativeText = "";

  for await (const event of stream) {
    throwStreamError(event);

    const start = event.contentBlockStart;
    if (start?.start?.toolUse) {
      blocks.set(start.contentBlockIndex ?? blocks.size, {
        type: "tool_call",
        callId: start.start.toolUse.toolUseId ?? "",
        name: start.start.toolUse.name ?? "",
        input: "",
      });
    }

    const deltaEvent = event.contentBlockDelta;
    const delta = deltaEvent?.delta;
    const index = deltaEvent?.contentBlockIndex ?? blocks.size;
    if (delta?.text !== undefined) {
      const block = getPartialTextBlock(blocks, index);
      block.text += delta.text;
      cumulativeText += delta.text;
      publishOutput?.(cumulativeText);
    }
    if (delta?.toolUse?.input !== undefined) {
      const block = blocks.get(index);
      if (!block || block.type !== "tool_call") {
        throw new Error(
          `Amazon Bedrock streamed tool input before tool start at block ${index}.`,
        );
      }
      block.input += delta.toolUse.input;
    }
    if (delta?.reasoningContent) {
      const block = getPartialReasoningBlock(blocks, index);
      if (delta.reasoningContent.text !== undefined) {
        block.text += delta.reasoningContent.text;
      }
      if (delta.reasoningContent.signature !== undefined) {
        block.signature = delta.reasoningContent.signature;
      }
      if (delta.reasoningContent.redactedContent !== undefined) {
        block.redactedContent =
          delta.reasoningContent.redactedContent;
      }
    }
    if (event.messageStop?.stopReason) {
      stopReason = event.messageStop.stopReason;
    }
    if (event.metadata?.usage) {
      usage = event.metadata.usage;
    }
  }

  return {
    requestId,
    blocks: [...blocks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, block]) => normalizeBlock(block)),
    stopReason,
    usage,
  };
}

function getPartialTextBlock(
  blocks: Map<number, PartialBlock>,
  index: number,
): PartialTextBlock {
  const existing = blocks.get(index);
  if (existing?.type === "text") {
    return existing;
  }
  const block: PartialTextBlock = { type: "text", text: "" };
  blocks.set(index, block);
  return block;
}

function getPartialReasoningBlock(
  blocks: Map<number, PartialBlock>,
  index: number,
): PartialReasoningBlock {
  const existing = blocks.get(index);
  if (existing?.type === "reasoning") {
    return existing;
  }
  const block: PartialReasoningBlock = {
    type: "reasoning",
    text: "",
  };
  blocks.set(index, block);
  return block;
}

function normalizeBlock(
  block: PartialBlock,
): ProviderAssistantBlock {
  if (block.type === "text") {
    return block;
  }
  if (block.type === "tool_call") {
    return {
      type: "tool_call",
      callId: block.callId,
      name: block.name,
      arguments: parseToolInput(block.input, block.name),
    };
  }
  if (block.redactedContent) {
    return {
      type: "reasoning",
      text: "",
      replay: {
        opaqueData: Buffer.from(
          block.redactedContent,
        ).toString("base64"),
      },
    };
  }
  return {
    type: "reasoning",
    text: block.text,
    ...(block.signature
      ? { replay: { opaqueData: block.signature } }
      : {}),
  };
}

function parseToolInput(
  input: string,
  name: string,
): Record<string, unknown> {
  if (!input) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(input);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // The provider error below includes the tool name.
  }
  throw new Error(
    `Amazon Bedrock returned invalid JSON arguments for tool "${name}".`,
  );
}

function toProviderResponse(
  request: ProviderRequest,
  response: CollectedBedrockResponse,
): ProviderResponse {
  const textOutput = response.blocks
    .filter(
      (block): block is PartialTextBlock =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("");
  const toolCalls = response.blocks.filter(
    (block): block is ProviderToolCall =>
      block.type === "tool_call",
  );
  return {
    output:
      request.outputType === "json" && toolCalls.length === 0
        ? parseStructuredOutput(
            textOutput,
            request.outputSchema ?? {},
          )
        : textOutput,
    responseId: response.requestId,
    stopReason: normalizeStopReason(response.stopReason),
    content: response.blocks,
    toolCalls,
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
      reasoningTokens: null,
      cacheReadTokens:
        response.usage?.cacheReadInputTokens ?? 0,
      cacheWriteTokens:
        response.usage?.cacheWriteInputTokens ?? 0,
    },
  };
}

function normalizeStopReason(
  reason: string | undefined,
): ProviderStopReason | undefined {
  if (!reason) {
    return undefined;
  }
  if (reason === "end_turn" || reason === "stop_sequence") {
    return "end_turn";
  }
  if (reason === "tool_use") {
    return "tool_call";
  }
  if (
    reason === "max_tokens" ||
    reason === "model_context_window_exceeded"
  ) {
    return "max_tokens";
  }
  if (
    reason === "content_filtered" ||
    reason === "guardrail_intervened"
  ) {
    return "content_filter";
  }
  return "unknown";
}

function throwStreamError(event: ConverseStreamOutput): void {
  const error =
    event.internalServerException ??
    event.modelStreamErrorException ??
    event.validationException ??
    event.throttlingException ??
    event.serviceUnavailableException;
  if (error) {
    throw new Error(
      error.message ?? "Amazon Bedrock streaming request failed.",
    );
  }
}

function isAnthropicModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return (
    normalized.includes("anthropic.") ||
    normalized.includes("claude")
  );
}

function toBedrockDocument(value: unknown): BedrockDocument {
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        "Amazon Bedrock document values must contain finite numbers.",
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toBedrockDocument);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        toBedrockDocument(item),
      ]),
    );
  }
  throw new Error(
    `Amazon Bedrock cannot serialize a ${typeof value} document value.`,
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
