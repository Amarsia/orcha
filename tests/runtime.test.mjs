import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "esbuild";
import { orchaPlugin } from "../dist/integrations/esbuild.js";
import { generateProviderResponse } from "../dist/providers/index.js";
import { createOrcha } from "../dist/runtime/create-orcha.js";

const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("writes a useful JSONL timeline for a successful model run", async () => {
  const fixture = await createRuntimeFixture();
  try {
    const result = await fixture.client.testAgent.run("hello").result;

    assert.equal(result.status, "completed");
    assert.equal(result.output, "mock-response-1");
    assert.deepEqual(result.usage, {
      inputTokens: 7,
      outputTokens: 3,
      reasoningTokens: null,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    });

    const events = await readSessionEvents(fixture.root, result.sessionId);
    assert.deepEqual(
      events.map((event) => event.type),
      [
        "session.created",
        "run.started",
        "message.created",
        "message.created",
        "run.completed",
      ],
    );
    assert.deepEqual(
      events.map((event) => event.sequence),
      [1, 2, 3, 4, 5],
    );
    assert.equal(events[3].data.role, "assistant");
    assert.equal(events[3].data.responseId, "msg_mock_1");
    assert.equal(events[3].data.stopReason, "end_turn");
    assert.equal(typeof events[3].data.durationMs, "number");
    assert.equal(events[4].data.status, "completed");
  } finally {
    await fixture.dispose();
  }
});

test("streams cumulative model snapshots and preserves the final result", async () => {
  const fixture = await createRuntimeFixture(() => ({
    streamText: ["Hello", " world"],
  }));
  try {
    const execution = fixture.client.testAgent.run("hello");
    const snapshotsPromise = collectStream(execution.stream);
    const result = await execution.result;
    const snapshots = await snapshotsPromise;

    assert.equal(result.status, "completed");
    assert.equal(result.output, "Hello world");
    assert.equal(execution.snapshot, result);
    assert.deepEqual(
      snapshots.map((snapshot) => snapshot.status),
      ["streaming", "streaming", "completed"],
    );
    assert.deepEqual(
      snapshots
        .filter((snapshot) => snapshot.status === "streaming")
        .map((snapshot) => snapshot.output),
      ["Hello", "Hello world"],
    );
    assert.equal(snapshots.at(-1), result);
  } finally {
    await fixture.dispose();
  }
});

test("runs OpenAI Responses with streaming and normalized local tools", async () => {
  const fixture = await createRuntimeFixture(
    (_requests, index) =>
      index === 1
        ? {
            id: "resp_openai_tool",
            status: "completed",
            output: [
              {
                type: "function_call",
                id: "fc_openai_1",
                call_id: "call_openai_1",
                name: "calculate_invoice_total",
                arguments: JSON.stringify({
                  hours: 2,
                  hourlyRate: 100,
                  taxRate: 0.1,
                  currency: "USD",
                }),
                status: "completed",
              },
            ],
          }
        : {
            id: "resp_openai_complete",
            status: "completed",
            streamText: ["The total", " is $220."],
            output: [
              {
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "The total is $220.",
                    annotations: [],
                  },
                ],
              },
            ],
          },
    { provider: "openai" },
  );
  try {
    const execution = fixture.client.testAgent.run("Calculate it.");
    const snapshotsPromise = collectStream(execution.stream);
    const result = await execution.result;
    const snapshots = await snapshotsPromise;

    assert.equal(result.status, "completed");
    assert.equal(result.output, "The total is $220.");
    assert.deepEqual(
      snapshots
        .filter((snapshot) => snapshot.status === "streaming")
        .map((snapshot) => snapshot.output),
      ["The total", "The total is $220."],
    );
    assert.deepEqual(fixture.requests[1].input.at(-1), {
      type: "function_call_output",
      call_id: "call_openai_1",
      output:
        '{"subtotal":200,"tax":20,"total":220,"currency":"USD"}',
    });
    assert.equal(
      fixture.requests[1].input.some(
        (item) =>
          item.type === "function_call" &&
          item.call_id === "call_openai_1",
      ),
      true,
    );
    assert.equal("reasoning" in fixture.requests[0], false);

    const events = await readSessionEvents(fixture.root, result.sessionId);
    const toolCall = events.find(
      (event) =>
        event.type === "message.created" &&
        event.data.role === "assistant" &&
        event.data.content.some?.(
          (block) => block.type === "tool_call",
        ),
    );
    assert.equal(toolCall.data.provider, "openai");
    assert.equal(toolCall.data.stopReason, "tool_call");
  } finally {
    await fixture.dispose();
  }
});

