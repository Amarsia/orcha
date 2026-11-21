import assert from "node:assert/strict";
import test from "node:test";

import { withRunTelemetry } from "../dist/amarsia/analytics.js";
import { resolveOpenTelemetryClient } from "../dist/telemetry/open-telemetry.js";

function createTestManifest() {
  return {
    key: "invoiceAgent",
    name: "Invoice Agent",
    provider: "openai",
    model: "gpt-5-mini",
    outputType: "text",
    instructions: "Help with invoices.",
    maxTokens: 1000,
    actions: {},
    mcpServers: {},
    skills: {},
    evaluations: {},
    subagents: {},
  };
}

function createSampleEvents() {
  return [
    {
      sequence: 1,
      type: "session.created",
      timestamp: "2026-11-21T00:00:00.000Z",
      data: { agent: "invoiceAgent" },
    },
    {
      sequence: 2,
      type: "run.started",
      run: 1,
      timestamp: "2026-11-21T00:00:00.010Z",
      data: { provider: "openai", model: "gpt-5-mini", outputType: "text" },
    },
    {
      sequence: 3,
      type: "message.created",
      run: 1,
      timestamp: "2026-11-21T00:00:00.020Z",
      data: {
        role: "user",
        content: [{ type: "text", text: "Check invoice INV-42 for secret-token" }],
      },
    },
    {
      sequence: 4,
      type: "message.created",
      run: 1,
      timestamp: "2026-11-21T00:00:00.500Z",
      data: {
        role: "assistant",
        provider: "openai",
        model: "gpt-5-mini",
        stopReason: "tool_calls",
        durationMs: 480,
        usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 },
        content: [
          {
            type: "tool_call",
            callId: "call_1",
            name: "lookupInvoice",
            arguments: { invoiceId: "INV-42", apiSecret: "top-secret" },
          },
        ],
      },
    },
    {
      sequence: 5,
      type: "action.requested",
      run: 1,
      timestamp: "2026-11-21T00:00:00.510Z",
      data: {
        callId: "call_1",
        name: "lookupInvoice",
        arguments: { invoiceId: "INV-42", apiSecret: "top-secret" },
      },
    },
    {
      sequence: 6,
      type: "action.completed",
      run: 1,
      timestamp: "2026-11-21T00:00:00.600Z",
      data: {
        callId: "call_1",
        name: "lookupInvoice",
        durationMs: 90,
        output: { status: "paid", amount: 250 },
      },
    },
    {
      sequence: 7,
      type: "message.created",
      run: 1,
      timestamp: "2026-11-21T00:00:00.610Z",
      data: {
        role: "tool",
        content: [
          {
            callId: "call_1",
            output: { status: "paid", amount: 250 },
          },
        ],
      },
    },
    {
      sequence: 8,
      type: "message.created",
      run: 1,
      timestamp: "2026-11-21T00:00:01.000Z",
      data: {
        role: "assistant",
        provider: "openai",
        model: "gpt-5-mini",
        stopReason: "end_turn",
        durationMs: 390,
        usage: { inputTokens: 180, outputTokens: 20, cacheReadTokens: 100, cacheWriteTokens: 0 },
        content: [{ type: "text", text: "Invoice INV-42 is paid." }],
      },
    },
    {
      sequence: 9,
      type: "evaluation.completed",
      run: 1,
      timestamp: "2026-11-21T00:00:01.200Z",
      data: {
        name: "quality",
        status: "passed",
        durationMs: 200,
        metrics: [
          {
            name: "accuracy",
            score: 1,
            threshold: 0.8,
            passed: true,
            reasoning: "Confirmed paid status accurately.",
            evidence: ["Tool returned status=paid"],
          },
        ],
      },
    },
    {
      sequence: 10,
      type: "run.completed",
      run: 1,
      timestamp: "2026-11-21T00:00:01.210Z",
      data: {
        status: "completed",
        durationMs: 1200,
        usage: { inputTokens: 300, outputTokens: 50, cacheReadTokens: 100, cacheWriteTokens: 0 },
      },
    },
  ];
}

function createMemoryStore(events) {
  return {
    async read() {
      return events;
    },
    async append(_sessionId, appended) {
      events.push(...appended);
    },
  };
}

