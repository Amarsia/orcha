import type { SessionEvent, SessionEventType } from "../types.js";

export class SessionEventWriter {
  readonly sessionId: string;
  readonly run: number;
  #sequence: number;

  constructor(sessionId: string, previousEvents: SessionEvent[]) {
    this.sessionId = sessionId;
    this.run =
      previousEvents.length === 0
        ? 1
        : Math.max(0, ...previousEvents.map((event) => event.run ?? 0)) + 1;
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
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{
    role: "user" | "assistant";
    content: string;
  }> = [];
  const completedRuns = new Set(
    events
      .filter(
        (event) =>
          event.type === "run.completed" && typeof event.run === "number",
      )
      .map((event) => event.run as number),
  );

  for (const event of events) {
    if (!event.run || !completedRuns.has(event.run)) {
      continue;
    }

    if (
      event.type === "message.created" &&
      event.data.role === "user" &&
      typeof event.data.content === "string"
    ) {
      messages.push({ role: "user", content: event.data.content });
      continue;
    }

    if (
      event.type !== "message.created" ||
      event.data.role !== "assistant"
    ) {
      continue;
    }

    const blocks = Array.isArray(event.data.content) ? event.data.content : [];
    const content = blocks
      .filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "text" &&
          "text" in block &&
          typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("");

    if (content) {
      messages.push({ role: "assistant", content });
    }
  }

  return messages;
}
