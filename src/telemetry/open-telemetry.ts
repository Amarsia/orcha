import type {
  Attributes,
  Context,
  Span,
  Tracer,
} from "@opentelemetry/api";
import type {
  AmarsiaRunFact,
  RunTelemetryClient,
  RunTelemetryDetails,
  RunTelemetryModelCall,
} from "../amarsia/analytics.js";

export type OpenTelemetryConfiguration =
  | true
  | {
      endpoint: string;
      headers?: Record<string, string>;
    };

const MAX_QUEUED_RUNS = 1_000;
const MAX_CONCURRENT_EXPORTS = 2;

export class CompositeRunTelemetryClient implements RunTelemetryClient {
  readonly #clients: RunTelemetryClient[];

  constructor(clients: RunTelemetryClient[]) {
    this.#clients = clients;
  }

  enqueue(fact: AmarsiaRunFact, details?: RunTelemetryDetails): void {
    for (const client of this.#clients) {
      try {
        client.enqueue(fact, details);
      } catch (error) {
        console.warn("A telemetry exporter rejected an Orcha run.", error);
      }
    }
  }

  updateActiveRun(fact: AmarsiaRunFact): void {
    for (const client of this.#clients) {
      try {
        client.updateActiveRun(fact);
      } catch (error) {
        console.warn("A telemetry exporter rejected an Orcha update.", error);
      }
    }
  }

  trackProjection(projection: Promise<void>): void {
    for (const client of this.#clients) client.trackProjection(projection);
  }

  async drain(options?: { timeoutMs?: number }): Promise<void> {
    await Promise.allSettled(
      this.#clients.map((client) => client.drain(options)),
    );
  }

  async close(options?: { timeoutMs?: number }): Promise<void> {
    await Promise.allSettled(
      this.#clients.map((client) => client.close(options)),
    );
  }
}

export function createOpenTelemetryClient(
  configuration: OpenTelemetryConfiguration,
): RunTelemetryClient {
  return configuration === true
    ? new GlobalOpenTelemetryClient()
    : new OtlpHttpTelemetryClient(configuration);
}

class GlobalOpenTelemetryClient implements RunTelemetryClient {
  readonly #pendingProjections = new Set<Promise<void>>();
  readonly #pendingEmissions = new Set<Promise<void>>();
  readonly #emissionChains = new Map<string, Promise<void>>();
  readonly #activeSpans = new Map<
    string,
    {
      api: OpenTelemetryApi;
      span: Span;
      context: Context;
    }
  >();