function attrMap(otlpAttributes) {
  const out = {};
  for (const attr of otlpAttributes ?? []) {
    if ("stringValue" in attr.value) out[attr.key] = attr.value.stringValue;
    else if ("intValue" in attr.value) out[attr.key] = Number(attr.value.intValue);
    else if ("doubleValue" in attr.value) out[attr.key] = attr.value.doubleValue;
    else if ("boolValue" in attr.value) out[attr.key] = attr.value.boolValue;
    else if ("arrayValue" in attr.value) {
      out[attr.key] = attr.value.arrayValue.values.map((v) => v.stringValue);
    }
  }
  return out;
}

async function emitWithMockFetch(client, events) {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({
      url,
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return new Response(null, { status: 200 });
  };
  try {
    const store = withRunTelemetry({
      store: createMemoryStore([...events]),
      manifest: createTestManifest(),
      client,
    });
    await store.append("ses_1", events);
    await client.drain();
    await client.close();
  } finally {
    globalThis.fetch = originalFetch;
  }
  return requests;
}

test("OpenTelemetry preserves privacy-safe defaults and includes evaluation detail", async () => {
  const client = resolveOpenTelemetryClient(
    { endpoint: "https://collector.example.com" },
    {},
  );
  const requests = await emitWithMockFetch(client, createSampleEvents());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://collector.example.com/v1/traces");

  const spans = requests[0].body.resourceSpans[0].scopeSpans[0].spans;
  const agentSpan = spans.find((s) => s.name === "invoke_agent invoiceAgent");
  const chatSpans = spans.filter((s) => s.name === "chat gpt-5-mini");
  const toolSpan = spans.find((s) => s.name === "execute_tool lookupInvoice");

  assert.ok(agentSpan);
  assert.equal(chatSpans.length, 2);
  assert.ok(toolSpan);

  const agentAttrs = attrMap(agentSpan.attributes);
  assert.equal(agentAttrs["gen_ai.input.messages"], undefined);
  assert.equal(agentAttrs["gen_ai.output.messages"], undefined);

  for (const chatSpan of chatSpans) {
    const chatAttrs = attrMap(chatSpan.attributes);
    assert.equal(chatAttrs["gen_ai.input.messages"], undefined);
    assert.equal(chatAttrs["gen_ai.output.messages"], undefined);
  }

  const toolAttrs = attrMap(toolSpan.attributes);
  assert.equal(toolAttrs["gen_ai.tool.call.arguments"], undefined);
  assert.equal(toolAttrs["gen_ai.tool.call.result"], undefined);

  const evalEvent = agentSpan.events.find((e) => e.name === "gen_ai.evaluation.result");
  const evalAttrs = attrMap(evalEvent.attributes);
  assert.equal(evalAttrs["gen_ai.evaluation.explanation"], "Confirmed paid status accurately.");
  assert.deepEqual(evalAttrs["orcha.evaluation.evidence"], ["Tool returned status=paid"]);
});

test("OpenTelemetry supports opt-in capture controls and redaction hook", async () => {
  const client = resolveOpenTelemetryClient(
    {
      endpoint: "https://collector.example.com/v1/traces",
      capture: {
        content: true,
        actionIO: true,
        evaluationDetail: false,
      },
      redact(value, context) {
        if (
          context.spanType === "action" &&
          context.attribute === "gen_ai.tool.call.arguments" &&
          value &&
          typeof value === "object"
        ) {
          return { ...value, apiSecret: "[redacted]" };
        }
        if (
          context.spanType === "agent_run" &&
          context.attribute === "gen_ai.output.messages"
        ) {
          return undefined;
        }
        return value;
      },
    },
    {},
  );
  const requests = await emitWithMockFetch(client, createSampleEvents());
  const spans = requests[0].body.resourceSpans[0].scopeSpans[0].spans;
  const agentSpan = spans.find((s) => s.name === "invoke_agent invoiceAgent");
  const chatSpans = spans.filter((s) => s.name === "chat gpt-5-mini");
  const toolSpan = spans.find((s) => s.name === "execute_tool lookupInvoice");

  const agentAttrs = attrMap(agentSpan.attributes);
  const runInput = JSON.parse(agentAttrs["gen_ai.input.messages"]);
  assert.equal(runInput.length, 1);
  assert.equal(runInput[0].role, "user");
  assert.equal(runInput[0].parts[0].type, "text");
  assert.equal(agentAttrs["gen_ai.output.messages"], undefined);

  const secondChatAttrs = attrMap(chatSpans[1].attributes);
  const chatInput = JSON.parse(secondChatAttrs["gen_ai.input.messages"]);
  const chatOutput = JSON.parse(secondChatAttrs["gen_ai.output.messages"]);
  assert.equal(chatInput.length, 3);
  assert.equal(chatInput[2].role, "tool");
  assert.equal(chatInput[2].parts[0].type, "tool_call_response");
  assert.equal(chatInput[2].parts[0].id, "call_1");
  assert.equal(chatOutput[0].role, "assistant");
  assert.equal(chatOutput[0].finish_reason, "end_turn");

  const toolAttrs = attrMap(toolSpan.attributes);
  assert.deepEqual(JSON.parse(toolAttrs["gen_ai.tool.call.arguments"]), {
    invoiceId: "INV-42",
    apiSecret: "[redacted]",
  });
  assert.deepEqual(JSON.parse(toolAttrs["gen_ai.tool.call.result"]), {
    status: "paid",
    amount: 250,
  });

  const evalEvent = agentSpan.events.find((e) => e.name === "gen_ai.evaluation.result");
  const evalAttrs = attrMap(evalEvent.attributes);
  assert.equal(evalAttrs["gen_ai.evaluation.score.value"], 1);
  assert.equal(evalAttrs["gen_ai.evaluation.explanation"], undefined);
  assert.equal(evalAttrs["orcha.evaluation.evidence"], undefined);
});

test("OpenTelemetry applies standard OTEL_* env defaults and prefers explicit config", async () => {
  const env = {
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://env-collector.example.com",
    OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20env-token,x-env=yes",
    OTEL_SERVICE_NAME: "env-service",
    OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=staging,service.name=ignored",
    OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
  };

  assert.equal(resolveOpenTelemetryClient(false, env), undefined);

  const envDefaultClient = resolveOpenTelemetryClient(undefined, env);
  assert.ok(envDefaultClient);
  const envRequests = await emitWithMockFetch(envDefaultClient, createSampleEvents());
  assert.equal(envRequests[0].url, "https://env-collector.example.com/v1/traces");
  assert.equal(envRequests[0].headers.Authorization, "Bearer env-token");
  assert.equal(envRequests[0].headers["x-env"], "yes");
  const envResourceAttrs = attrMap(envRequests[0].body.resourceSpans[0].resource.attributes);
  assert.equal(envResourceAttrs["service.name"], "env-service");
  assert.equal(envResourceAttrs["deployment.environment"], "staging");
  const envAgentAttrs = attrMap(
    envRequests[0].body.resourceSpans[0].scopeSpans[0].spans[0].attributes,
  );
  assert.ok(envAgentAttrs["gen_ai.input.messages"]);

  const explicitWinsClient = resolveOpenTelemetryClient(
    {
      endpoint: "https://explicit.example.com",
      headers: { authorization: "Bearer explicit-token" },
      serviceName: "explicit-service",
      resourceAttributes: { "deployment.environment": "production" },
      capture: { content: false },
    },
    env,
  );
  const explicitRequests = await emitWithMockFetch(explicitWinsClient, createSampleEvents());
  assert.equal(explicitRequests[0].url, "https://explicit.example.com/v1/traces");
  assert.equal(explicitRequests[0].headers.authorization, "Bearer explicit-token");
  assert.equal(explicitRequests[0].headers.Authorization, undefined);
  assert.equal(explicitRequests[0].headers["x-env"], "yes");
  const explicitResourceAttrs = attrMap(
    explicitRequests[0].body.resourceSpans[0].resource.attributes,
  );
  assert.equal(explicitResourceAttrs["service.name"], "explicit-service");
  assert.equal(explicitResourceAttrs["deployment.environment"], "production");
  const explicitAgentAttrs = attrMap(
    explicitRequests[0].body.resourceSpans[0].scopeSpans[0].spans[0].attributes,
  );
  assert.equal(explicitAgentAttrs["gen_ai.input.messages"], undefined);
});
