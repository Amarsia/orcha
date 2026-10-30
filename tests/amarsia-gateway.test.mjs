import assert from "node:assert/strict";
import test from "node:test";
import { createAmarsiaInferenceGenerator } from "../dist/amarsia/inference.js";
import { CloudSessionStore } from "../dist/storage/cloud.js";

const usage = {
  input_tokens: 4,
  output_tokens: 2,
  input_tokens_details: { cached_tokens: 1 },
  output_tokens_details: { reasoning_tokens: 1 },
};

test("Amarsia inference sends an OpenAI Responses-compatible request", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), init, body: JSON.parse(init.body) };
    return Response.json({
      id: "resp_1",
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "done" }],
        },
      ],
      output_text: "done",
      usage,
    });
  };
  try {
    const generate = createAmarsiaInferenceGenerator({
      key: "project-key",
      endpoint: "https://amarsia.test/",
    });
    const response = await generate("anthropic", {}, {
      model: "claude-test",
      region: "us",
      maxTokens: 100,
      reasoningLevel: "high",
      outputType: "text",
      systemPrompt: "Be useful.",
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        {
          name: "lookup",
          description: "Look up a record",
          parameters: { type: "object" },
        },
      ],
    });

    assert.equal(
      captured.url,
      "https://amarsia.test/v3/model/v1/responses",
    );
    assert.equal(captured.init.headers.authorization, "Bearer project-key");
    assert.equal(captured.body.provider, "anthropic");
    assert.equal(captured.body.model, "claude-test");
    assert.equal(captured.body.region, "us");
    assert.equal(captured.body.input[0].role, "user");
    assert.equal(captured.body.tools[0].name, "lookup");
    assert.equal(response.output, "done");
    assert.equal(response.responseId, "resp_1");
    assert.deepEqual(response.usage, {
      inputTokens: 4,
      outputTokens: 2,
      reasoningTokens: 1,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Amarsia inference rejects unsupported infrastructure providers", async () => {
  const generate = createAmarsiaInferenceGenerator({
    key: "project-key",
  });
  const request = {
    model: "provider-model",
    systemPrompt: "Test",
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
  };

  await assert.rejects(
    generate("bedrock", {}, request),
    /supports only OpenAI, Anthropic, Google GenAI, Vertex AI, and DeepSeek/,
  );
});