  enqueue(fact: AmarsiaRunFact, details?: RunTelemetryDetails): void {
    const previous = this.#emissionChains.get(fact.event_id) ?? Promise.resolve();
    const emission = previous
      .then(() => this.#emit(fact, details))
      .catch((error: unknown) => {
        console.warn("OpenTelemetry global-provider delivery failed.", error);
      });
    this.#emissionChains.set(fact.event_id, emission);
    this.#pendingEmissions.add(emission);
    void emission.finally(() => {
      this.#pendingEmissions.delete(emission);
      if (this.#emissionChains.get(fact.event_id) === emission) {
        this.#emissionChains.delete(fact.event_id);
      }
    });
  }

  async #emit(
    fact: AmarsiaRunFact,
    details?: RunTelemetryDetails,
  ): Promise<void> {
    const api = await loadOpenTelemetryApi();
    const tracer = api.trace.getTracer("orchajs");
    const active =
      this.#activeSpans.get(fact.event_id) ??
      this.#startSpan(api, tracer, fact, details);
    if (fact.status === "running") return;
    const { span, context: parentContext } = active;
    span.setAttributes(runAttributes(fact));
    for (const modelCall of details?.modelCalls ?? []) {
      const modelSpan = tracer.startSpan(
        `chat ${modelCall.model}`,
        {
          kind: api.SpanKind.CLIENT,
          startTime: new Date(modelCall.started_at),
          attributes: modelCallAttributes(fact, modelCall),
        },
        parentContext,
      );
      modelSpan.setStatus({ code: api.SpanStatusCode.OK });
      modelSpan.end(new Date(modelCall.ended_at));
    }
    for (const action of fact.actions) {
      const actionSpan = tracer.startSpan(
        `execute_tool ${action.name}`,
        {
          kind: api.SpanKind.INTERNAL,
          startTime: new Date(action.started_at),
          attributes: {
            "gen_ai.operation.name": "execute_tool",
            "gen_ai.tool.name": action.name,
            "gen_ai.tool.type": "function",
            "gen_ai.tool.call.id": action.call_id,
            "gen_ai.agent.name": fact.agent_external_id,
            "gen_ai.conversation.id": fact.session_id,
            "orcha.span.type": "action",
            "orcha.action.call_id": action.call_id,
            "orcha.action.duration_ms": action.duration_ms,
          },
        },
        parentContext,
      );
      if (action.status === "failed") {
        actionSpan.addEvent("exception", {
          "exception.type": action.error_code ?? "action_error",
          "exception.message": action.error_message ?? "Action failed",
        });
        actionSpan.setStatus({
          code: api.SpanStatusCode.ERROR,
          message: action.error_message,
        });
        if (action.error_code) {
          actionSpan.setAttribute("error.type", action.error_code);
        }
      } else {
        actionSpan.setStatus({ code: api.SpanStatusCode.OK });
      }
      actionSpan.end(new Date(action.ended_at));
    }
    for (const event of evaluationResultEvents(fact)) {
      span.addEvent(
        event.name,
        event.attributes,
        new Date(fact.ended_at ?? fact.started_at),
      );
    }
    if (fact.status === "failed") {
      span.addEvent("exception", {
        "exception.type": fact.error_code ?? "agent_run_error",
        "exception.message": fact.error_message ?? "Agent run failed",
      });
      span.setStatus({
        code: api.SpanStatusCode.ERROR,
        message: fact.error_message,
      });
      if (fact.error_code) span.setAttribute("error.type", fact.error_code);
    } else {
      span.setStatus({ code: api.SpanStatusCode.OK });
    }
    span.end(new Date(fact.ended_at ?? fact.started_at));
    this.#activeSpans.delete(fact.event_id);
  }

  #startSpan(
    api: OpenTelemetryApi,
    tracer: Tracer,
    fact: AmarsiaRunFact,
    details?: RunTelemetryDetails,
  ): { api: OpenTelemetryApi; span: Span; context: Context } {
    const parent = parentEventId(fact, details);
    const parentContext = parent
      ? this.#activeSpans.get(parent)?.context
      : undefined;
    const span = tracer.startSpan(
      `invoke_agent ${fact.agent_external_id}`,
      {
        kind: api.SpanKind.INTERNAL,
        startTime: new Date(fact.started_at),
        attributes: runAttributes(fact),
      },
      parentContext,
    );
    const active = {
      api,
      span,
      context: api.trace.setSpan(parentContext ?? api.context.active(), span),
    };
    this.#activeSpans.set(fact.event_id, active);
    return active;
  }

  updateActiveRun(_fact: AmarsiaRunFact): void {}

  trackProjection(projection: Promise<void>): void {
    this.#pendingProjections.add(projection);
    void projection.finally(() => this.#pendingProjections.delete(projection));
  }

  async drain(options: { timeoutMs?: number } = {}): Promise<void> {
    if (
      this.#pendingProjections.size === 0 &&
      this.#pendingEmissions.size === 0
    ) {
      return;
    }
    await withTimeout(
      Promise.allSettled([
        ...this.#pendingProjections,
        ...this.#pendingEmissions,
      ]).then(() => undefined),
      options.timeoutMs ?? 2_000,
    );
  }

  async close(options?: { timeoutMs?: number }): Promise<void> {
    await this.drain(options);
    for (const { api, span } of this.#activeSpans.values()) {
      span.setAttributes({
        "orcha.run.status": "interrupted",
        "error.type": "process_shutdown",
      });
      span.addEvent("exception", {
        "exception.type": "process_shutdown",
        "exception.message":
          "Orcha closed before the agent run emitted a terminal event.",
      });
      span.setStatus({
        code: api.SpanStatusCode.ERROR,
        message: "Agent run interrupted by process shutdown",
      });
      span.end();
    }
    this.#activeSpans.clear();
  }
}

class OtlpHttpTelemetryClient implements RunTelemetryClient {
  readonly #endpoint: string;
  readonly #headers: Record<string, string>;
  readonly #queue = new Map<string, OtlpSpan[]>();
  readonly #activeRuns = new Map<
    string,
    { fact: AmarsiaRunFact; details?: RunTelemetryDetails }
  >();
  readonly #pendingProjections = new Set<Promise<void>>();
  readonly #inFlight = new Set<Promise<void>>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #closed = false;

