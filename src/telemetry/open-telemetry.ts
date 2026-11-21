import type {
  Attributes,
  Context,
  Span,
  Tracer,
} from "@opentelemetry/api";
import type {
  AmarsiaRunFact,
  RunTelemetryCaptureNeeds,
  RunTelemetryClient,
  RunTelemetryDetails,
  RunTelemetryModelCall,
} from "../amarsia/analytics.js";
import type {
  OpenTelemetryConfiguration,
  OpenTelemetryOptions,
  OpenTelemetryRedactContext,
  OpenTelemetryRedactor,
} from "../types.js";

const MAX_QUEUED_RUNS = 1_000;
const MAX_CONCURRENT_EXPORTS = 2;
const DEFAULT_SERVICE_NAME = "orchajs";

interface ResolvedCaptureConfiguration {
  content: boolean;
  actionIO: boolean;
  evaluationDetail: boolean;
}

interface ResolvedOpenTelemetrySettings {
  capture: ResolvedCaptureConfiguration;
  redact?: OpenTelemetryRedactor;
}

export class CompositeRunTelemetryClient implements RunTelemetryClient {
  readonly #clients: RunTelemetryClient[];

  constructor(clients: RunTelemetryClient[]) {
    this.#clients = clients;
  }

  get captureNeeds(): RunTelemetryCaptureNeeds {
    return {
      content: this.#clients.some((client) => client.captureNeeds?.content === true),
      actionIO: this.#clients.some((client) => client.captureNeeds?.actionIO === true),
    };
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

export function resolveOpenTelemetryClient(
  configuration: OpenTelemetryConfiguration | undefined,
  env: Record<string, string | undefined> = readProcessEnv(),
): RunTelemetryClient | undefined {
  if (configuration === false) {
    return undefined;
  }

  const envEndpoint = nonEmptyString(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const envHeaders = parseKeyValuePairs(env.OTEL_EXPORTER_OTLP_HEADERS);
  const envResourceAttributes = parseKeyValuePairs(
    env.OTEL_RESOURCE_ATTRIBUTES,
  );
  const envServiceName = nonEmptyString(env.OTEL_SERVICE_NAME);
  const envCaptureContent = parseBooleanEnv(
    env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
  );

  if (configuration === undefined) {
    if (!envEndpoint) {
      return undefined;
    }
    const serviceName =
      envServiceName ??
      nonEmptyString(envResourceAttributes["service.name"]) ??
      DEFAULT_SERVICE_NAME;
    return new OtlpHttpTelemetryClient({
      endpoint: envEndpoint,
      headers: envHeaders,
      resourceAttributes: {
        "telemetry.sdk.language": "nodejs",
        ...envResourceAttributes,
        "service.name": serviceName,
      },
      capture: {
        content: envCaptureContent ?? false,
        actionIO: false,
        evaluationDetail: true,
      },
    });
  }

  if (configuration === true) {
    return new GlobalOpenTelemetryClient({
      capture: {
        content: envCaptureContent ?? false,
        actionIO: false,
        evaluationDetail: true,
      },
    });
  }

  const options: OpenTelemetryOptions = configuration;
  if (options.endpoint !== undefined && options.endpoint.trim() === "") {
    throw new Error("telemetry.otel.endpoint must be a non-empty URL.");
  }

  const capture: ResolvedCaptureConfiguration = {
    content: options.capture?.content ?? envCaptureContent ?? false,
    actionIO: options.capture?.actionIO ?? false,
    evaluationDetail: options.capture?.evaluationDetail ?? true,
  };

  const effectiveEndpoint = nonEmptyString(options.endpoint) ?? envEndpoint;
  if (!effectiveEndpoint) {
    return new GlobalOpenTelemetryClient({
      capture,
      redact: options.redact,
    });
  }

  const explicitResourceAttributes = options.resourceAttributes ?? {};
  const serviceName =
    nonEmptyString(options.serviceName) ??
    nonEmptyString(explicitResourceAttributes["service.name"]) ??
    envServiceName ??
    nonEmptyString(envResourceAttributes["service.name"]) ??
    DEFAULT_SERVICE_NAME;

  return new OtlpHttpTelemetryClient({
    endpoint: effectiveEndpoint,
    headers: mergeHeaders(envHeaders, options.headers),
    resourceAttributes: {
      "telemetry.sdk.language": "nodejs",
      ...envResourceAttributes,
      ...explicitResourceAttributes,
      "service.name": serviceName,
    },
    capture,
    redact: options.redact,
  });
}

export function createOpenTelemetryClient(
  configuration: OpenTelemetryConfiguration,
  env?: Record<string, string | undefined>,
): RunTelemetryClient {
  const client = resolveOpenTelemetryClient(configuration, env);
  if (!client) {
    throw new Error("OpenTelemetry is disabled.");
  }
  return client;
}

class GlobalOpenTelemetryClient implements RunTelemetryClient {
  readonly #settings: ResolvedOpenTelemetrySettings;
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

  constructor(settings: ResolvedOpenTelemetrySettings) {
    this.#settings = settings;
  }

  get captureNeeds(): RunTelemetryCaptureNeeds {
    return {
      content: this.#settings.capture.content,
      actionIO: this.#settings.capture.actionIO,
    };
  }

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
    span.setAttributes(runAttributes(fact, details, this.#settings));
    for (const modelCall of details?.modelCalls ?? []) {
      const modelSpan = tracer.startSpan(
        `chat ${modelCall.model}`,
        {
          kind: api.SpanKind.CLIENT,
          startTime: new Date(modelCall.started_at),
          attributes: modelCallAttributes(fact, modelCall, this.#settings),
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
          attributes: actionAttributes(fact, action, details, this.#settings),
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
      } else {
        actionSpan.setStatus({ code: api.SpanStatusCode.OK });
      }
      actionSpan.end(new Date(action.ended_at));
    }
    for (const event of evaluationResultEvents(fact, this.#settings)) {
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
        attributes: runAttributes(fact, details, this.#settings),
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
  readonly #resourceAttributes: Attributes;
  readonly #settings: ResolvedOpenTelemetrySettings;
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
    resourceAttributes: Attributes;
    capture: ResolvedCaptureConfiguration;
    redact?: OpenTelemetryRedactor;
  }) {
    const endpoint = options.endpoint.trim().replace(/\/+$/, "");
    if (!endpoint) {
      throw new Error("telemetry.otel.endpoint must be a non-empty URL.");
    }
    this.#endpoint = endpoint.endsWith("/v1/traces")
      ? endpoint
      : `${endpoint}/v1/traces`;
    this.#headers = options.headers ?? {};
    this.#resourceAttributes = options.resourceAttributes;
    this.#settings = {
      capture: options.capture,
      redact: options.redact,
    };
  }

  get captureNeeds(): RunTelemetryCaptureNeeds {
    return {
      content: this.#settings.capture.content,
      actionIO: this.#settings.capture.actionIO,
    };
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
    this.#queue.set(fact.event_id, otlpSpans(fact, details, this.#settings));
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
          this.#settings,
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
    const body = JSON.stringify(otlpRequest(spans, this.#resourceAttributes));
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

function runAttributes(
  fact: AmarsiaRunFact,
  details: RunTelemetryDetails | undefined,
  settings: ResolvedOpenTelemetrySettings,
): Attributes {
  const attributes: Attributes = {
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
    "orcha.run.duration_ms":
      fact.duration_ms ??
      (fact.ended_at
        ? Math.max(
            0,
            new Date(fact.ended_at).getTime() -
              new Date(fact.started_at).getTime(),
          )
        : 0),
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

  if (settings.capture.content) {
    if (details?.inputMessages && details.inputMessages.length > 0) {
      const value = formatCapturedValue(
        details.inputMessages,
        {
          spanType: "agent_run",
          attribute: "gen_ai.input.messages",
          agentId: fact.agent_external_id,
          sessionId: fact.session_id,
          runNumber: fact.run_number,
        },
        settings.redact,
      );
      if (value !== undefined) attributes["gen_ai.input.messages"] = value;
    }
    if (details?.outputMessages && details.outputMessages.length > 0) {
      const value = formatCapturedValue(
        details.outputMessages,
        {
          spanType: "agent_run",
          attribute: "gen_ai.output.messages",
          agentId: fact.agent_external_id,
          sessionId: fact.session_id,
          runNumber: fact.run_number,
        },
        settings.redact,
      );
      if (value !== undefined) attributes["gen_ai.output.messages"] = value;
    }
  }

  return attributes;
}

function modelCallAttributes(
  fact: AmarsiaRunFact,
  modelCall: RunTelemetryModelCall,
  settings: ResolvedOpenTelemetrySettings,
): Attributes {
  const attributes: Attributes = {
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

  if (settings.capture.content) {
    if (modelCall.inputMessages && modelCall.inputMessages.length > 0) {
      const value = formatCapturedValue(
        modelCall.inputMessages,
        {
          spanType: "chat",
          attribute: "gen_ai.input.messages",
          agentId: fact.agent_external_id,
          sessionId: fact.session_id,
          runNumber: fact.run_number,
          model: modelCall.model,
        },
        settings.redact,
      );
      if (value !== undefined) attributes["gen_ai.input.messages"] = value;
    }
    if (modelCall.outputMessages && modelCall.outputMessages.length > 0) {
      const value = formatCapturedValue(
        modelCall.outputMessages,
        {
          spanType: "chat",
          attribute: "gen_ai.output.messages",
          agentId: fact.agent_external_id,
          sessionId: fact.session_id,
          runNumber: fact.run_number,
          model: modelCall.model,
        },
        settings.redact,
      );
      if (value !== undefined) attributes["gen_ai.output.messages"] = value;
    }
  }

  return attributes;
}

function actionAttributes(
  fact: AmarsiaRunFact,
  action: AmarsiaRunFact["actions"][number],
  details: RunTelemetryDetails | undefined,
  settings: ResolvedOpenTelemetrySettings,
): Attributes {
  const attributes: Attributes = {
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
  };

  if (settings.capture.actionIO) {
    const io = details?.actionIO?.[action.call_id];
    if (io?.arguments !== undefined) {
      const value = formatCapturedValue(
        io.arguments,
        {
          spanType: "action",
          attribute: "gen_ai.tool.call.arguments",
          agentId: fact.agent_external_id,
          sessionId: fact.session_id,
          runNumber: fact.run_number,
          actionName: action.name,
        },
        settings.redact,
      );
      if (value !== undefined) attributes["gen_ai.tool.call.arguments"] = value;
    }
    if (io?.output !== undefined) {
      const value = formatCapturedValue(
        io.output,
        {
          spanType: "action",
          attribute: "gen_ai.tool.call.result",
          agentId: fact.agent_external_id,
          sessionId: fact.session_id,
          runNumber: fact.run_number,
          actionName: action.name,
        },
        settings.redact,
      );
      if (value !== undefined) attributes["gen_ai.tool.call.result"] = value;
    }
  }

  return attributes;
}

function evaluationResultEvents(
  fact: AmarsiaRunFact,
  settings: ResolvedOpenTelemetrySettings,
): Array<{ name: string; attributes: Attributes }> {
  const events: Array<{ name: string; attributes: Attributes }> = [];
  const includeDetail = settings.capture.evaluationDetail;

  for (const evaluation of fact.evaluations) {
    if (evaluation.metrics.length === 0) {
      const errorMessage =
        includeDetail && evaluation.error_message
          ? redactString(
              evaluation.error_message,
              {
                spanType: "evaluation",
                attribute: "orcha.evaluation.error_message",
                agentId: fact.agent_external_id,
                sessionId: fact.session_id,
                runNumber: fact.run_number,
                evaluationName: evaluation.name,
              },
              settings.redact,
            )
          : undefined;

      events.push({
        name: "gen_ai.evaluation.result",
        attributes: {
          "gen_ai.evaluation.name": evaluation.name,
          "gen_ai.evaluation.score.label": evaluation.status,
          "orcha.evaluation.duration_ms": evaluation.duration_ms,
          ...(evaluation.error_message
            ? {
                "error.type": "evaluation_error",
                ...(errorMessage !== undefined
                  ? { "orcha.evaluation.error_message": errorMessage }
                  : {}),
              }
            : {}),
        },
      });
      continue;
    }
    for (const metric of evaluation.metrics) {
      const explanation = includeDetail
        ? redactString(
            metric.reasoning,
            {
              spanType: "evaluation",
              attribute: "gen_ai.evaluation.explanation",
              agentId: fact.agent_external_id,
              sessionId: fact.session_id,
              runNumber: fact.run_number,
              evaluationName: evaluation.name,
            },
            settings.redact,
          )
        : undefined;
      const evidence =
        includeDetail && metric.evidence.length > 0
          ? redactStringArray(
              metric.evidence,
              {
                spanType: "evaluation",
                attribute: "orcha.evaluation.evidence",
                agentId: fact.agent_external_id,
                sessionId: fact.session_id,
                runNumber: fact.run_number,
                evaluationName: evaluation.name,
              },
              settings.redact,
            )
          : undefined;

      events.push({
        name: "gen_ai.evaluation.result",
        attributes: {
          "gen_ai.evaluation.name": metric.name,
          "gen_ai.evaluation.score.value": metric.score,
          "gen_ai.evaluation.score.label": metric.passed ? "pass" : "fail",
          ...(explanation !== undefined
            ? { "gen_ai.evaluation.explanation": explanation }
            : {}),
          "orcha.evaluation.name": evaluation.name,
          "orcha.evaluation.duration_ms": evaluation.duration_ms,
          ...(evidence && evidence.length > 0
            ? { "orcha.evaluation.evidence": evidence }
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
  details: RunTelemetryDetails | undefined,
  settings: ResolvedOpenTelemetrySettings,
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
  const rootAttributes = runAttributes(fact, details, settings);
  if (fact.status === "failed" && fact.error_code) {
    rootAttributes["error.type"] = fact.error_code;
  }
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
    attributes: otlpAttributes(rootAttributes),
    events: [
      ...evaluationResultEvents(fact, settings).map((event) => ({
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
      attributes: otlpAttributes(modelCallAttributes(fact, modelCall, settings)),
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
      attributes: otlpAttributes(actionAttributes(fact, action, details, settings)),
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

function otlpRequest(spans: OtlpSpan[], resourceAttributes: Attributes) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: otlpAttributes(resourceAttributes),
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

function applyRedaction(
  value: unknown,
  context: OpenTelemetryRedactContext,
  redact?: OpenTelemetryRedactor,
): unknown {
  if (!redact) return value;
  try {
    return redact(value, context);
  } catch (error) {
    console.warn(
      `OpenTelemetry redaction hook failed for ${context.attribute}.`,
      error,
    );
    return "[redaction_error]";
  }
}

function formatCapturedValue(
  value: unknown,
  context: OpenTelemetryRedactContext,
  redact?: OpenTelemetryRedactor,
): string | undefined {
  const processed = applyRedaction(value, context, redact);
  if (processed === undefined || processed === null) return undefined;
  return typeof processed === "string" ? processed : JSON.stringify(processed);
}

function redactString(
  value: string,
  context: OpenTelemetryRedactContext,
  redact?: OpenTelemetryRedactor,
): string | undefined {
  const processed = applyRedaction(value, context, redact);
  if (processed === undefined || processed === null) return undefined;
  return typeof processed === "string" ? processed : JSON.stringify(processed);
}

function redactStringArray(
  value: string[],
  context: OpenTelemetryRedactContext,
  redact?: OpenTelemetryRedactor,
): string[] | undefined {
  const processed = applyRedaction(value, context, redact);
  if (processed === undefined || processed === null) return undefined;
  if (Array.isArray(processed)) {
    return processed.map((item) =>
      typeof item === "string" ? item : JSON.stringify(item),
    );
  }
  return [typeof processed === "string" ? processed : JSON.stringify(processed)];
}

function readProcessEnv(): Record<string, string | undefined> {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  const normalized = nonEmptyString(value)?.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function parseKeyValuePairs(raw: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw) return result;
  for (const segment of raw.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) continue;
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    result[key] = safeDecodeURIComponent(rawValue);
  }
  return result;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function mergeHeaders(
  envHeaders: Record<string, string>,
  explicitHeaders?: Record<string, string>,
): Record<string, string> {
  if (!explicitHeaders) return { ...envHeaders };
  const merged: Record<string, string> = { ...envHeaders };
  const keyLookup = new Map<string, string>();
  for (const key of Object.keys(merged)) {
    keyLookup.set(key.toLowerCase(), key);
  }
  for (const [key, value] of Object.entries(explicitHeaders)) {
    const existingKey = keyLookup.get(key.toLowerCase());
    if (existingKey && existingKey !== key) {
      delete merged[existingKey];
    }
    merged[key] = value;
    keyLookup.set(key.toLowerCase(), key);
  }
  return merged;
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
