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

const PROGRESS_EVENTS = new Set([
  "message.created",
  "action.completed",
  "action.failed",
  "subagent.completed",
  "subagent.failed",
]);

const MAX_BATCH_RUNS = 100;
const MAX_KEEPALIVE_BYTES = 48 * 1024;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CONCURRENT_FLUSHES = 2;

export type AmarsiaRunFact = AmarsiaTelemetryRunV1;

export interface RunTelemetryModelCall {
  provider: string;
  model: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  response_id?: string;
  finish_reason?: string;
}

export interface RunTelemetryDetails {
  modelCalls: RunTelemetryModelCall[];
  lineage?: {
    parentRunNumber?: number;
    rootSessionId?: string;
    rootRunNumber?: number;
  };
}

export interface RunTelemetryClient {
  enqueue(fact: AmarsiaRunFact, details?: RunTelemetryDetails): void;
  updateActiveRun(fact: AmarsiaRunFact): void;
  trackProjection(projection: Promise<void>): void;
  drain(options?: { timeoutMs?: number }): Promise<void>;
  close(options?: { timeoutMs?: number }): Promise<void>;
}

export class AmarsiaTelemetryClient implements RunTelemetryClient {
  readonly #key: string;
  readonly #baseUrl: string;
  readonly #queue = new Map<string, AmarsiaRunFact>();
  readonly #activeRuns = new Map<string, AmarsiaRunFact>();
  readonly #terminalRuns = new Set<string>();
  readonly #pendingProjections = new Set<Promise<void>>();
  readonly #inFlightFlushes = new Set<Promise<void>>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;

  constructor(options: { key: string; endpoint?: string }) {
    this.#key = options.key;
    this.#baseUrl = resolveAmarsiaEndpoint(options.endpoint);
  }

