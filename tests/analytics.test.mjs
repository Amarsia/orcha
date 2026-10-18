import assert from "node:assert/strict";
import test from "node:test";

import {
  AmarsiaTelemetryClient,
  withAmarsiaTelemetry,
} from "../dist/amarsia/analytics.js";

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
