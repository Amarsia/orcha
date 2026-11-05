import assert from "node:assert/strict";
import test from "node:test";

import {
  AmarsiaTelemetryClient,
  sanitizeErrorMessage,
  withAmarsiaTelemetry,
} from "../dist/amarsia/analytics.js";
import {
  createAmarsiaProjectMetadata,
  normalizeRepositoryUrl,
} from "../dist/amarsia/metadata.js";

test("Amarsia project metadata emits reusable agents once and sanitizes host paths", () => {
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
    "/Users/alice/private-repos/tax-axis-service",
  );

  assert.deepEqual(
    metadata.agents.map((agent) => agent.external_id),
    ["documentParser", "sCorpTester"],
  );
  assert.equal(metadata.project.root_path, "tax-axis-service");
  assert.doesNotMatch(metadata.project.root_path, /\/Users\/alice/);
  assert.equal(
    normalizeRepositoryUrl(
      "https://x-access-token:ghp_secret1234567890@github.com/org/repo.git?token=abc",
    ),
    "https://github.com/org/repo",
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
          message:
            "Authorization: Bearer secret-token-value for SSN 123-45-6789, EIN 12-3456789, email john.doe@example.com, net income of $450,230.50 at /Users/john/secrets/tax.json",
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
    assert.doesNotMatch(
      serialized,
      /private prompt|do-not-send|secret-token-value|123-45-6789|12-3456789|john\.doe@example\.com|450,230\.50|\/Users\/john/,
    );
    assert.match(serialized, /\[redacted\]/);
    assert.match(serialized, /\[redacted-ssn\]/);
    assert.match(serialized, /\[redacted-tin\]/);
    assert.match(serialized, /\[redacted-email\]/);
    assert.match(serialized, /\[redacted-amount\]/);
    assert.match(serialized, /\[redacted-path\]/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sanitizeErrorMessage redacts financial figures, tax IDs, PII, and credentials in evaluation reasoning and evidence", () => {
  const sample =
    "Officer salary is 185000 and distribution of $145,230.00 (USD 50,000 bonus, 12,500 shares) for TIN: 98-7654321, SSN 111-22-3333, phone (415) 555-0199, card 4111 2222 3333 4444, postgres://admin:supersecret@db.internal:5432/tax.";
  const sanitized = sanitizeErrorMessage(sample);
  assert.doesNotMatch(
    sanitized,
    /185000|145,230|50,000|12,500|98-7654321|111-22-3333|555-0199|4111 2222|supersecret/,
  );
  assert.match(sanitized, /\[redacted-figure\]/);
  assert.match(sanitized, /\[redacted-amount\]/);
  assert.match(sanitized, /\[redacted-tin\]/);
  assert.match(sanitized, /\[redacted-ssn\]/);
  assert.match(sanitized, /\[redacted-phone\]/);
  assert.match(sanitized, /\[redacted-card\]/);
  assert.match(sanitized, /postgres:\/\/\[redacted\]@/);
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
    await telemetry.drain();

    assert.equal(requests.length, 1);
    assert.equal(requests[0].runs[0].evaluation_count, 1);
    assert.equal(requests[0].runs[0].evaluation_metric_count, 1);
    assert.equal(requests[0].runs[0].evaluations[0].name, "response_quality");
  } finally {
    await telemetry.close();
    globalThis.fetch = originalFetch;
  }
});

test("Amarsia telemetry dispatches terminal events in the background without blocking append or waiting for in-flight running batches", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let releaseFirstRequest;
  globalThis.fetch = (_url, init) => {
    const payload = JSON.parse(init.body);
    requests.push(payload);
    if (requests.length === 1) {
      return new Promise((resolve) => {
        releaseFirstRequest = () =>
          resolve(new Response(null, { status: 500 }));
      });
    }
    return Promise.resolve(new Response(null, { status: 202 }));
  };

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
        throw new Error("store.read should not be called for in-memory session");
      },
      async listSessionIds() {
        return ["session-1"];
      },
    },
  });

  try {
    await wrapped.append("session-1", [
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
    ]);

    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].runs[0].status, "running");

    await wrapped.append("session-1", [
      {
        sequence: 3,
        type: "run.failed",
        timestamp: "2026-01-01T00:00:02.000Z",
        run: 1,
        data: {
          status: "failed",
          durationMs: 1_000,
          error: {
            code: "provider_error",
            message: "Bedrock request failed",
            retryable: true,
          },
        },
      },
    ]);

    // The terminal request is initiated immediately in the background even while the first running request is still in-flight.
    assert.equal(requests.length, 2);
    assert.equal(requests[1].runs[0].status, "failed");

    releaseFirstRequest();
    await telemetry.drain();
    // Failed first "running" batch must not be re-queued after terminal "failed" was already recorded.
    assert.equal(requests.length, 2);
  } finally {
    await telemetry.close();
    globalThis.fetch = originalFetch;
  }
});
