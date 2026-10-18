import type {
  AmarsiaTelemetryBatchV1,
  AmarsiaTelemetryRunV1,
  CompiledAgentManifest,
  SessionEvent,
  SessionStore,
  Usage,
} from "../types.js";
import { resolveAmarsiaEndpoint } from "./endpoint.js";

const RELEVANT_EVENTS = new Set([
  "run.started",
  "run.completed",
  "run.failed",
  "run.paused",
  "evaluation.completed",
  "evaluation.failed",
]);

const MAX_BATCH_RUNS = 100;
const MAX_KEEPALIVE_BYTES = 48 * 1024;
const HEARTBEAT_INTERVAL_MS = 30_000;

export type AmarsiaRunFact = AmarsiaTelemetryRunV1;

export class AmarsiaTelemetryClient {
  readonly #key: string;
  readonly #baseUrl: string;
  readonly #queue = new Map<string, AmarsiaRunFact>();
  readonly #activeRuns = new Map<string, AmarsiaRunFact>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #flushPromise: Promise<void> | undefined;

  constructor(options: { key: string; endpoint?: string }) {
    this.#key = options.key;
    this.#baseUrl = resolveAmarsiaEndpoint(options.endpoint);
  }

  enqueue(fact: AmarsiaRunFact): void {
    this.#queue.set(fact.event_id, fact);
    if (fact.status === "running") {
      this.#activeRuns.set(fact.event_id, fact);
      this.#scheduleHeartbeat();
    } else {
      this.#activeRuns.delete(fact.event_id);
      if (this.#activeRuns.size === 0 && this.#heartbeatTimer) {
        clearTimeout(this.#heartbeatTimer);
        this.#heartbeatTimer = undefined;
      }
    }
    if (fact.status !== "running") {
      this.#scheduleTerminal();
      return;
    }
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

  #scheduleTerminal(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#flush();
    }, 0);
  }

  #scheduleHeartbeat(): void {
    if (this.#heartbeatTimer || this.#activeRuns.size === 0) return;
    this.#heartbeatTimer = setTimeout(() => {
      this.#heartbeatTimer = undefined;
      for (const fact of this.#activeRuns.values()) {
        this.#queue.set(fact.event_id, fact);
      }
      void this.#flush();
      this.#scheduleHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    const timer = this.#heartbeatTimer as ReturnType<typeof setTimeout> & {
      unref?: () => void;
    };
    timer.unref?.();
  }

  async drain(options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = Math.max(0, options.timeoutMs ?? 2_000);
    const deadline = Date.now() + timeoutMs;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    while (this.#queue.size > 0 || this.#flushPromise) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      await Promise.race([
        this.#flush(),
        new Promise<void>((resolve) => setTimeout(resolve, remaining)),
      ]);
    }
  }

  async close(options: { timeoutMs?: number } = {}): Promise<void> {
    if (this.#heartbeatTimer) {
      clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    this.#activeRuns.clear();
    await this.drain(options);
  }

  async #flush(): Promise<void> {
    if (this.#flushPromise) return this.#flushPromise;
    if (this.#queue.size === 0) return;
    this.#flushPromise = this.#performFlush();
    try {
      await this.#flushPromise;
    } finally {
      this.#flushPromise = undefined;
      if (this.#queue.size > 0 && !this.#timer) {
        const hasTerminalFact = [...this.#queue.values()].some(
          (fact) => fact.status !== "running",
        );
        if (hasTerminalFact) {
          void this.#flush();
        } else {
          this.#schedule(250);
        }
      }
    }
  }

  async #performFlush(): Promise<void> {
    const batch = takeBatch(this.#queue);
    if (batch.length === 0) return;
    const body = JSON.stringify({
      schema_version: 1,
      runs: batch,
    } satisfies AmarsiaTelemetryBatchV1);
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
          keepalive: utf8ByteLength(body) <= MAX_KEEPALIVE_BYTES,
          body,
        },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.#attempt = 0;
    } catch {
      this.#attempt += 1;
      if (this.#attempt <= 6) {
        for (const fact of batch) {
          if (!this.#queue.has(fact.event_id)) {
            this.#queue.set(fact.event_id, fact);
          }
        }
        this.#schedule(Math.min(30_000, 500 * 2 ** this.#attempt));
      } else {
        this.#attempt = 0;
        console.warn(
          `Amarsia telemetry delivery failed after 6 retries; dropping ${batch.length} run update(s).`,
        );
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
  const projections = new Map<string, SessionProjection>();
  const pending = new Map<string, Promise<void>>();
  return {
    read: (sessionId) => store.read(sessionId),
    listSessionIds: () => store.listSessionIds(),
    describeLocation: store.describeLocation?.bind(store),
    subscribe: store.subscribe?.bind(store),
    subscribeAll: store.subscribeAll?.bind(store),
    async append(sessionId, events) {
      await store.append(sessionId, events);
      const runs = relevantRuns(events);
      if (
        runs.size === 0 &&
        !projections.has(sessionId) &&
        !pending.has(sessionId)
      ) {
        return;
      }
      const previous = pending.get(sessionId) ?? Promise.resolve();
      const processing = previous
        .then(async () => {
          let projection = projections.get(sessionId);
          if (!projection) {
            projection = createProjection(await store.read(sessionId));
            projections.set(sessionId, projection);
          } else {
            appendToProjection(projection, events);
          }
          if (projection.isTest) return;
          for (const run of runs) {
            const fact = projectRunFact(
              manifest,
              sessionId,
              run,
              projection,
            );
            if (fact) client.enqueue(fact);
          }
        })
        .catch(() => undefined);
      pending.set(sessionId, processing);
      void processing.finally(() => {
        if (pending.get(sessionId) === processing) {
          pending.delete(sessionId);
        }
      });
    },
  };
}

interface SessionProjection {
  readonly seenSequences: Set<number>;
  readonly runs: Map<number, SessionEvent[]>;
  sessionCreated?: SessionEvent;
  isTest: boolean;
}

function createProjection(events: SessionEvent[]): SessionProjection {
  const projection: SessionProjection = {
    seenSequences: new Set(),
    runs: new Map(),
    isTest: false,
  };
  appendToProjection(projection, events);
  return projection;
}

function appendToProjection(
  projection: SessionProjection,
  events: SessionEvent[],
): void {
  for (const event of events) {
    if (projection.seenSequences.has(event.sequence)) continue;
    projection.seenSequences.add(event.sequence);
    if (event.type === "session.created") {
      projection.sessionCreated = event;
      const metadata = asRecord(event.data.metadata);
      projection.isTest = metadata?.orchaTest === true;
    }
    if (typeof event.run !== "number") continue;
    const runEvents = projection.runs.get(event.run);
    if (runEvents) {
      runEvents.push(event);
    } else {
      projection.runs.set(event.run, [event]);
    }
  }
}

function relevantRuns(events: SessionEvent[]): Set<number> {
  const runs = new Set<number>();
  for (const event of events) {
    if (typeof event.run === "number" && RELEVANT_EVENTS.has(event.type)) {
      runs.add(event.run);
    }
  }
  return runs;
}

function projectRunFact(
  manifest: CompiledAgentManifest,
  sessionId: string,
  run: number,
  projection: SessionProjection,
): AmarsiaRunFact | undefined {
  const runEvents = projection.runs.get(run);
  if (!runEvents) return undefined;
  const started = runEvents.find((event) => event.type === "run.started");
  if (!started) return undefined;
  const terminal = [...runEvents]
    .reverse()
    .find((event) =>
      ["run.completed", "run.failed", "run.paused"].includes(event.type),
    );
  const lineage = asRecord(projection.sessionCreated?.data.lineage);
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
  const evaluationMetrics = evaluations.flatMap((event) =>
    Array.isArray(event.data.metrics) ? event.data.metrics : [],
  );
  const error = asRecord(terminal?.data.error);
  const lastAssistant = assistants.at(-1);
  const status =
    terminal?.type === "run.completed"
      ? "completed"
      : terminal?.type === "run.failed"
        ? "failed"
        : terminal?.type === "run.paused"
          ? "paused"
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
    actions: projectActionLogs(runEvents),
    evaluation_count: evaluations.length,
    evaluation_pass_count: evaluations.filter(
      (event) =>
        event.type === "evaluation.completed" &&
        event.data.status === "passed",
    ).length,
    evaluation_failure_count: evaluations.filter(
      (event) =>
        event.type === "evaluation.completed" &&
        event.data.status === "failed",
    ).length,
    evaluation_error_count: evaluations.filter(
      (event) => event.type === "evaluation.failed",
    ).length,
    evaluation_metric_count: evaluationMetrics.length,
    evaluation_metric_pass_count: evaluationMetrics.filter(
      (metric) => asRecord(metric)?.passed === true,
    ).length,
    evaluations: projectEvaluationLogs(evaluations),
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

function sumNumber(events: SessionEvent[], key: string): number {
  return events.reduce((sum, event) => sum + numberValue(event.data[key]), 0);
}

function projectActionLogs(events: SessionEvent[]) {
  const requestedByCallId = new Map<string, SessionEvent>();
  for (const event of events) {
    if (
      event.type === "action.requested" &&
      typeof event.data.callId === "string"
    ) {
      requestedByCallId.set(event.data.callId, event);
    }
  }
  return events
    .filter(
      (event) =>
        event.type === "action.completed" || event.type === "action.failed",
    )
    .slice(0, 100)
    .map((event) => {
      const error = asRecord(event.data.error);
      const requested =
        typeof event.data.callId === "string"
          ? requestedByCallId.get(event.data.callId)
          : undefined;
      return {
        call_id:
          typeof event.data.callId === "string"
            ? event.data.callId
            : `action-${event.sequence}`,
        name:
          typeof event.data.name === "string" ? event.data.name : "unknown",
        status:
          event.type === "action.completed"
            ? ("completed" as const)
            : ("failed" as const),
        started_at: requested?.timestamp ?? event.timestamp,
        ended_at: event.timestamp,
        duration_ms: numberValue(event.data.durationMs),
        ...(typeof error?.code === "string" ? { error_code: error.code } : {}),
        ...(typeof error?.message === "string"
          ? { error_message: sanitizeErrorMessage(error.message) }
          : {}),
      };
    });
}

function projectEvaluationLogs(events: SessionEvent[]) {
  return events.slice(0, 50).map((event) => {
    const usage = asRecord(event.data.usage);
    const error = asRecord(event.data.error);
    const metrics = Array.isArray(event.data.metrics)
      ? event.data.metrics
          .map(asRecord)
          .filter(
            (metric): metric is Record<string, unknown> => metric !== undefined,
          )
          .slice(0, 50)
          .map((metric) => ({
            name:
              typeof metric.name === "string" ? metric.name : "unknown_metric",
            score: numberValue(metric.score),
            threshold: numberValue(metric.threshold),
            passed: metric.passed === true,
            reasoning:
              typeof metric.reasoning === "string"
                ? sanitizeErrorMessage(metric.reasoning)
                : "",
            evidence: Array.isArray(metric.evidence)
              ? metric.evidence
                  .filter(
                    (item): item is string => typeof item === "string",
                  )
                  .slice(0, 20)
                  .map(sanitizeErrorMessage)
              : [],
          }))
      : [];
    return {
      name:
        typeof event.data.name === "string"
          ? event.data.name
          : "unknown_evaluation",
      status:
        event.type === "evaluation.failed"
          ? ("error" as const)
          : event.data.status === "passed"
            ? ("passed" as const)
            : ("failed" as const),
      ...(typeof event.data.provider === "string"
        ? { provider: event.data.provider }
        : {}),
      ...(typeof event.data.model === "string"
        ? { model: event.data.model }
        : {}),
      duration_ms: numberValue(event.data.durationMs),
      input_tokens: numberValue(usage?.inputTokens),
      output_tokens: numberValue(usage?.outputTokens),
      reasoning_tokens: numberValue(usage?.reasoningTokens),
      cache_read_tokens: numberValue(usage?.cacheReadTokens),
      cache_write_tokens: numberValue(usage?.cacheWriteTokens),
      metrics,
      ...(typeof error?.message === "string"
        ? { error_message: sanitizeErrorMessage(error.message) }
        : {}),
    };
  });
}

function takeBatch(queue: Map<string, AmarsiaRunFact>): AmarsiaRunFact[] {
  const batch: AmarsiaRunFact[] = [];
  let bytes = utf8ByteLength('{"schema_version":1,"runs":[]}');
  for (const fact of queue.values()) {
    const factBytes = utf8ByteLength(JSON.stringify(fact)) + 1;
    if (
      batch.length > 0 &&
      (batch.length >= MAX_BATCH_RUNS ||
        bytes + factBytes > MAX_KEEPALIVE_BYTES)
    ) {
      break;
    }
    batch.push(fact);
    bytes += factBytes;
  }
  return batch;
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).byteLength;
  }
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
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
    .slice(0, 8000);
}

