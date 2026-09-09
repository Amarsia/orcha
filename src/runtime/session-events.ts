import type { SessionEvent, SessionEventType } from "../types.js";

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
): Array<{
  role: "user" | "assistant";
  content: string | unknown[];
}> {
  const messages: Array<{
    role: "user" | "assistant";
    content: string | unknown[];
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
    if (
      !event.run ||
      (!completedRuns.has(event.run) && event.run !== includeRun)
    ) {
      continue;
    }

    if (
      event.type === "message.created" &&
      (event.data.role === "user" || event.data.role === "tool") &&
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
      event.data.role === "assistant" &&
      Array.isArray(event.data.content)
    ) {
      messages.push({
        role: "assistant",
        content: event.data.content,
      });
    }
  }

  return messages;
}