test("Amarsia inference streams cumulative output and forwards abort", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const frames = [
    'data: {"type":"response.output_text.delta","delta":"a"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"b"}\n\n',
    `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_stream",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "ab" }],
          },
        ],
        output_text: "ab",
        usage,
      },
    })}\n\n`,
  ];
  let forwardedSignal;
  globalThis.fetch = async (_url, init) => {
    forwardedSignal = init.signal;
    return new Response(
      new ReadableStream({
        start(streamController) {
          for (const frame of frames) {
            streamController.enqueue(new TextEncoder().encode(frame));
          }
          streamController.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  try {
    const snapshots = [];
    const response = await createAmarsiaInferenceGenerator({
      key: "project-key",
    })("openai", {}, {
      model: "gpt-test",
      systemPrompt: "Test",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
      publishOutput: (output) => snapshots.push(output),
      signal: controller.signal,
    });
    assert.equal(forwardedSignal, controller.signal);
    assert.equal(response.output, "ab");
    assert.deepEqual(snapshots, ["a", "ab", "ab"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud append returns after the durable local write while offline", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    throw new TypeError("offline");
  };
  try {
    const local = new MemoryStore();
    const cloud = new CloudSessionStore({
      local,
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    await cloud.append("ses_1", [event(1)]);
    assert.deepEqual(await local.read("ses_1"), [event(1)]);
    assert.deepEqual(await cloud.read("ses_1"), [event(1)]);
    assert.equal(cloud.cloudStoragePendingCount, 1);
    await assert.rejects(
      cloud.flushCloudStorage({ timeoutMs: 10 }),
      /flush incomplete/,
    );
    assert.ok(attempts > 0);
    assert.match(cloud.cloudStorageLastError.message, /offline/);
    await assert.rejects(
      cloud.closeCloudStorage({ timeoutMs: 0 }),
      /flush incomplete/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud storage reads local truth and refreshes cloud only when requested", async () => {
  const originalFetch = globalThis.fetch;
  const remote = new Map([
    ["ses_remote", [event(1)]],
    ["ses_both", [event(1), event(2)]],
  ]);
  globalThis.fetch = createStorageFetch(remote);
  try {
    const local = new MemoryStore();
    await local.append("ses_local", [event(1)]);
    await local.append("ses_both", [event(1)]);
    const cloud = new CloudSessionStore({
      local,
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });

    assert.deepEqual(await cloud.read("ses_both"), [event(1)]);
    assert.deepEqual(await cloud.read("ses_remote"), []);
    assert.deepEqual(await cloud.listSessionIds(), ["ses_both", "ses_local"]);
    await cloud.refreshCloudSession("ses_remote");
    await cloud.refreshCloudSession("ses_both");
    assert.deepEqual(await cloud.read("ses_remote"), [event(1)]);
    assert.equal(await local.getCloudAcknowledgement("ses_remote"), 1);
    await cloud.closeCloudStorage({ timeoutMs: 100 });
    assert.deepEqual(await local.read("ses_both"), [event(1), event(2)]);
    assert.equal(await local.getCloudAcknowledgement("ses_both"), 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud outbox coalesces appends and persists acknowledgement", async () => {
  const originalFetch = globalThis.fetch;
  const remote = new Map();
  globalThis.fetch = createStorageFetch(remote);
  try {
    const local = new MemoryStore();
    const cloud = new CloudSessionStore({
      local,
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    await cloud.append("ses_outbox", [event(1)]);
    await cloud.append("ses_outbox", [event(2), event(3)]);
    await cloud.flushCloudStorage({ timeoutMs: 1_000 });
    assert.deepEqual(remote.get("ses_outbox"), [
      event(1),
      event(2),
      event(3),
    ]);
    assert.equal(await local.getCloudAcknowledgement("ses_outbox"), 3);
    assert.equal(cloud.cloudStoragePendingCount, 0);
    await cloud.closeCloudStorage();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud outbox recovers an unacknowledged local tail after restart", async () => {
  const originalFetch = globalThis.fetch;
  const remote = new Map();
  globalThis.fetch = createStorageFetch(remote);
  try {
    const local = new MemoryStore();
    await local.append("ses_recovered", [event(1), event(2)]);
    const cloud = new CloudSessionStore({
      local,
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    await cloud.flushCloudStorage({ timeoutMs: 1_000 });
    assert.deepEqual(remote.get("ses_recovered"), [event(1), event(2)]);
    assert.equal(await local.getCloudAcknowledgement("ses_recovered"), 2);
    await cloud.closeCloudStorage();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud outbox reports immutable-prefix conflicts without overwrite", async () => {
  const originalFetch = globalThis.fetch;
  const remote = new Map([["ses_conflict", [event(1, "remote")]]]);
  globalThis.fetch = createStorageFetch(remote);
  try {
    const local = new MemoryStore();
    await local.append("ses_conflict", [event(1, "local")]);
    const cloud = new CloudSessionStore({
      local,
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    await assert.rejects(
      cloud.flushCloudStorage({ timeoutMs: 1_000 }),
      /flush incomplete/,
    );
    assert.match(cloud.cloudStorageLastError.message, /diverged at sequence 1/);
    assert.equal(cloud.cloudStoragePendingCount, 1);
    assert.deepEqual(await local.read("ses_conflict"), [event(1, "local")]);
    assert.deepEqual(remote.get("ses_conflict"), [event(1, "remote")]);
    await assert.rejects(
      cloud.closeCloudStorage({ timeoutMs: 0 }),
      /flush incomplete/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("permanent delivery failures park until append or explicit flush retry", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return Response.json({ message: "invalid request" }, { status: 400 });
  };
  try {
    const cloud = new CloudSessionStore({
      local: new MemoryStore(),
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    await cloud.append("ses_parked", [event(1)]);
    await waitFor(() => attempts === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(attempts, 1);

    await cloud.append("ses_parked", [event(2)]);
    await waitFor(() => attempts === 2);
    await assert.rejects(
      cloud.flushCloudStorage({ timeoutMs: 100 }),
      /flush incomplete/,
    );
    assert.equal(attempts, 3);
    await assert.rejects(
      cloud.closeCloudStorage({ timeoutMs: 0 }),
      /flush incomplete/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit refresh safely appends a remote warm-session tail", async () => {
  const originalFetch = globalThis.fetch;
  const remote = new Map([
    ["ses_warm", [event(1), event(2), event(3)]],
  ]);
  globalThis.fetch = createStorageFetch(remote);
  try {
    const local = new MemoryStore();
    await local.append("ses_warm", [event(1)]);
    await local.setCloudAcknowledgement("ses_warm", 1);
    const cloud = new CloudSessionStore({
      local,
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    await cloud.refreshCloudSession("ses_warm");
    assert.deepEqual(await local.read("ses_warm"), [
      event(1),
      event(2),
      event(3),
    ]);
    await cloud.closeCloudStorage();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cloud delivery uploads bounded event batches", async () => {
  const originalFetch = globalThis.fetch;
  const remote = new Map();
  const batchSizes = [];
  const storageFetch = createStorageFetch(remote);
  globalThis.fetch = async (input, init) => {
    if (init?.method === "POST") {
      batchSizes.push(JSON.parse(init.body).events.length);
    }
    return storageFetch(input, init);
  };
  try {
    const cloud = new CloudSessionStore({
      local: new MemoryStore(),
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    await cloud.append(
      "ses_batches",
      Array.from({ length: 205 }, (_, index) => event(index + 1)),
    );
    await cloud.flushCloudStorage({ timeoutMs: 1_000 });
    assert.deepEqual(batchSizes, [100, 100, 5]);
    await cloud.closeCloudStorage();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("close aborts in-flight cloud requests and reports pending data", async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  try {
    const cloud = new CloudSessionStore({
      local: new MemoryStore(),
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    await cloud.append("ses_close", [event(1)]);
    await assert.rejects(
      cloud.closeCloudStorage({ timeoutMs: 1 }),
      /flush incomplete/,
    );
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("close barriers concurrent appends and flushes pre-barrier mutations", async () => {
  const originalFetch = globalThis.fetch;
  const remote = new Map();
  globalThis.fetch = createStorageFetch(remote);
  let releaseAppend;
  let appendStarted;
  const started = new Promise((resolve) => {
    appendStarted = resolve;
  });
  const release = new Promise((resolve) => {
    releaseAppend = resolve;
  });
  class BlockingMemoryStore extends MemoryStore {
    async append(sessionId, events) {
      appendStarted();
      await release;
      await super.append(sessionId, events);
    }
  }
  try {
    const local = new BlockingMemoryStore();
    const cloud = new CloudSessionStore({
      local,
      key: "project-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    const append = cloud.append("ses_closing", [event(1)]);
    await started;
    const close = cloud.closeCloudStorage({ timeoutMs: 1_000 });
    await assert.rejects(
      cloud.append("ses_closing", [event(2)]),
      /closing or closed/,
    );
    releaseAppend();
    await append;
    await close;
    assert.deepEqual(remote.get("ses_closing"), [event(1)]);
    assert.equal(await local.getCloudAcknowledgement("ses_closing"), 1);
  } finally {
    releaseAppend?.();
    globalThis.fetch = originalFetch;
  }
});

test("explicit cloud refresh surfaces permanent authentication failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: "Project key is invalid." } },
      { status: 401 },
    );
  try {
    const cloud = new CloudSessionStore({
      local: new MemoryStore(),
      key: "wrong-key",
      endpoint: "https://amarsia.test",
      agentName: "support",
    });
    assert.deepEqual(await cloud.listSessionIds(), []);
    await assert.rejects(
      cloud.refreshCloudSession("ses_remote"),
      (error) =>
        error.code === "storage_error" &&
        /HTTP 401: Project key is invalid/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

class MemoryStore {
  sessions = new Map();
  acknowledgements = new Map();
  listeners = new Map();

  async read(sessionId) {
    return [...(this.sessions.get(sessionId) ?? [])];
  }

  async readAfterSequence(sessionId, afterSequence, limit) {
    return (this.sessions.get(sessionId) ?? [])
      .filter((item) => item.sequence > afterSequence)
      .slice(0, limit);
  }

  async append(sessionId, events) {
    this.sessions.set(sessionId, [
      ...(this.sessions.get(sessionId) ?? []),
      ...events,
    ]);
    for (const listener of this.listeners.get(sessionId) ?? []) {
      listener(events);
    }
  }

  async listSessionIds() {
    return [...this.sessions.keys()].sort();
  }

  async getCloudAcknowledgement(sessionId) {
    return this.acknowledgements.get(sessionId) ?? 0;
  }

  async setCloudAcknowledgement(sessionId, sequence) {
    this.acknowledgements.set(
      sessionId,
      Math.max(sequence, this.acknowledgements.get(sessionId) ?? 0),
    );
  }

  subscribe(sessionId, listener) {
    const listeners = this.listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => listeners.delete(listener);
  }
}

function createStorageFetch(remote) {
  return async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/sessions")) {
      return Response.json({
        sessions: [...remote.keys()].map((session_id) => ({ session_id })),
      });
    }
    const sessionId = decodeURIComponent(
      url.pathname.split("/").at(-2),
    );
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      const existing = remote.get(sessionId) ?? [];
      const sequence = existing.at(-1)?.sequence ?? 0;
      if (sequence !== body.expected_sequence) {
        return new Response(null, { status: 409 });
      }
      remote.set(sessionId, [...existing, ...body.events]);
      return Response.json({ accepted: body.events.length });
    }
    const events = remote.get(sessionId) ?? [];
    const afterSequence = Number(
      url.searchParams.get("after_sequence") ?? "0",
    );
    return Response.json({
      events: events.filter((item) => item.sequence > afterSequence),
      latest_sequence: events.at(-1)?.sequence ?? 0,
    });
  };
}

function event(sequence, value = `event-${sequence}`) {
  return {
    sequence,
    type: "message.created",
    timestamp: `2026-01-01T00:00:0${sequence}.000Z`,
    data: { value },
  };
}

async function waitFor(condition) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("Condition was not met.");
}
