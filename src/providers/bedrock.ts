import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ContentBlock,
  type ConverseStreamCommandInput,
  type ConverseStreamOutput,
  type DocumentFormat,
  type Message,
  type TokenUsage,
} from "@aws-sdk/client-bedrock-runtime";
import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import { OrchaError } from "../errors.js";
import { readLocalFileContent } from "../file-content.js";
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
    request,
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
  if (block.type === "file") {
    const file = await readLocalFileContent(block);
    return toBedrockBinaryBlock(
      file.bytes,
      block.mimeType,
      file.fileName,
    );
  }
  if (
    block.type === "image" ||
    block.type === "url"
  ) {
    const response = await fetch(block.fileUri);
    if (!response.ok) {
      throw new Error(
        `Could not load Bedrock file input: HTTP ${response.status}.`,
      );
    }
    return toBedrockBinaryBlock(
      new Uint8Array(await response.arrayBuffer()),
      block.mimeType,
      fileNameFromUri(block.fileUri),
    );
  }
  throw new OrchaError(
    "unsupported_content_type",
    `Amazon Bedrock does not support Orcha content type "${block.type}" with MIME type "${block.mimeType}".`,
  );
}

function toBedrockBinaryBlock(
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): ContentBlock {
  if (mimeType.startsWith("image/")) {
    return {
      image: {
        format: imageFormat(mimeType),
        source: {
          bytes,
        },
      },
    };
  }
  const format = documentFormat(fileName, mimeType);
  if (format) {
    return {
      document: {
        format,
        name: safeBedrockDocumentName(fileName),
        source: { bytes },
      },
    };
  }
  throw new OrchaError(
    "unsupported_content_type",
    `Amazon Bedrock does not support file MIME type "${mimeType}".`,
  );
}

function documentFormat(
  fileName: string,
  mimeType: string,
): DocumentFormat | undefined {
  const extension = extname(fileName).slice(1).toLowerCase();
  if (
    ["csv", "doc", "docx", "html", "md", "pdf", "txt", "xls", "xlsx"].includes(
      extension,
    )
  ) {
    return extension as DocumentFormat;
  }
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/msword") return "doc";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "docx";
  if (mimeType === "application/vnd.ms-excel") return "xls";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) return "xlsx";
  if (mimeType === "text/csv") return "csv";
  if (mimeType === "text/html") return "html";
  if (mimeType === "text/markdown") return "md";
  if (mimeType === "text/plain") return "txt";
  return undefined;
}

function safeBedrockDocumentName(fileName: string): string {
  const name = basename(fileName, extname(fileName))
    .replace(/[^A-Za-z0-9()[\] -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || "document";
}

function fileNameFromUri(uri: string): string {
  try {
    return basename(new URL(uri).pathname) || "document";
  } catch {
    return basename(uri) || "document";
  }
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
  request: ProviderRequest,
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
      .map(([, block]) => normalizeBlock(block, request, requestId)),
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
  request: ProviderRequest,
  requestId?: string,
): ProviderAssistantBlock {
  if (block.type === "text") {
    return block;
  }
  if (block.type === "tool_call") {
    return {
      type: "tool_call",
      callId: block.callId,
      name: block.name,
      arguments: parseToolInput(
        block.input,
        block.name,
        request,
        requestId,
      ),
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
  request: ProviderRequest,
  requestId?: string,
): Record<string, unknown> {
  if (!input) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    throw invalidToolInputError({
      input,
      name,
      request,
      requestId,
      reason: error instanceof Error ? error.message : "Invalid JSON.",
    });
  }
  if (isRecord(parsed)) {
    return parsed;
  }
  throw invalidToolInputError({
    input,
    name,
    request,
    requestId,
    reason: "The decoded value was not a JSON object.",
  });
}

function invalidToolInputError(options: {
  input: string;
  name: string;
  request: ProviderRequest;
  requestId?: string;
  reason: string;
}): OrchaError {
  const tool = options.request.tools.find(
    (candidate) => candidate.name === options.name,
  );
  const expectedSchema = tool?.parameters ?? {
    type: "object",
  };
  const previewLimit = 1_000;
  const receivedStart =
    options.input.length > previewLimit
      ? `${options.input.slice(0, previewLimit)}…`
      : options.input;
  const receivedEnd =
    options.input.length > previewLimit
      ? `…${options.input.slice(-previewLimit)}`
      : options.input;
  const receivedSha256 = createHash("sha256")
    .update(options.input)
    .digest("hex");
  const requestReference = options.requestId
    ? ` Bedrock request ID: ${options.requestId}.`
    : "";
  return new OrchaError(
    "provider_error",
    [
      `Amazon Bedrock model "${options.request.model}" generated invalid arguments for tool "${options.name}".`,
      `Expected a JSON object matching ${JSON.stringify(expectedSchema)}.`,
      `Received ${options.input.length} characters. Start: ${JSON.stringify(receivedStart)}. End: ${JSON.stringify(receivedEnd)}.`,
      `JSON decoding failed: ${options.reason}`,
      "These arguments were generated by the model after Orcha sent the tool definition; they were not accepted application input.",
      "Retry the run. If the received payload appears to be valid JSON, report a possible Orcha stream-decoding issue at https://github.com/Amarsia/orcha/issues.",
      requestReference,
    ].join(" "),
    {
      retryable: true,
      details: {
        provider: "bedrock",
        model: options.request.model,
        tool: options.name,
        sentToolDefinition: tool
          ? {
              toolSpec: {
                name: tool.name,
                description: tool.description,
                inputSchema: {
                  json: toBedrockDocument(tool.parameters),
                },
              },
            }
          : {
              toolSpec: {
                name: options.name,
                inputSchema: {
                  json: toBedrockDocument(expectedSchema),
                },
              },
            },
        expectedSchema,
        receivedLength: options.input.length,
        receivedStart,
        receivedEnd,
        receivedSha256,
        decodeError: options.reason,
        ...(options.requestId ? { requestId: options.requestId } : {}),
        issueUrl: "https://github.com/Amarsia/orcha/issues",
      },
    },
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