test("maps OpenAI multimodal input, structured output, reasoning, and usage", async () => {
  const outputSchema = {
    type: "object",
    properties: {
      accepted: { type: "boolean" },
    },
    required: ["accepted"],
    additionalProperties: false,
  };
  const fixture = await createRuntimeFixture(
    () => ({
      id: "resp_openai_structured",
      status: "completed",
      streamText: ['{"accepted":', "true}"],
      output: [
        {
          type: "reasoning",
          id: "rs_openai_structured",
          summary: [
            {
              type: "summary_text",
              text: "Checked the supplied content.",
            },
          ],
          encrypted_content: "opaque-structured-reasoning",
          status: "completed",
        },
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: '{"accepted":true}',
              annotations: [],
            },
          ],
        },
      ],
    }),
    {
      provider: "openai",
      outputType: "json",
      outputSchema,
      reasoningLevel: "low",
    },
  );
  try {
    const result = await fixture.client.testAgent.run({
      content: [
        { type: "text", text: "Inspect these files." },
        {
          type: "image",
          mimeType: "image/png",
          fileUri: "https://example.com/image.png",
        },
        {
          type: "url",
          mimeType: "application/pdf",
          fileUri: "https://example.com/document.pdf",
        },
      ],
    }).result;

    assert.equal(result.status, "completed");
    assert.deepEqual(result.output, { accepted: true });
    assert.deepEqual(result.usage, {
      inputTokens: 7,
      outputTokens: 3,
      reasoningTokens: 1,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
    });
    assert.deepEqual(fixture.requests[0].reasoning, {
      effort: "low",
      summary: "auto",
    });
    assert.deepEqual(fixture.requests[0].include, [
      "reasoning.encrypted_content",
    ]);
    assert.deepEqual(fixture.requests[0].text, {
      format: {
        type: "json_schema",
        name: "orcha_output",
        schema: outputSchema,
        strict: true,
      },
    });
    assert.deepEqual(fixture.requests[0].input[0].content, [
      { type: "input_text", text: "Inspect these files." },
      {
        type: "input_image",
        image_url: "https://example.com/image.png",
        detail: "auto",
      },
      {
        type: "input_file",
        file_url: "https://example.com/document.pdf",
      },
    ]);
    const events = await readSessionEvents(fixture.root, result.sessionId);
    assert.deepEqual(events[3].data.content[0], {
      type: "reasoning",
      text: "Checked the supplied content.",
      replay: {
        providerId: "rs_openai_structured",
        opaqueData: "opaque-structured-reasoning",
      },
    });
  } finally {
    await fixture.dispose();
  }
});

test("runs Google GenAI streaming with normalized local tools", async () => {
  const fixture = await createRuntimeFixture(
    (_requests, index) =>
      index === 1
        ? {
            chunks: [
              {
                responseId: "google_tool_response",
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [
                        {
                          functionCall: {
                            id: "google_call_1",
                            name: "calculate_invoice_total",
                            args: {
                              hours: 2,
                              hourlyRate: 100,
                              taxRate: 0.1,
                              currency: "USD",
                            },
                          },
                          thoughtSignature: "google-tool-signature",
                        },
                      ],
                    },
                    finishReason: "STOP",
                  },
                ],
              },
            ],
          }
        : {
            chunks: [
              {
                responseId: "google_complete_response",
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [{ text: "The total" }],
                    },
                  },
                ],
              },
              {
                responseId: "google_complete_response",
                candidates: [
                  {
                    content: {
                      role: "model",
                      parts: [{ text: " is $220." }],
                    },
                    finishReason: "STOP",
                  },
                ],
              },
            ],
          },
    { provider: "googlegenai" },
  );
  try {
    const execution = fixture.client.testAgent.run("Calculate it.");
    const snapshotsPromise = collectStream(execution.stream);
    const result = await execution.result;
    const snapshots = await snapshotsPromise;

    assert.equal(result.status, "completed");
    assert.equal(result.output, "The total is $220.");
    assert.deepEqual(
      snapshots
        .filter((snapshot) => snapshot.status === "streaming")
        .map((snapshot) => snapshot.output),
      ["The total", "The total is $220."],
    );
    assert.deepEqual(
      fixture.requests[1].contents.at(-2).parts[0],
      {
        functionCall: {
          id: "google_call_1",
          name: "calculate_invoice_total",
          args: {
            hours: 2,
            hourlyRate: 100,
            taxRate: 0.1,
            currency: "USD",
          },
        },
        thoughtSignature: "google-tool-signature",
      },
    );
    assert.deepEqual(
      fixture.requests[1].contents.at(-1).parts,
      [
        {
          functionResponse: {
            id: "google_call_1",
            name: "calculate_invoice_total",
            response: {
              subtotal: 200,
              tax: 20,
              total: 220,
              currency: "USD",
            },
          },
        },
      ],
    );

    const events = await readSessionEvents(fixture.root, result.sessionId);
    const toolCallMessage = events.find(
      (event) =>
        event.type === "message.created" &&
        event.data.role === "assistant" &&
        event.data.content.some?.(
          (block) => block.type === "tool_call",
        ),
    );
    assert.deepEqual(toolCallMessage.data.content[0], {
      type: "tool_call",
      callId: "google_call_1",
      name: "calculate_invoice_total",
      arguments: {
        hours: 2,
        hourlyRate: 100,
        taxRate: 0.1,
        currency: "USD",
      },
      replay: {
        providerId: "google_call_1",
        opaqueData: "google-tool-signature",
      },
    });
  } finally {
    await fixture.dispose();
  }
});

