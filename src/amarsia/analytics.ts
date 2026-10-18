import type {
  AmarsiaTelemetryBatchV1,
  AmarsiaTelemetryRunV1,
  CompiledAgentManifest,
  SessionEvent,
  SessionStore,
  Usage,
} from "../types.js";
import { resolveAmarsiaEndpoint } from "./sync.js";

const RELEVANT_EVENTS = new Set([
  "run.started",
  "run.completed",
  "run.failed",
  "run.paused",
  "evaluation.completed",
  "evaluation.failed",
]);

export type AmarsiaRunFact = AmarsiaTelemetryRunV1;

export class AmarsiaTelemetryClient {
  readonly #key: string;
  readonly #baseUrl: string;
  readonly #queue = new Map<string, AmarsiaRunFact>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;

  constructor(options: { key: string; endpoint?: string }) {
    this.#key = options.key;
    this.#baseUrl = resolveAmarsiaEndpoint(options.endpoint);
  }

  enqueue(fact: AmarsiaRunFact): void {
    this.#queue.set(fact.event_id, fact);
    if (this.#queue.size >= 20) {
      void this.#flush();
      return;
    }
    this.#schedule(250);
  }

  #schedule(delay: number): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#flush();
    }, delay);
    const timer = this.#timer as ReturnType<typeof setTimeout> & {
      unref?: () => void;
    };
    timer.unref?.();
  }

  async #flush(): Promise<void> {
    if (this.#queue.size === 0) return;
    const batch = [...this.#queue.values()].slice(0, 100);
    for (const fact of batch) this.#queue.delete(fact.event_id);
    try {
      const response = await fetch(
        `${this.#baseUrl}/v3/project-analytics/runs/batch`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-amarsia-project-key": this.#key,
          },
          body: JSON.stringify({
            schema_version: 1,
            runs: batch,
          } satisfies AmarsiaTelemetryBatchV1),
        },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.#attempt = 0;
    } catch {
      this.#attempt += 1;
      if (this.#attempt <= 6) {
        for (const fact of batch) this.#queue.set(fact.event_id, fact);
        this.#schedule(Math.min(30_000, 500 * 2 ** this.#attempt));
      } else {
        this.#attempt = 0;
      }
    }
  }
}

export function withAmarsiaTelemetry(options: {
  store: SessionStore;
  manifest: CompiledAgentManifest;
  client: AmarsiaTelemetryClient;
}): SessionStore {
  const { store, manifest, client } = options;
  return {
    read: (sessionId) => store.read(sessionId),
    listSessionIds: () => store.listSessionIds(),
    describeLocation: store.describeLocation?.bind(store),
    subscribe: store.subscribe?.bind(store),
    subscribeAll: store.subscribeAll?.bind(store),
    async append(sessionId, events) {
      await store.append(sessionId, events);
      const runs = new Set(
        events
          .filter(
            (event) =>
              typeof event.run === "number" &&
              RELEVANT_EVENTS.has(event.type),
          )
          .map((event) => event.run as number),
      );
      if (runs.size === 0) return;
      void store
        .read(sessionId)
        .then((allEvents) => {
          if (isTestSession(allEvents)) return;
          for (const run of runs) {
            const fact = projectRunFact(
              manifest,
              sessionId,
              run,
              allEvents,
            );
            if (fact) client.enqueue(fact);
          }
        })
        .catch(() => undefined);
    },
  };
}