  enqueue(fact: AmarsiaRunFact): void {
    this.#queue.set(fact.event_id, fact);
    if (fact.status === "running") {
      this.#terminalRuns.delete(fact.event_id);
      this.#activeRuns.set(fact.event_id, fact);
      this.#scheduleHeartbeat();
      if (this.#queue.size >= 20) {
        void this.#flush();
        return;
      }
      this.#schedule(250);
      return;
    }

    this.#terminalRuns.add(fact.event_id);
    this.#activeRuns.delete(fact.event_id);
    if (this.#activeRuns.size === 0 && this.#heartbeatTimer) {
      clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    void this.#flush();
  }

  updateActiveRun(fact: AmarsiaRunFact): void {
    if (fact.status !== "running" || this.#terminalRuns.has(fact.event_id)) {
      return;
    }
    if (this.#activeRuns.has(fact.event_id)) {
      this.#activeRuns.set(fact.event_id, fact);
    }
    if (this.#queue.has(fact.event_id)) {
      this.#queue.set(fact.event_id, fact);
    }
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

  /** @internal Tracks telemetry projection work that must settle before drain completes. */
  trackProjection(projection: Promise<void>): void {
    this.#pendingProjections.add(projection);
    void projection.finally(() => {
      this.#pendingProjections.delete(projection);
    });
  }

  #scheduleHeartbeat(): void {
    if (this.#heartbeatTimer || this.#activeRuns.size === 0) return;
    this.#heartbeatTimer = setTimeout(() => {
      this.#heartbeatTimer = undefined;
      for (const fact of this.#activeRuns.values()) {
        if (!this.#terminalRuns.has(fact.event_id)) {
          this.#queue.set(fact.event_id, fact);
        }
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
    while (
      this.#pendingProjections.size > 0 ||
      this.#queue.size > 0 ||
      this.#inFlightFlushes.size > 0
    ) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      if (this.#pendingProjections.size > 0) {
        await Promise.race([
          Promise.allSettled([...this.#pendingProjections]).then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, remaining)),
        ]);
        continue;
      }
      if (this.#timer) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
      }
      if (this.#queue.size > 0) {
        await Promise.race([
          this.#flush(),
          new Promise<void>((resolve) => setTimeout(resolve, remaining)),
        ]);
        continue;
      }
      if (this.#inFlightFlushes.size > 0) {
        await Promise.race([
          Promise.allSettled([...this.#inFlightFlushes]).then(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, remaining)),
        ]);
      }
    }
  }

  async close(options: { timeoutMs?: number } = {}): Promise<void> {
    if (this.#heartbeatTimer) {
      clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    this.#activeRuns.clear();
    await this.drain(options);
    if (this.#heartbeatTimer) {
      clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    this.#activeRuns.clear();
  }

  async #flush(): Promise<void> {
    if (this.#queue.size === 0) {
      if (this.#inFlightFlushes.size > 0) {
        await Promise.allSettled([...this.#inFlightFlushes]);
      }
      return;
    }
    const hasTerminalFact = [...this.#queue.values()].some(
      (fact) => fact.status !== "running",
    );
    const maxConcurrent = hasTerminalFact ? MAX_CONCURRENT_FLUSHES : 1;
    if (this.#inFlightFlushes.size >= maxConcurrent) {
      await Promise.allSettled([...this.#inFlightFlushes]);
      return;
    }

    const flushPromise = this.#performFlush();
    this.#inFlightFlushes.add(flushPromise);
    try {
      await flushPromise;
    } finally {
      this.#inFlightFlushes.delete(flushPromise);
      if (this.#queue.size > 0 && !this.#timer) {
        const remainingHasTerminal = [...this.#queue.values()].some(
          (fact) => fact.status !== "running",
        );
        if (remainingHasTerminal) {
          void this.#flush();
        } else if (this.#inFlightFlushes.size === 0) {
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
          if (
            fact.status === "running" &&
            this.#terminalRuns.has(fact.event_id)
          ) {
            continue;
          }
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

export function withRunTelemetry(options: {
  store: SessionStore;
  manifest: CompiledAgentManifest;
  client: RunTelemetryClient;
}): SessionStore {
  const { store, manifest, client } = options;
  const projections = new Map<string, SessionProjection>();
  const pending = new Map<string, Promise<void>>();
  return {
    get cloudStoragePendingCount() {
      return store.cloudStoragePendingCount;
    },
    get cloudStorageLastError() {
      return store.cloudStorageLastError;
    },
    read: (sessionId) => store.read(sessionId),
    readAfterSequence:
      store.readAfterSequence?.bind(store),
    listSessionIds: () => store.listSessionIds(),
    getCloudAcknowledgement:
      store.getCloudAcknowledgement?.bind(store),
    setCloudAcknowledgement:
      store.setCloudAcknowledgement?.bind(store),
    refreshCloudSession: store.refreshCloudSession?.bind(store),
    flushCloudStorage: store.flushCloudStorage?.bind(store),
    closeCloudStorage: store.closeCloudStorage?.bind(store),
    describeLocation: store.describeLocation?.bind(store),
    subscribe: store.subscribe?.bind(store),
    subscribeAll: store.subscribeAll?.bind(store),
    async append(sessionId, events) {
      await store.append(sessionId, events);
      const runs = relevantRuns(events);
      const progressRuns = progressOnlyRuns(events, runs);
      const hasSessionCreated = events.some(
        (event) => event.type === "session.created",
      );

      if (
        runs.size === 0 &&
        progressRuns.size === 0 &&
        !hasSessionCreated &&
        !projections.has(sessionId) &&
        !pending.has(sessionId)
      ) {
        return;
      }

      if (!pending.has(sessionId)) {
        let projection = projections.get(sessionId);
        let hasNewEvents = false;
        if (!projection && hasSessionCreated) {
          projection = createProjection(events);
          projections.set(sessionId, projection);
          hasNewEvents = projection.seenSequences.size > 0;
        } else if (projection) {
          hasNewEvents = appendToProjection(projection, events);
        }
        if (projection) {
          if (projection.isTest || !hasNewEvents) return;
          for (const run of runs) {
            const fact = projectRunFact(manifest, sessionId, run, projection);
            if (fact) {
              client.enqueue(
                fact,
                projectRunTelemetryDetails(
                  projection.runs.get(run) ?? [],
                  projection.sessionCreated,
                ),
              );
            }
          }
          for (const run of progressRuns) {
            const fact = projectRunFact(manifest, sessionId, run, projection);
            if (fact) client.updateActiveRun(fact);
          }
          return;
        }
      }

      const previous = pending.get(sessionId) ?? Promise.resolve();
      const processing = previous
        .then(async () => {
          let projection = projections.get(sessionId);
          let hasNewEvents = false;
          if (!projection) {
            projection = createProjection(await store.read(sessionId));
            projections.set(sessionId, projection);
            hasNewEvents = projection.seenSequences.size > 0;
          } else {
            hasNewEvents = appendToProjection(projection, events);
          }
          if (projection.isTest || !hasNewEvents) return;
          for (const run of runs) {
            const fact = projectRunFact(
              manifest,
              sessionId,
              run,
              projection,
            );
            if (fact) {
              client.enqueue(
                fact,
                projectRunTelemetryDetails(
                  projection.runs.get(run) ?? [],
                  projection.sessionCreated,
                ),
              );
            }
          }
          for (const run of progressRuns) {
            const fact = projectRunFact(
              manifest,
              sessionId,
              run,
              projection,
            );
            if (fact) client.updateActiveRun(fact);
          }
        })
        .catch(() => undefined);
      pending.set(sessionId, processing);
      client.trackProjection(processing);
      void processing.finally(() => {
        if (pending.get(sessionId) === processing) {
          pending.delete(sessionId);
        }
      });
    },
  };
}

export const withAmarsiaTelemetry = withRunTelemetry;

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
): boolean {
  let added = false;
  for (const event of events) {
    if (projection.seenSequences.has(event.sequence)) continue;
    projection.seenSequences.add(event.sequence);
    added = true;
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
  return added;
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

function progressOnlyRuns(
  events: SessionEvent[],
  relevant: Set<number>,
): Set<number> {
  const runs = new Set<number>();
  for (const event of events) {
    if (
      typeof event.run === "number" &&
      !relevant.has(event.run) &&
      PROGRESS_EVENTS.has(event.type)
    ) {
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

function projectRunTelemetryDetails(
  runEvents: SessionEvent[],
  sessionCreated?: SessionEvent,
): RunTelemetryDetails {
  const lineage = asRecord(sessionCreated?.data.lineage);
  return {
    modelCalls: runEvents
      .filter(
        (event) =>
          event.type === "message.created" &&
          event.data.role === "assistant",
      )
      .map((event) => {
        const usage = usageFields(asRecord(event.data.usage) ?? {});
        const duration = numberValue(event.data.durationMs);
        const endedAt = event.timestamp;
        const endedAtMs = new Date(endedAt).getTime();
        return {
          provider:
            typeof event.data.provider === "string"
              ? event.data.provider
              : "unknown",
          model:
            typeof event.data.model === "string" ? event.data.model : "unknown",
          started_at: new Date(
            Number.isFinite(endedAtMs) ? endedAtMs - duration : endedAtMs,
          ).toISOString(),
          ended_at: endedAt,
          duration_ms: duration,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          reasoning_tokens: usage.reasoning_tokens ?? 0,
          cache_read_tokens: usage.cache_read_tokens,
          cache_write_tokens: usage.cache_write_tokens,
          ...(typeof event.data.responseId === "string"
            ? { response_id: event.data.responseId }
            : {}),
          ...(typeof event.data.stopReason === "string"
            ? { finish_reason: event.data.stopReason }
            : {}),
        };
      }),
    ...(lineage
      ? {
          lineage: {
            ...(typeof lineage.parentRunNumber === "number"
              ? { parentRunNumber: lineage.parentRunNumber }
              : {}),
            ...(typeof lineage.rootSessionId === "string"
              ? { rootSessionId: lineage.rootSessionId }
              : {}),
            ...(typeof lineage.rootRunNumber === "number"
              ? { rootRunNumber: lineage.rootRunNumber }
              : {}),
          },
        }
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

export function sanitizeErrorMessage(value: string): string {
  return (
    value
      // 1. Auth schemes & JWTs
      .replace(
        /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
        "$1 [redacted]",
      )
      .replace(
        /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
        "[redacted]",
      )
      // 2. URL embedded credentials (e.g. https://user:token@host, postgres://user:pass@host)
      .replace(
        /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+:[^/\s@]+@)/gi,
        "$1[redacted]@",
      )
      // 3. Key-value secrets & credentials
      .replace(
        /\b(authorization|api[-_ ]?key|access[-_ ]?key|secret[-_ ]?key|client[-_ ]?secret|private[-_ ]?key|session[-_ ]?token|refresh[-_ ]?token|token|secret|password|passwd|pwd|credential)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
        "$1=[redacted]",
      )
      // 4. Prefixed API keys & cloud access keys
      .replace(
        /\b(?:sk|pk|rk|ak|amarsia|ams_proj|ghp|gho|ghu|ghs|ghr|glpat|xox[baprs])_[A-Za-z0-9_-]{8,}\b/gi,
        "[redacted]",
      )
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]")
      // 5. Tax IDs (SSN / ITIN / EIN / TIN), payment cards, & bank accounts
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
      .replace(/(?<![\d-])\b\d{2}-\d{7}\b(?![\d-])/g, "[redacted-tin]")
      .replace(
        /\b(ssn|itin|ein|tin|tax[-_ ]?id|routing[-_ ]?number|account[-_ ]?number|acct[-_ ]?(?:no|num|#)?|iban|swift)\b(\s*(?:is|#|:|=)?\s*)[A-Z0-9-]{4,34}\b/gi,
        "$1$2[redacted-id]",
      )
      .replace(/\b(?:\d{4}[ -]?){3}\d{1,7}\b/g, "[redacted-card]")
      // 6. Contact PII (Email addresses & phone numbers)
      .replace(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
        "[redacted-email]",
      )
      .replace(
        /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g,
        "[redacted-phone]",
      )
      // 7. Client financial figures & currency amounts
      .replace(
        /(?:[$€£¥₹]|(?:\b(?:USD|EUR|GBP|CAD|AUD|JPY|INR|CHF)\s*))\s*[-+]?\d[\d,]*(?:\.\d+)?(?:\s*(?:k|m|b|bn|mm|thousand|million|billion))?\b/gi,
        "[redacted-amount]",
      )
      .replace(
        /\b[-+]?\d[\d,]*(?:\.\d+)?\s*(?:USD|EUR|GBP|CAD|AUD|JPY|INR|CHF|dollars?|cents?|euros?|pounds?)\b/gi,
        "[redacted-amount]",
      )
      .replace(
        /\b[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,
        "[redacted-figure]",
      )
      .replace(
        /\b(amount|total|subtotal|balance|income|revenue|salary|wages|compensation|distribution|deduction|tax|profit|loss|cost|price|fee|payment|invoice|net|gross|asset|liability|equity|credit|debit)(\s+(?:of|is|was|equals|=|:)\s*)[-+]?\d[\d,]*(?:\.\d+)?%?/gi,
        "$1$2[redacted-figure]",
      )
      // 8. Local user filesystem paths
      .replace(
        /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s,;'")\]}]+/g,
        "[redacted-path]",
      )
      .slice(0, 8000)
  );
}