test("maps Google GenAI multimodal, JSON, reasoning, and usage", async () => {
  const outputSchema = {
    type: "object",
    properties: {
      accepted: { type: "boolean" },
    },
    required: ["accepted"],
    additionalProperties: false,
  };
  const fixture = await createRuntimeFixture(
    () => ({
      chunks: [
        {
          responseId: "google_structured_response",
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    text: "Checked the supplied content.",
                    thought: true,
                    thoughtSignature: "google-reasoning-signature",
                  },
                  { text: '{"accepted":true}' },
                ],
              },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 7,
            candidatesTokenCount: 3,
            thoughtsTokenCount: 2,
            cachedContentTokenCount: 1,
            totalTokenCount: 12,
          },
        },
      ],
    }),
    {
      provider: "googlegenai",
      outputType: "json",
      outputSchema,
      reasoningLevel: "LOW",
    },
  );
  try {
    const result = await fixture.client.testAgent.run({
      content: [
        { type: "text", text: "Inspect these files." },
        {
          type: "image",
          mimeType: "image/png",
          fileUri: "data:image/png;base64,aW1hZ2U=",
        },
        {
          type: "url",
          mimeType: "application/pdf",
          fileUri:
            "https://generativelanguage.googleapis.com/v1beta/files/document",
        },
      ],
    }).result;

    assert.equal(result.status, "completed");
    assert.deepEqual(result.output, { accepted: true });
    assert.deepEqual(result.usage, {
      inputTokens: 7,
      outputTokens: 3,
      reasoningTokens: 2,
      cacheReadTokens: 1,
      cacheWriteTokens: 0,
    });
    assert.deepEqual(fixture.requests[0].generationConfig.thinkingConfig, {
      thinkingLevel: "LOW",
      includeThoughts: true,
    });
    assert.equal(
      fixture.requests[0].generationConfig.responseMimeType,
      "application/json",
    );
    assert.deepEqual(
      fixture.requests[0].generationConfig.responseJsonSchema,
      outputSchema,
    );
    assert.deepEqual(fixture.requests[0].contents[0].parts, [
      { text: "Inspect these files." },
      {
        inlineData: {
          mimeType: "image/png",
          data: "aW1hZ2U=",
        },
      },
      {
        fileData: {
          mimeType: "application/pdf",
          fileUri:
            "https://generativelanguage.googleapis.com/v1beta/files/document",
        },
      },
    ]);

    const events = await readSessionEvents(fixture.root, result.sessionId);
    assert.deepEqual(events[3].data.content[0], {
      type: "reasoning",
      text: "Checked the supplied content.",
      replay: {
        opaqueData: "google-reasoning-signature",
      },
    });
    assert.deepEqual(events[3].data.content[1], {
      type: "text",
      text: '{"accepted":true}',
    });
  } finally {
    await fixture.dispose();
  }
});

test("fails safely when a provider exhausts its output-token budget", async () => {
  const fixture = await createRuntimeFixture(
    () => ({
      id: "resp_openai_incomplete",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        {
          type: "reasoning",
          id: "rs_openai_incomplete",
          summary: [],
          encrypted_content: "opaque-reasoning",
          status: "incomplete",
        },
      ],
    }),
    { provider: "openai" },
  );
  try {
    const result = await fixture.client.testAgent.run("Think deeply.").result;

    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "provider_error");
    assert.equal(result.error.retryable, true);
    const events = await readSessionEvents(fixture.root, result.sessionId);
    assert.equal(events.at(-2).type, "message.created");
    assert.equal(events.at(-2).data.status, "incomplete");
    assert.equal(events.at(-1).type, "run.failed");
    assert.equal(events.at(-1).data.usage.outputTokens, 3);
  } finally {
    await fixture.dispose();
  }
});