function projectRunFact(
  manifest: CompiledAgentManifest,
  sessionId: string,
  run: number,
  events: SessionEvent[],
): AmarsiaRunFact | undefined {
  const runEvents = events.filter((event) => event.run === run);
  const started = runEvents.find((event) => event.type === "run.started");
  if (!started) return undefined;
  const terminal = [...runEvents]
    .reverse()
    .find((event) =>
      ["run.completed", "run.failed", "run.paused"].includes(event.type),
    );
  const sessionCreated = events.find(
    (event) => event.type === "session.created",
  );
  const lineage = asRecord(sessionCreated?.data.lineage);
  const assistants = runEvents.filter(
    (event) =>
      event.type === "message.created" && event.data.role === "assistant",
  );
  const usage = normalizeUsage(terminal?.data.usage, assistants);
  const completedActions = runEvents.filter(
    (event) => event.type === "action.completed",
  );
  const failedActions = runEvents.filter(
    (event) => event.type === "action.failed",
  );
  const evaluations = runEvents.filter(
    (event) =>
      event.type === "evaluation.completed" ||
      event.type === "evaluation.failed",
  );
  const error = asRecord(terminal?.data.error);
  const lastAssistant = assistants.at(-1);
  const status =
    typeof terminal?.data.status === "string"
      ? terminal.data.status
      : "running";
  return {
    event_id: `${manifest.key}:${sessionId}:${run}`,
    agent_external_id: manifest.key,
    session_id: sessionId,
    run_number: run,
    ...(typeof lineage?.parentAgent === "string"
      ? { parent_agent_external_id: lineage.parentAgent }
      : {}),
    ...(typeof lineage?.parentSessionId === "string"
      ? { parent_session_id: lineage.parentSessionId }
      : {}),
    status,
    provider:
      typeof started.data.provider === "string"
        ? started.data.provider
        : manifest.provider,
    model:
      typeof started.data.model === "string"
        ? started.data.model
        : manifest.model,
    ...(typeof started.data.region === "string"
      ? { region: started.data.region }
      : {}),
    ...(typeof started.data.outputType === "string"
      ? { output_type: started.data.outputType }
      : {}),
    ...(typeof lastAssistant?.data.stopReason === "string"
      ? { stop_reason: lastAssistant.data.stopReason }
      : {}),
    started_at: started.timestamp,
    ...(terminal ? { ended_at: terminal.timestamp } : {}),
    ...(typeof terminal?.data.durationMs === "number"
      ? { duration_ms: terminal.data.durationMs }
      : {}),
    model_duration_ms: sumNumber(assistants, "durationMs"),
    action_duration_ms: sumNumber(
      [...completedActions, ...failedActions],
      "durationMs",
    ),
    ...usage,
    user_message_count: runEvents.filter(
      (event) =>
        event.type === "message.created" && event.data.role === "user",
    ).length,
    assistant_message_count: assistants.length,
    action_count: runEvents.filter(
      (event) => event.type === "action.requested",
    ).length,
    action_success_count: completedActions.length,
    action_failure_count: failedActions.length,
    subagent_count: runEvents.filter(
      (event) => event.type === "subagent.initiated",
    ).length,
    evaluation_count: evaluations.length,
    evaluation_pass_count: evaluations.filter(
      (event) =>
        event.type === "evaluation.completed" &&
        event.data.status === "passed",
    ).length,
    ...(typeof error?.code === "string" ? { error_code: error.code } : {}),
    ...(typeof error?.message === "string"
      ? { error_message: sanitizeErrorMessage(error.message) }
      : {}),
    ...(typeof error?.retryable === "boolean"
      ? { error_retryable: error.retryable }
      : {}),
  };
}

function normalizeUsage(
  terminalUsage: unknown,
  assistants: SessionEvent[],
): Pick<
  AmarsiaRunFact,
  | "input_tokens"
  | "output_tokens"
  | "reasoning_tokens"
  | "cache_read_tokens"
  | "cache_write_tokens"
> {
  const direct = asRecord(terminalUsage);
  if (direct) {
    return usageFields(direct);
  }
  const total: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const event of assistants) {
    const usage = asRecord(event.data.usage);
    if (!usage) continue;
    total.inputTokens += numberValue(usage.inputTokens);
    total.outputTokens += numberValue(usage.outputTokens);
    total.reasoningTokens =
      (total.reasoningTokens ?? 0) + numberValue(usage.reasoningTokens);
    total.cacheReadTokens += numberValue(usage.cacheReadTokens);
    total.cacheWriteTokens += numberValue(usage.cacheWriteTokens);
  }
  return usageFields(total as unknown as Record<string, unknown>);
}

function usageFields(usage: Record<string, unknown>) {
  const reasoning = numberValue(usage.reasoningTokens);
  return {
    input_tokens: numberValue(usage.inputTokens),
    output_tokens: numberValue(usage.outputTokens),
    ...(reasoning > 0 ? { reasoning_tokens: reasoning } : {}),
    cache_read_tokens: numberValue(usage.cacheReadTokens),
    cache_write_tokens: numberValue(usage.cacheWriteTokens),
  };
}

function isTestSession(events: SessionEvent[]): boolean {
  const created = events.find((event) => event.type === "session.created");
  const metadata = asRecord(created?.data.metadata);
  return metadata?.orchaTest === true;
}

function sumNumber(events: SessionEvent[], key: string): number {
  return events.reduce((sum, event) => sum + numberValue(event.data[key]), 0);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sanitizeErrorMessage(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(
      /\b(authorization|api[-_ ]?key|token|secret|password)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(
      /\b(?:sk|pk|amarsia)_[A-Za-z0-9_-]{12,}\b/gi,
      "[redacted]",
    )
    .slice(0, 2000);
}

