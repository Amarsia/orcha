import type {
  ProviderName,
  SessionEvent,
  SessionEventType,
} from "../types.js";
import { isBuiltInProvider } from "../providers/catalog.js";
import type {
  ProviderAssistantBlock,
  ProviderMessage,
  ProviderReplayMetadata,
  ProviderToolResult,
} from "../providers/types.js";

export class SessionEventWriter {
  readonly sessionId: string;
  readonly run: number;
  #sequence: number;

  constructor(
    sessionId: string,
    previousEvents: SessionEvent[],
    existingRun?: number,
  ) {
    this.sessionId = sessionId;
    this.run =
      existingRun ??
      (previousEvents.length === 0
        ? 1
        : Math.max(0, ...previousEvents.map((event) => event.run ?? 0)) + 1);
    this.#sequence =
      previousEvents.length === 0
        ? 0
        : Math.max(...previousEvents.map((event) => event.sequence));
  }

  create<TData extends Record<string, unknown>>(
    type: SessionEventType,
    data: TData,
    scope: "session" | "run" = "run",
  ): SessionEvent<TData> {
    this.#sequence += 1;
    return {
      sequence: this.#sequence,
      type,
      timestamp: new Date().toISOString(),
      ...(scope === "run" ? { run: this.run } : {}),
      data,
    };
  }
}

export function messagesFromEvents(
  events: SessionEvent[],
  includeRun?: number,
): ProviderMessage[] {
  const messages: ProviderMessage[] = [];
  const completedRuns = new Set(
    events
      .filter(
        (event) =>
          event.type === "run.completed" && typeof event.run === "number",
      )
      .map((event) => event.run as number),
  );

  for (const event of events) {
    if (
      !event.run ||
      (!completedRuns.has(event.run) && event.run !== includeRun)
    ) {
      continue;
    }

    if (
      event.type === "message.created" &&
      event.data.role === "user" &&
      (typeof event.data.content === "string" ||
        Array.isArray(event.data.content))
    ) {
      messages.push({
        role: "user",
        content: event.data.content,
      });
      continue;
    }

    if (
      event.type === "message.created" &&
      event.data.role === "tool" &&
      Array.isArray(event.data.content)
    ) {
      const results = normalizePersistedToolResults(event.data.content);
      if (!results) {
        continue;
      }
      messages.push({
        role: "tool",
        results,
      });
      continue;
    }

    if (
      event.type === "message.created" &&
      event.data.role === "assistant" &&
      Array.isArray(event.data.content)
    ) {
      const provider = isProviderName(event.data.provider)
        ? event.data.provider
        : inferAssistantProvider(event.data.content);
      const content = normalizeAssistantBlocks(event.data.content);
      if (!content) {
        continue;
      }
      messages.push({
        role: "assistant",
        ...(provider ? { provider } : {}),
        content,
      });
    }
  }

  return messages;
}

function normalizeAssistantBlocks(
  value: unknown[],
): ProviderAssistantBlock[] | undefined {
  const blocks: ProviderAssistantBlock[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return undefined;
    }
    if (item.type === "text" && typeof item.text === "string") {
      blocks.push({ type: "text", text: item.text });
      continue;
    }
    if (item.type === "reasoning" && typeof item.text === "string") {
      const replay = normalizeReplayMetadata(item);
      blocks.push({
        type: "reasoning",
        text: item.text,
        ...(replay ? { replay } : {}),
      });
      continue;
    }
    if (item.type === "thinking" && typeof item.thinking === "string") {
      blocks.push({
        type: "reasoning",
        text: item.thinking,
        ...(typeof item.signature === "string"
          ? { replay: { opaqueData: item.signature } }
          : {}),
      });
      continue;
    }
    if (
      item.type === "redacted_thinking" &&
      typeof item.data === "string"
    ) {
      blocks.push({
        type: "reasoning",
        text: "",
        replay: {
          opaqueData: item.data,
        },
      });
      continue;
    }
    if (
      item.type === "tool_call" &&
      typeof item.callId === "string" &&
      typeof item.name === "string" &&
      isRecord(item.arguments)
    ) {
      const replay = normalizeReplayMetadata(item);
      blocks.push({
        type: "tool_call",
        callId: item.callId,
        name: item.name,
        arguments: item.arguments,
        ...(replay ? { replay } : {}),
      });
      continue;
    }
    if (
      item.type === "tool_use" &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      isRecord(item.input)
    ) {
      blocks.push({
        type: "tool_call",
        callId: item.id,
        name: item.name,
        arguments: item.input,
      });
      continue;
    }
    return undefined;
  }
  return blocks;
}

export function normalizePersistedToolResults(
  value: unknown[],
): ProviderToolResult[] | undefined {
  const results: ProviderToolResult[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      return undefined;
    }
    if (typeof item.callId === "string" && "output" in item) {
      results.push({
        callId: item.callId,
        output: item.output,
        ...(item.isError === true ? { isError: true } : {}),
      });
      continue;
    }
    if (
      item.type === "tool_result" &&
      typeof item.tool_use_id === "string" &&
      typeof item.content === "string"
    ) {
      try {
        results.push({
          callId: item.tool_use_id,
          output: JSON.parse(item.content),
          ...(item.is_error === true ? { isError: true } : {}),
        });
      } catch {
        return undefined;
      }
      continue;
    }
    return undefined;
  }
  return results;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeReplayMetadata(
  value: Record<string, unknown>,
): ProviderReplayMetadata | undefined {
  if (isRecord(value.replay)) {
    const providerId =
      typeof value.replay.providerId === "string"
        ? value.replay.providerId
        : undefined;
    const opaqueData =
      typeof value.replay.opaqueData === "string"
        ? value.replay.opaqueData
        : undefined;
    if (!providerId && !opaqueData) {
      return undefined;
    }
    return {
      ...(providerId ? { providerId } : {}),
      ...(opaqueData ? { opaqueData } : {}),
    };
  }

  const id =
    typeof value.replayId === "string" ? value.replayId : undefined;
  const data = [
    value.opaqueData,
    value.signature,
    value.encryptedContent,
  ].find((item): item is string => typeof item === "string");
  if (!id && !data) {
    return undefined;
  }
  return {
    ...(id ? { providerId: id } : {}),
    ...(data ? { opaqueData: data } : {}),
  };
}

function inferAssistantProvider(
  content: unknown[],
): ProviderName | undefined {
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }
    if (isProviderName(item.provider)) {
      return item.provider;
    }
    if (
      item.type === "thinking" ||
      item.type === "redacted_thinking" ||
      item.type === "tool_use"
    ) {
      return "anthropic";
    }
  }
  return undefined;
}

function isProviderName(value: unknown): value is ProviderName {
  return (
    value === "amarsia" ||
    (typeof value === "string" && isBuiltInProvider(value))
  );
}