test("continues a durable session after switching providers", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-provider-switch-"));
  const anthropic = await createMockAnthropic(() => ({
    content: [{ type: "text", text: "First provider response." }],
  }));
  const openai = await createMockOpenAI(() => ({
    id: "resp_provider_switch",
    status: "completed",
    output: [
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "Second provider response.",
            annotations: [],
          },
        ],
      },
    ],
  }));
  const google = await createMockGoogleGenAI(() => ({
    chunks: [
      {
        responseId: "google_provider_switch",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Third provider response." }],
            },
            finishReason: "STOP",
          },
        ],
      },
    ],
  }));
  let provider = "anthropic";
  const client = createOrcha(
    () => ({
      schemaVersion: 1,
      agents: {
        testAgent: {
          name: "testAgent",
          provider,
          model:
            provider === "anthropic"
              ? "claude-test"
              : provider === "openai"
                ? "gpt-test"
                : "gemini-test",
          systemPrompt: "You are a test agent.",
          outputType: "text",
          actions: {},
        },
      },
    }),
    generateProviderResponse,
  );
  const configuration = {
    root,
    providers: {
      anthropic: {
        apiKey: "test-anthropic-key",
        baseUrl: anthropic.baseUrl,
      },
      openai: {
        apiKey: "test-openai-key",
        baseUrl: openai.baseUrl,
      },
      googlegenai: {
        apiKey: "test-google-key",
        baseUrl: google.baseUrl,
      },
    },
    agents: { testAgent: "./testAgent" },
  };

  try {
    client.init(configuration);
    const first = await client.testAgent.run("First message.").result;
    assert.equal(first.status, "completed");

    provider = "openai";
    client.init(configuration);
    const second = await client.testAgent.resume(first.sessionId, {
      content: "Second message.",
    }).result;

    assert.equal(second.status, "completed");
    assert.equal(second.output, "Second provider response.");
    assert.deepEqual(openai.requests[0].input, [
      {
        role: "user",
        content: [{ type: "input_text", text: "First message." }],
      },
      {
        role: "assistant",
        content: [
          { type: "output_text", text: "First provider response." },
        ],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: "Second message." }],
      },
    ]);

    provider = "googlegenai";
    client.init(configuration);
    const third = await client.testAgent.resume(first.sessionId, {
      content: "Third message.",
    }).result;

    assert.equal(third.status, "completed");
    assert.equal(third.output, "Third provider response.");
    assert.deepEqual(google.requests[0].contents, [
      {
        role: "user",
        parts: [{ text: "First message." }],
      },
      {
        role: "model",
        parts: [{ text: "First provider response." }],
      },
      {
        role: "user",
        parts: [{ text: "Second message." }],
      },
      {
        role: "model",
        parts: [{ text: "Second provider response." }],
      },
      {
        role: "user",
        parts: [{ text: "Third message." }],
      },
    ]);
  } finally {
    await anthropic.close();
    await openai.close();
    await google.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reconstructs completed history when continuing a session", async () => {
  const fixture = await createRuntimeFixture();
  try {
    const first = await fixture.client.testAgent.run("first message").result;
    assert.equal(first.status, "completed");

    const second = await fixture.client.testAgent.resume(first.sessionId, {
      content: "second message",
    }).result;
    assert.equal(second.status, "completed");

    assert.equal(fixture.requests.length, 2);
    assert.deepEqual(fixture.requests[1].messages, [
      {
        role: "user",
        content: [{ type: "text", text: "first message" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "mock-response-1" }],
      },
      {
        role: "user",
        content: [{ type: "text", text: "second message" }],
      },
    ]);

    const events = await readSessionEvents(fixture.root, first.sessionId);
    assert.equal(events.length, 9);
    assert.deepEqual(
      events.map((event) => event.sequence),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    assert.equal(events.at(-1).run, 2);
    assert.equal(events.at(-1).type, "run.completed");
  } finally {
    await fixture.dispose();
  }
});