  constructor(options: {
    endpoint: string;
    headers?: Record<string, string>;
  }) {
    const endpoint = options.endpoint.trim().replace(/\/+$/, "");
    if (!endpoint) {
      throw new Error("telemetry.otel.endpoint must be a non-empty URL.");
    }
    this.#endpoint = endpoint.endsWith("/v1/traces")
      ? endpoint
      : `${endpoint}/v1/traces`;
    this.#headers = options.headers ?? {};
  }

  enqueue(fact: AmarsiaRunFact, details?: RunTelemetryDetails): void {
    if (this.#closed) return;
    if (fact.status === "running") {
      this.#activeRuns.set(fact.event_id, { fact, details });
      return;
    }
    this.#activeRuns.delete(fact.event_id);
    if (
      !this.#queue.has(fact.event_id) &&
      this.#queue.size >= MAX_QUEUED_RUNS
    ) {
      const oldest = this.#queue.keys().next().value;
      if (oldest) this.#queue.delete(oldest);
      console.warn(
        "OpenTelemetry queue is full; dropping the oldest queued run.",
      );
    }
    this.#queue.set(fact.event_id, otlpSpans(fact, details));
    if (this.#queue.size >= 20) {
      void this.#flush();
    } else {
      this.#schedule();
    }
  }

  updateActiveRun(fact: AmarsiaRunFact): void {
    const active = this.#activeRuns.get(fact.event_id);
    if (active) this.#activeRuns.set(fact.event_id, { ...active, fact });
  }

  trackProjection(projection: Promise<void>): void {
    this.#pendingProjections.add(projection);
    void projection.finally(() => this.#pendingProjections.delete(projection));
  }

  async drain(options: { timeoutMs?: number } = {}): Promise<void> {
    const timeoutMs = Math.max(0, options.timeoutMs ?? 2_000);
    const operation = (async () => {
      await Promise.allSettled([...this.#pendingProjections]);
      if (this.#timer) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
      }
      while (this.#queue.size > 0) {
        if (this.#inFlight.size >= MAX_CONCURRENT_EXPORTS) {
          await Promise.allSettled([...this.#inFlight]);
        }
        const queuedBeforeFlush = this.#queue.size;
        await this.#flush();
        if (this.#queue.size >= queuedBeforeFlush) break;
      }
      await Promise.allSettled([...this.#inFlight]);
    })();
    await withTimeout(operation, timeoutMs);
  }

  async close(options?: { timeoutMs?: number }): Promise<void> {
    const endedAt = new Date().toISOString();
    for (const [eventId, active] of this.#activeRuns) {
      this.#queue.set(
        eventId,
        otlpSpans(
          {
            ...active.fact,
            status: "failed",
            ended_at: endedAt,
            duration_ms: Math.max(
              0,
              new Date(endedAt).getTime() -
                new Date(active.fact.started_at).getTime(),
            ),
            error_code: "process_shutdown",
            error_message:
              "Orcha closed before the agent run emitted a terminal event.",
            error_retryable: true,
          },
          active.details,
        ),
      );
    }
    this.#activeRuns.clear();
    await this.drain(options);
    this.#closed = true;
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }

  #schedule(delay = 250): void {
    if (this.#closed || this.#timer) return;
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
    if (this.#inFlight.size >= MAX_CONCURRENT_EXPORTS) {
      this.#schedule();
      return;
    }
    const entries = [...this.#queue.entries()].slice(0, 20);
    for (const [id] of entries) this.#queue.delete(id);
    const spans = entries.flatMap(([, value]) => value);
    const body = JSON.stringify(otlpRequest(spans));
    const operation = fetch(this.#endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.#headers,
      },
      body,
      keepalive: utf8ByteLength(body) <= 48 * 1024,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.#attempt = 0;
      })
      .catch((error: unknown) => {
        this.#attempt += 1;
        if (this.#attempt <= 6) {
          for (const [id, value] of entries) this.#queue.set(id, value);
          this.#schedule(Math.min(30_000, 500 * 2 ** this.#attempt));
        } else {
          this.#attempt = 0;
          console.warn(
            `OpenTelemetry delivery failed after 6 retries; dropping ${entries.length} run(s).`,
            error,
          );
        }
      });
    this.#inFlight.add(operation);
    try {
      await operation;
    } finally {
      this.#inFlight.delete(operation);
      if (this.#queue.size > 0) this.#schedule();
    }
  }
}

function runAttributes(fact: AmarsiaRunFact): Attributes {
  return {
    "gen_ai.operation.name": "invoke_agent",
    "gen_ai.agent.id": fact.agent_external_id,
    "gen_ai.agent.name": fact.agent_external_id,
    "gen_ai.provider.name": fact.provider,
    "gen_ai.request.model": fact.model,
    "gen_ai.conversation.id": fact.session_id,
    "gen_ai.usage.input_tokens": fact.input_tokens,
    "gen_ai.usage.output_tokens": fact.output_tokens,
    "orcha.run.number": fact.run_number,
    "orcha.run.status": fact.status,
    "orcha.span.type": "agent_run",
    "orcha.agent.id": fact.agent_external_id,
    "orcha.session.id": fact.session_id,
    "orcha.run.duration_ms": fact.duration_ms ?? 0,
    "orcha.run.model_duration_ms": fact.model_duration_ms,
    "orcha.run.action_duration_ms": fact.action_duration_ms,
    "orcha.usage.reasoning_tokens": fact.reasoning_tokens ?? 0,
    "orcha.usage.cache_read_tokens": fact.cache_read_tokens,
    "orcha.usage.cache_write_tokens": fact.cache_write_tokens,
    "orcha.action.count": fact.action_count,
    "orcha.action.success_count": fact.action_success_count,
    "orcha.action.failure_count": fact.action_failure_count,
    "orcha.subagent.count": fact.subagent_count,
    "orcha.evaluation.count": fact.evaluation_count,
    ...(fact.parent_agent_external_id
      ? { "orcha.parent.agent_id": fact.parent_agent_external_id }
      : {}),
    ...(fact.parent_session_id
      ? { "orcha.parent.session_id": fact.parent_session_id }
      : {}),
    ...(fact.stop_reason
      ? { "gen_ai.response.finish_reasons": [fact.stop_reason] }
      : {}),
  };
}

function modelCallAttributes(
  fact: AmarsiaRunFact,
  modelCall: RunTelemetryModelCall,
): Attributes {
  return {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": modelCall.provider,
    "gen_ai.request.model": modelCall.model,
    "gen_ai.response.model": modelCall.model,
    "gen_ai.conversation.id": fact.session_id,
    "gen_ai.agent.name": fact.agent_external_id,
    "gen_ai.usage.input_tokens": modelCall.input_tokens,
    "gen_ai.usage.output_tokens": modelCall.output_tokens,
    "orcha.usage.reasoning_tokens": modelCall.reasoning_tokens,
    "orcha.usage.cache_read_tokens": modelCall.cache_read_tokens,
    "orcha.usage.cache_write_tokens": modelCall.cache_write_tokens,
    "orcha.model.duration_ms": modelCall.duration_ms,
    ...(modelCall.response_id
      ? { "gen_ai.response.id": modelCall.response_id }
      : {}),
    ...(modelCall.finish_reason
      ? { "gen_ai.response.finish_reasons": [modelCall.finish_reason] }
      : {}),
  };
}

function evaluationResultEvents(
  fact: AmarsiaRunFact,
): Array<{ name: string; attributes: Attributes }> {
  const events: Array<{ name: string; attributes: Attributes }> = [];
  for (const evaluation of fact.evaluations) {
    if (evaluation.metrics.length === 0) {
      events.push({
        name: "gen_ai.evaluation.result",
        attributes: {
          "gen_ai.evaluation.name": evaluation.name,
          "gen_ai.evaluation.score.label": evaluation.status,
          "orcha.evaluation.duration_ms": evaluation.duration_ms,
          ...(evaluation.error_message
            ? {
                "error.type": "evaluation_error",
                "orcha.evaluation.error_message": evaluation.error_message,
              }
            : {}),
        },
      });
      continue;
    }
    for (const metric of evaluation.metrics) {
      events.push({
        name: "gen_ai.evaluation.result",
        attributes: {
          "gen_ai.evaluation.name": metric.name,
          "gen_ai.evaluation.score.value": metric.score,
          "gen_ai.evaluation.score.label": metric.passed ? "pass" : "fail",
          "gen_ai.evaluation.explanation": metric.reasoning,
          "orcha.evaluation.name": evaluation.name,
          "orcha.evaluation.duration_ms": evaluation.duration_ms,
          ...(metric.evidence.length > 0
            ? { "orcha.evaluation.evidence": metric.evidence }
            : {}),
        },
      });
    }
  }
  return events;
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  events?: Array<{
    timeUnixNano: string;
    name: string;
    attributes: OtlpAttribute[];
  }>;
  status: { code: number; message?: string };
}

interface OtlpAttribute {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: string }
    | { doubleValue: number }
    | { boolValue: boolean }
    | { arrayValue: { values: Array<{ stringValue: string }> } };
}

function otlpSpans(
  fact: AmarsiaRunFact,
  details?: RunTelemetryDetails,
): OtlpSpan[] {
  const rootSessionId =
    details?.lineage?.rootSessionId ??
    fact.parent_session_id ??
    fact.session_id;
  const rootRunNumber =
    details?.lineage?.rootRunNumber ??
    details?.lineage?.parentRunNumber ??
    fact.run_number;
  const traceId = stableHex(
    `trace:${rootSessionId}:${rootRunNumber}`,
    32,
  );
  const rootSpanId = stableHex(`span:${fact.event_id}`, 16);
  const parentId = parentEventId(fact, details);
  const root: OtlpSpan = {
    traceId,
    spanId: rootSpanId,
    ...(parentId
      ? { parentSpanId: stableHex(`span:${parentId}`, 16) }
      : {}),
    name: `invoke_agent ${fact.agent_external_id}`,
    kind: 1,
    startTimeUnixNano: unixNanos(fact.started_at),
    endTimeUnixNano: unixNanos(fact.ended_at ?? fact.started_at),
    attributes: otlpAttributes(runAttributes(fact)),
    events: [
      ...evaluationResultEvents(fact).map((event) => ({
        timeUnixNano: unixNanos(fact.ended_at ?? fact.started_at),
        name: event.name,
        attributes: otlpAttributes(event.attributes),
      })),
      ...(fact.status === "failed"
        ? [
            {
              timeUnixNano: unixNanos(fact.ended_at ?? fact.started_at),
              name: "exception",
              attributes: otlpAttributes({
                "exception.type": fact.error_code ?? "agent_run_error",
                "exception.message":
                  fact.error_message ?? "Agent run failed",
              }),
            },
          ]
        : []),
    ],
    status:
      fact.status === "failed"
        ? { code: 2, message: fact.error_message }
        : { code: 1 },
  };
  const modelCalls = (details?.modelCalls ?? []).map(
    (modelCall, index): OtlpSpan => ({
      traceId,
      spanId: stableHex(`model:${fact.event_id}:${index}`, 16),
      parentSpanId: rootSpanId,
      name: `chat ${modelCall.model}`,
      kind: 3,
      startTimeUnixNano: unixNanos(modelCall.started_at),
      endTimeUnixNano: unixNanos(modelCall.ended_at),
      attributes: otlpAttributes(modelCallAttributes(fact, modelCall)),
      status: { code: 1 },
    }),
  );
  const actions = fact.actions.map(
    (action): OtlpSpan => ({
      traceId,
      spanId: stableHex(`action:${fact.event_id}:${action.call_id}`, 16),
      parentSpanId: rootSpanId,
      name: `execute_tool ${action.name}`,
      kind: 1,
      startTimeUnixNano: unixNanos(action.started_at),
      endTimeUnixNano: unixNanos(action.ended_at),
      attributes: otlpAttributes({
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": action.name,
        "gen_ai.tool.type": "function",
        "gen_ai.tool.call.id": action.call_id,
        "gen_ai.agent.name": fact.agent_external_id,
        "gen_ai.conversation.id": fact.session_id,
        "orcha.span.type": "action",
        "orcha.action.call_id": action.call_id,
        "orcha.action.duration_ms": action.duration_ms,
        ...(action.error_code ? { "error.type": action.error_code } : {}),
      }),
      events:
        action.status === "failed"
          ? [
              {
                timeUnixNano: unixNanos(action.ended_at),
                name: "exception",
                attributes: otlpAttributes({
                  "exception.type": action.error_code ?? "action_error",
                  "exception.message":
                    action.error_message ?? "Action failed",
                }),
              },
            ]
          : undefined,
      status:
        action.status === "failed"
          ? { code: 2, message: action.error_message }
          : { code: 1 },
    }),
  );
  return [root, ...modelCalls, ...actions];
}

function parentEventId(
  fact: AmarsiaRunFact,
  details?: RunTelemetryDetails,
): string | undefined {
  if (
    !fact.parent_agent_external_id ||
    !fact.parent_session_id ||
    !details?.lineage?.parentRunNumber
  ) {
    return undefined;
  }
  return `${fact.parent_agent_external_id}:${fact.parent_session_id}:${details.lineage.parentRunNumber}`;
}

function otlpRequest(spans: OtlpSpan[]) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: otlpAttributes({
            "service.name": "orchajs",
            "telemetry.sdk.language": "nodejs",
          }),
        },
        scopeSpans: [
          {
            scope: { name: "orchajs" },
            spans,
          },
        ],
      },
    ],
  };
}

function otlpAttributes(attributes: Attributes): OtlpAttribute[] {
  const output: OtlpAttribute[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      output.push({
        key,
        value: {
          arrayValue: {
            values: value.map((item) => ({ stringValue: String(item) })),
          },
        },
      });
    } else if (typeof value === "string") {
      output.push({ key, value: { stringValue: value } });
    } else if (typeof value === "boolean") {
      output.push({ key, value: { boolValue: value } });
    } else if (typeof value === "number") {
      output.push({
        key,
        value: Number.isInteger(value)
          ? { intValue: String(value) }
          : { doubleValue: value },
      });
    }
  }
  return output;
}

function unixNanos(value: string): string {
  return (BigInt(new Date(value).getTime()) * 1_000_000n).toString();
}

function stableHex(value: string, length: number): string {
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  for (let index = 0; index < value.length; index += 1) {
    const code = BigInt(value.charCodeAt(index));
    first = BigInt.asUintN(64, (first ^ code) * 0x100000001b3n);
    second = BigInt.asUintN(64, (second ^ (code + 31n)) * 0x100000001b3n);
  }
  return `${first.toString(16).padStart(16, "0")}${second
    .toString(16)
    .padStart(16, "0")}`.slice(0, length);
}

async function withTimeout(
  operation: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  if (timeoutMs <= 0) return;
  await Promise.race([
    operation,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length;
}

type OpenTelemetryApi = typeof import("@opentelemetry/api");

let openTelemetryApiPromise: Promise<OpenTelemetryApi> | undefined;

function loadOpenTelemetryApi(): Promise<OpenTelemetryApi> {
  openTelemetryApiPromise ??= runtimeImport("@opentelemetry/api");
  return openTelemetryApiPromise;
}

const runtimeImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<OpenTelemetryApi>;
