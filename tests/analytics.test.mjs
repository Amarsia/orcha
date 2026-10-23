import assert from "node:assert/strict";
import test from "node:test";

import {
  AmarsiaTelemetryClient,
  withAmarsiaTelemetry,
} from "../dist/amarsia/analytics.js";
import { createAmarsiaProjectMetadata } from "../dist/amarsia/metadata.js";

test("Amarsia project metadata emits reusable agents once", () => {
  const specialist = {
    key: "documentParser",
    name: "Document Parser",
    provider: "bedrock",
    model: "test-model",
    outputType: "text",
    actions: {},
    skills: {},
    evaluations: {},
    subagents: {},
  };
  const coordinator = {
    key: "sCorpTester",
    name: "S Corp Tester",
    provider: "bedrock",
    model: "test-model",
    outputType: "text",
    actions: {},
    skills: {},
    evaluations: {},
    subagents: { documentParser: specialist },
  };

  const metadata = createAmarsiaProjectMetadata(
    {
      schemaVersion: 1,
      agents: {
        documentParser: specialist,
        sCorpTester: coordinator,
      },
    },
    process.cwd(),
  );

  assert.deepEqual(
    metadata.agents.map((agent) => agent.external_id),
    ["documentParser", "sCorpTester"],
  );
  assert.equal(
    metadata.agents.find((agent) => agent.external_id === "documentParser")
      ?.parent_external_id,
    undefined,
  );
  assert.deepEqual(
    metadata.agents.find((agent) => agent.external_id === "sCorpTester")
      ?.metadata.subagents,
    ["documentParser"],
  );
});

test("Amarsia telemetry is redacted and idempotent within a batch", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(null, { status: 202 });
  };

  const events = [
    {
      sequence: 1,
      type: "session.created",
      timestamp: "2026-01-01T00:00:00.000Z",
      run: 1,
      data: {},
    },
    {
      sequence: 2,
      type: "run.started",
      timestamp: "2026-01-01T00:00:01.000Z",
      run: 1,
      data: { status: "running", provider: "openai", model: "gpt-test" },
    },
    {
      sequence: 3,
      type: "message.created",
      timestamp: "2026-01-01T00:00:02.000Z",
      run: 1,
      data: { role: "user", content: "private prompt" },
    },
    {
      sequence: 4,
      type: "action.requested",
      timestamp: "2026-01-01T00:00:03.000Z",
      run: 1,
      data: { arguments: { password: "do-not-send" } },
    },
    {
      sequence: 5,
      type: "run.failed",
      timestamp: "2026-01-01T00:00:04.000Z",
      run: 1,
      data: {
        status: "failed",
        durationMs: 3000,
        error: {
          code: "provider_error",
          message: "Authorization: Bearer secret-token-value",
          retryable: true,
        },
      },
    },
  ];
  const store = {
    async append() {},
    async read() {
      return events;
    },
    async listSessionIds() {
      return ["session-1"];
    },
  };
  const telemetry = new AmarsiaTelemetryClient({
    key: "amarsia_project_key",
    endpoint: "https://example.test",
  });
  const wrapped = withAmarsiaTelemetry({
    store,
    client: telemetry,
    manifest: {
      key: "support-agent",
      name: "Support agent",
      provider: "openai",
      model: "gpt-test",
    },
  });

  try {
    await wrapped.append("session-1", [events[4]]);
    await wrapped.append("session-1", [events[4]]);
    await new Promise((resolve) => setTimeout(resolve, 350));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].schema_version, 1);
    assert.equal(requests[0].runs.length, 1);
    const serialized = JSON.stringify(requests[0]);
    assert.doesNotMatch(serialized, /private prompt|do-not-send|secret-token-value/);
    assert.match(serialized, /\[redacted\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Amarsia telemetry normalizes internal pause reasons", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(null, { status: 202 });
  };
  const events = [
    {
      sequence: 1,
      type: "session.created",
      timestamp: "2026-01-01T00:00:00.000Z",
      run: 1,
      data: {},
    },
    {
      sequence: 2,
      type: "run.started",
      timestamp: "2026-01-01T00:00:01.000Z",
      run: 1,
      data: { status: "running", provider: "openai", model: "gpt-test" },
    },
    {
      sequence: 3,
      type: "run.paused",
      timestamp: "2026-01-01T00:00:02.000Z",
      run: 1,
      data: { status: "waiting_for_client_action" },
    },
  ];
  const telemetry = new AmarsiaTelemetryClient({
    key: "amarsia_project_key",
    endpoint: "https://example.test",
  });
  const wrapped = withAmarsiaTelemetry({
    client: telemetry,
    manifest: {
      key: "support-agent",
      name: "Support agent",
      provider: "openai",
      model: "gpt-test",
    },
    store: {
      async append() {},
      async read() {
        return events;
      },
      async listSessionIds() {
        return ["session-1"];
      },
    },
  });

  try {
    await wrapped.append("session-1", [events[2]]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(requests.length, 1);
    assert.equal(requests[0].runs[0].status, "paused");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Amarsia telemetry delivers evaluation updates before append resolves", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(null, { status: 202 });
  };
  const evaluation = {
    sequence: 4,
    type: "evaluation.completed",
    timestamp: "2026-01-01T00:00:04.000Z",
    run: 1,
    data: {
      name: "response_quality",
      status: "passed",
      durationMs: 750,
      metrics: [
        {
          name: "groundedness",
          score: 0.95,
          threshold: 0.8,
          passed: true,
          reasoning: "The response is grounded.",
          evidence: ["Confirmed evidence"],
        },
      ],
    },
  };
  const events = [
    {
      sequence: 1,
      type: "session.created",
      timestamp: "2026-01-01T00:00:00.000Z",
      run: 1,
      data: {},
    },
    {
      sequence: 2,
      type: "run.started",
      timestamp: "2026-01-01T00:00:01.000Z",
      run: 1,
      data: { status: "running", provider: "openai", model: "gpt-test" },
    },
    {
      sequence: 3,
      type: "run.completed",
      timestamp: "2026-01-01T00:00:03.000Z",
      run: 1,
      data: { status: "completed", durationMs: 2_000 },
    },
    evaluation,
  ];
  const telemetry = new AmarsiaTelemetryClient({
    key: "amarsia_project_key",
    endpoint: "https://example.test",
  });
  const wrapped = withAmarsiaTelemetry({
    client: telemetry,
    manifest: {
      key: "support-agent",
      name: "Support agent",
      provider: "openai",
      model: "gpt-test",
    },
    store: {
      async append() {},
      async read() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return events;
      },
      async listSessionIds() {
        return ["session-1"];
      },
    },
  });

  try {
    await wrapped.append("session-1", [evaluation]);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].runs[0].evaluation_count, 1);
    assert.equal(requests[0].runs[0].evaluation_metric_count, 1);
    assert.equal(requests[0].runs[0].evaluations[0].name, "response_quality");
  } finally {
    await telemetry.close();
    globalThis.fetch = originalFetch;
  }
});