test("executes local actions and continues the model loop", async () => {
  const fixture = await createRuntimeFixture(localActionResponse);
  try {
    const result = await fixture.client.testAgent.run("Calculate it.").result;
    assert.equal(result.status, "completed");
    assert.equal(result.output, "The total is $220.");
    assert.deepEqual(fixture.requests[1].messages.at(-1), {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_calculate_1",
          content:
            '{"subtotal":200,"tax":20,"total":220,"currency":"USD"}',
        },
      ],
    });

    const events = await readSessionEvents(fixture.root, result.sessionId);
    const toolCallMessage = events.find(
      (event) =>
        event.type === "message.created" &&
        event.data.role === "assistant" &&
        event.data.content.some?.((block) => block.type === "tool_call"),
    );
    assert.ok(toolCallMessage);
    assert.deepEqual(toolCallMessage.data.content, [
      {
        type: "tool_call",
        callId: "toolu_calculate_1",
        name: "calculate_invoice_total",
        arguments: {
          hours: 2,
          hourlyRate: 100,
          taxRate: 0.1,
          currency: "USD",
        },
      },
    ]);
    const toolResultMessage = events.find(
      (event) =>
        event.type === "message.created" && event.data.role === "tool",
    );
    assert.ok(toolResultMessage);
    assert.deepEqual(toolResultMessage.data.content, [
      {
        callId: "toolu_calculate_1",
        output: {
          subtotal: 200,
          tax: 20,
          total: 220,
          currency: "USD",
        },
      },
    ]);
    assert.equal(
      events.some((event) => event.type === "action.requested"),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "action.completed"),
      true,
    );
    const history = await fixture.client.testAgent.history(result.sessionId);
    const action = history.items.find((item) => item.type === "action");
    assert.equal(action.name, "calculate_invoice_total");
    assert.equal(action.status, "completed");
    assert.equal("output" in action, false);
  } finally {
    await fixture.dispose();
  }
});

test("executes the same local action inside QuickJS", async () => {
  const fixture = await createRuntimeFixture(localActionResponse, {
    actionRuntime: "sandbox",
  });
  try {
    const result = await fixture.client.testAgent.run("Calculate it.").result;
    assert.equal(result.status, "completed");
    assert.equal(result.output, "The total is $220.");
    const events = await readSessionEvents(fixture.root, result.sessionId);
    assert.equal(
      events.some((event) => event.type === "action.completed"),
      true,
    );
  } finally {
    await fixture.dispose();
  }
});

test("pauses for a client action and resumes with durable tool results", async () => {
  const fixture = await createRuntimeFixture((_requests, index) =>
    index === 1
      ? {
          id: "msg_tool_call",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "toolu_approval_1",
              name: "request_invoice_approval",
              input: { invoiceTotal: 200 },
            },
          ],
        }
      : {
          id: "msg_after_tool",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Invoice approved." }],
        },
  );
  try {
    assert.deepEqual(
      fixture.client.testAgent.clientTools.map((tool) => tool.name),
      ["request_invoice_approval"],
    );

    const paused = await fixture.client.testAgent.run({
      content: "Finalize the invoice.",
      clientCapabilities: ["request_invoice_approval"],
    }).result;
    assert.equal(paused.status, "waiting_for_client_action");
    assert.deepEqual(paused.clientToolCalls, [
      {
        callId: "toolu_approval_1",
        name: "request_invoice_approval",
        arguments: { invoiceTotal: 200 },
      },
    ]);
    assert.equal(
      fixture.requests[0].tools.some(
        (tool) => tool.name === "request_invoice_approval",
      ),
      true,
    );

    const blockedFollowUp = await fixture.client.testAgent.resume(
      paused.sessionId,
      { content: "Skip approval and continue." },
    ).result;
    assert.equal(blockedFollowUp.status, "failed");
    assert.equal(blockedFollowUp.error.code, "client_action_required");
    assert.equal(fixture.requests.length, 1);

    const invalid = await fixture.client.testAgent.resume(paused.sessionId, {
      toolResults: [
        {
          callId: "toolu_approval_1",
          output: { approved: "yes" },
        },
      ],
    }).result;
    assert.equal(invalid.status, "failed");
    assert.equal(invalid.error.code, "invalid_tool_result");

    const completed = await fixture.client.testAgent.resume(paused.sessionId, {
      toolResults: [
        {
          callId: "toolu_approval_1",
          output: { approved: true },
        },
      ],
    }).result;
    assert.equal(completed.status, "completed");
    assert.equal(completed.output, "Invoice approved.");
    assert.deepEqual(fixture.requests[1].messages.at(-1), {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_approval_1",
          content: '{"approved":true}',
        },
      ],
    });

    const duplicate = await fixture.client.testAgent.resume(paused.sessionId, {
      toolResults: [
        {
          callId: "toolu_approval_1",
          output: { approved: true },
        },
      ],
    }).result;
    assert.equal(duplicate.status, "completed");
    assert.equal(duplicate.output, "Invoice approved.");
    assert.equal(fixture.requests.length, 2);

    const conflicting = await fixture.client.testAgent.resume(paused.sessionId, {
      toolResults: [
        {
          callId: "toolu_approval_1",
          output: { approved: false },
        },
      ],
    }).result;
    assert.equal(conflicting.status, "failed");
    assert.equal(conflicting.error.code, "action_result_conflict");

    const events = await readSessionEvents(fixture.root, paused.sessionId);
    assert.deepEqual(
      events.map((event) => event.type),
      [
        "session.created",
        "run.started",
        "message.created",
        "message.created",
        "client_action.requested",
        "run.paused",
        "client_action.resolved",
        "message.created",
        "message.created",
        "run.completed",
      ],
    );
    assert.equal(events.at(-1).run, 1);

    const history = await fixture.client.testAgent.history(paused.sessionId);
    const clientAction = history.items.find(
      (item) => item.type === "client_action",
    );
    assert.equal(clientAction.status, "completed");
    assert.equal(clientAction.arguments, undefined);
    assert.equal("output" in clientAction, false);
  } finally {
    await fixture.dispose();
  }
});

test("supports multimodal content, variables, and agent-scoped session reads", async () => {
  const fixture = await createRuntimeFixture(undefined, {
    systemPrompt: "Prepare work for {{CUSTOMER_NAME}}.",
  });
  try {
    const created = await fixture.client.testAgent.run({
      content: [
        { type: "text", text: "Review this image." },
        {
          type: "image",
          mimeType: "image/png",
          fileUri: "https://example.com/invoice.png",
        },
      ],
      name: "September invoice",
      metadata: {
        customerId: "cus_123",
        month: "2026-09",
      },
      variables: {
        CUSTOMER_NAME: "Acme",
      },
    }).result;
    assert.equal(created.status, "completed");
    assert.equal(fixture.requests[0].system, "Prepare work for Acme.");
    assert.deepEqual(fixture.requests[0].messages[0].content[1], {
      type: "image",
      source: {
        type: "url",
        url: "https://example.com/invoice.png",
      },
    });

    const snapshot = await fixture.client.testAgent.get(created.sessionId);
    assert.equal(snapshot.name, "September invoice");
    assert.deepEqual(snapshot.metadata, {
      customerId: "cus_123",
      month: "2026-09",
    });

    const history = await fixture.client.testAgent.history(created.sessionId, {
      page: 1,
      pageSize: 1,
    });
    assert.equal(history.total, 2);
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].role, "assistant");
    assert.equal(history.hasMore, true);

    const sessions = await fixture.client.testAgent.list({
      metadata: { customerId: "cus_123" },
      page: 1,
      pageSize: 20,
    });
    assert.equal(sessions.total, 1);
    assert.equal(sessions.items[0].sessionId, created.sessionId);

    const updated = await fixture.client.testAgent.update(created.sessionId, {
      name: "Approved September invoice",
      metadata: { approved: true },
    });
    assert.equal(updated.name, "Approved September invoice");
    assert.deepEqual(updated.metadata, {
      customerId: "cus_123",
      month: "2026-09",
      approved: true,
    });
  } finally {
    await fixture.dispose();
  }
});

test("executes the production application without a runtime orchajs import", async () => {
  const mock = await createMockAnthropic();
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-production-"));
  try {
    await writeFixtureProject(root, mock.baseUrl);
    await mkdir(resolve(root, "node_modules"), { recursive: true });
    await symlink(repositoryRoot, resolve(root, "node_modules/orchajs"), "dir");

    const outputPath = resolve(root, "dist/index.js");
    await build({
      entryPoints: [resolve(root, "src/index.ts")],
      outfile: outputPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      plugins: [orchaPlugin({ projectRoot: root })],
    });

    const applicationBundle = await readFile(outputPath, "utf8");
    assert.doesNotMatch(applicationBundle, /from\s*["']orchajs["']/);
    assert.doesNotMatch(applicationBundle, /compileRegistry/);
    assert.doesNotMatch(
      applicationBundle,
      /quickjs-emscripten|emscripten-module|QuickJSRuntime/,
    );
    assert.doesNotMatch(
      applicationBundle,
      /GoogleGenAI|generativelanguage\.googleapis\.com/,
    );

    const { stdout } = await executeFile(process.execPath, [outputPath], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    });
    const result = JSON.parse(stdout.trim());
    assert.equal(result.status, "completed");
    assert.equal(result.output, "mock-response-1");
  } finally {
    await mock.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("executes a sandboxed local action from the production ESM bundle", async () => {
  const mock = await createMockAnthropic((_requests, index) =>
    index === 1
      ? {
          id: "msg_production_tool",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "toolu_production_1",
              name: "mock_local",
              input: {},
            },
          ],
        }
      : {
          id: "msg_production_complete",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "sandbox-production-ok" }],
        },
  );
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-sandbox-production-"));
  try {
    await writeFixtureProject(root, mock.baseUrl, "sandbox");
    await mkdir(resolve(root, "node_modules"), { recursive: true });
    await symlink(repositoryRoot, resolve(root, "node_modules/orchajs"), "dir");

    const outputPath = resolve(root, "dist/index.js");
    await build({
      entryPoints: [resolve(root, "src/index.ts")],
      outfile: outputPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      plugins: [orchaPlugin({ projectRoot: root })],
    });

    const applicationBundle = await readFile(outputPath, "utf8");
    assert.doesNotMatch(applicationBundle, /from\s*["']orchajs["']/);
    assert.match(applicationBundle, /node:module/);

    const { stdout } = await executeFile(process.execPath, [outputPath], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    });
    const result = JSON.parse(stdout.trim());
    assert.equal(result.status, "completed");
    assert.equal(result.output, "sandbox-production-ok");

    const events = await readSessionEvents(root, result.sessionId);
    assert.equal(
      events.some((event) => event.type === "action.completed"),
      true,
    );
    assert.equal(
      events.some((event) => event.type === "action.failed"),
      false,
    );
  } finally {
    await mock.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function createRuntimeFixture(responseFactory, options = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-runtime-"));
  const provider = options.provider ?? "anthropic";
  const mock =
    provider === "openai"
      ? await createMockOpenAI(responseFactory)
      : provider === "googlegenai"
        ? await createMockGoogleGenAI(responseFactory)
      : await createMockAnthropic(responseFactory);
  const bundle = {
    schemaVersion: 1,
    agents: {
      testAgent: {
        name: "testAgent",
        provider,
        model:
          provider === "anthropic"
            ? "claude-test"
            : provider === "openai"
              ? "gpt-test"
              : "gemini-test",
        systemPrompt: options.systemPrompt ?? "You are a test agent.",
        maxTokens: 32,
        reasoningLevel: options.reasoningLevel,
        outputType: options.outputType ?? "text",
        ...(options.outputSchema
          ? { outputSchema: options.outputSchema }
          : {}),
        actions: {
          request_invoice_approval: {
            name: "request_invoice_approval",
            directoryName: "requestInvoiceApproval",
            description: "Request invoice approval.",
            execution: "client",
            parameters: {
              type: "object",
              properties: {
                invoiceTotal: { type: "number" },
              },
              required: ["invoiceTotal"],
            },
            outputSchema: {
              type: "object",
              properties: {
                approved: { type: "boolean" },
              },
              required: ["approved"],
            },
          },
          calculate_invoice_total: {
            name: "calculate_invoice_total",
            directoryName: "calculateInvoiceTotal",
            description: "Calculate an invoice total.",
            execution: "local",
            parameters: {
              type: "object",
              properties: {
                hours: { type: "number" },
                hourlyRate: { type: "number" },
                taxRate: { type: "number" },
                currency: { type: "string" },
              },
              required: ["hours", "hourlyRate", "taxRate", "currency"],
            },
            outputSchema: {
              type: "object",
              properties: {
                subtotal: { type: "number" },
                tax: { type: "number" },
                total: { type: "number" },
                currency: { type: "string" },
              },
              required: ["subtotal", "tax", "total", "currency"],
            },
            source: [
              "var __orchaActionModule = {",
              "  default: ({ hours, hourlyRate, taxRate, currency }) => {",
              "    const subtotal = hours * hourlyRate;",
              "    const tax = subtotal * taxRate;",
              "    return { subtotal, tax, total: subtotal + tax, currency };",
              "  },",
              "};",
            ].join("\n"),
            sourceHash: "test-action-hash",
          },
        },
      },
    },
  };
  const client = createOrcha(() => bundle, generateProviderResponse);
  client.init({
    root,
    providers: {
      [provider]: {
        apiKey: "test-key",
        baseUrl: mock.baseUrl,
      },
    },
    actions: {
      runtime: options.actionRuntime ?? "native",
    },
    agents: {
      testAgent: "./testAgent",
    },
  });

  return {
    root,
    client,
    requests: mock.requests,
    async dispose() {
      await mock.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

function localActionResponse(_requests, index) {
  return index === 1
    ? {
        id: "msg_local_action",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_calculate_1",
            name: "calculate_invoice_total",
            input: {
              hours: 2,
              hourlyRate: 100,
              taxRate: 0.1,
              currency: "USD",
            },
          },
        ],
      }
    : {
        id: "msg_local_complete",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "The total is $220." }],
      };
}

async function createMockAnthropic(responseFactory) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    requests.push(JSON.parse(body));
    const index = requests.length;
    const generated = responseFactory?.(requests, index);
    if (generated?.streamText) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      writeAnthropicStream(response, generated, index);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: generated?.id ?? `msg_mock_${index}`,
        stop_reason: generated?.stop_reason ?? "end_turn",
        content:
          generated?.content ??
          [{ type: "text", text: `mock-response-${index}` }],
        usage: {
          input_tokens: 7,
          output_tokens: 3,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
      }),
    );
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) =>
          error ? rejectClose(error) : resolveClose(),
        ),
      ),
  };
}

async function createMockOpenAI(responseFactory) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    requests.push(JSON.parse(body));
    const index = requests.length;
    const generated = responseFactory?.(requests, index) ?? {
      id: `resp_mock_${index}`,
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: `mock-response-${index}`,
              annotations: [],
            },
          ],
        },
      ],
    };
    const completed = {
      ...generated,
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens_details: { reasoning_tokens: 1 },
      },
    };

    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const delta of generated.streamText ?? []) {
      writeServerSentEvent(response, {
        type: "response.output_text.delta",
        delta,
      });
    }
    writeServerSentEvent(response, {
      type:
        generated.status === "incomplete"
          ? "response.incomplete"
          : "response.completed",
      response: completed,
    });
    response.end();
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) =>
          error ? rejectClose(error) : resolveClose(),
        ),
      ),
  };
}

async function createMockGoogleGenAI(responseFactory) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    requests.push(JSON.parse(body));
    const index = requests.length;
    const generated = responseFactory?.(requests, index) ?? {
      chunks: [
        {
          responseId: `google_mock_${index}`,
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: `mock-response-${index}` }],
              },
              finishReason: "STOP",
            },
          ],
        },
      ],
    };

    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const chunk of generated.chunks) {
      response.write(`data: ${JSON.stringify({
        ...chunk,
        usageMetadata: chunk.usageMetadata ?? {
          promptTokenCount: 7,
          candidatesTokenCount: 3,
          cachedContentTokenCount: 2,
          totalTokenCount: 10,
        },
      })}\n\n`);
    }
    response.end();
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) =>
          error ? rejectClose(error) : resolveClose(),
        ),
      ),
  };
}

function writeServerSentEvent(response, event) {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function writeAnthropicStream(response, generated, index) {
  writeServerSentEvent(response, {
    type: "message_start",
    message: {
      id: generated.id ?? `msg_mock_${index}`,
      usage: {
        input_tokens: 7,
        output_tokens: 0,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 1,
      },
    },
  });
  writeServerSentEvent(response, {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  for (const text of generated.streamText) {
    writeServerSentEvent(response, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    });
  }
  writeServerSentEvent(response, {
    type: "content_block_stop",
    index: 0,
  });
  writeServerSentEvent(response, {
    type: "message_delta",
    delta: { stop_reason: generated.stop_reason ?? "end_turn" },
    usage: { output_tokens: 3 },
  });
  writeServerSentEvent(response, { type: "message_stop" });
  response.end();
}

async function collectStream(stream) {
  const snapshots = [];
  for await (const snapshot of stream) {
    snapshots.push(snapshot);
  }
  return snapshots;
}

async function readSessionEvents(root, sessionId) {
  const source = await readFile(
    resolve(root, ".orcha/sessions", `${sessionId}.jsonl`),
    "utf8",
  );
  return source
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeFixtureProject(root, baseUrl, actionRuntime = "native") {
  const files = {
    "package.json": JSON.stringify({
      private: true,
      type: "module",
    }),
    "orcha/testAgent/index.json": JSON.stringify({
      provider: "anthropic",
      model: "claude-test",
      maxTokens: 32,
      outputType: "text",
    }),
    "orcha/testAgent/instructions.md": "You are a test agent.\n",
    "orcha/testAgent/actions/requestInvoiceApproval/index.json": JSON.stringify({
      name: "request_invoice_approval",
      description: "Request invoice approval.",
      execution: "client",
      parameters: {
        type: "object",
        properties: {
          invoiceTotal: { type: "number" },
        },
        required: ["invoiceTotal"],
      },
      outputSchema: {
        type: "object",
        properties: {
          approved: { type: "boolean" },
        },
        required: ["approved"],
      },
    }),
    "orcha/testAgent/actions/mockLocal/index.json": JSON.stringify({
      name: "mock_local",
      description: "Return a mocked local result.",
      execution: "local",
      parameters: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
        },
        required: ["ok"],
      },
    }),
    "orcha/testAgent/actions/mockLocal/index.js":
      "export default async function mockLocal() { return { ok: true }; }\n",
    "orcha/index.ts": [
      'import { orcha } from "orchajs";',
      "orcha.init({",
      `  providers: { anthropic: { apiKey: "test-key", baseUrl: ${JSON.stringify(baseUrl)} } },`,
      `  actions: { runtime: ${JSON.stringify(actionRuntime)} },`,
      '  agents: { testAgent: "./testAgent" },',
      "});",
      "",
    ].join("\n"),
    "src/index.ts": [
      'import { orcha } from "orchajs";',
      'import "../orcha/index.js";',
      'const result = await orcha.testAgent.run("production").result;',
      "console.log(JSON.stringify(result));",
      "",
    ].join("\n"),
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const path = resolve(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}
