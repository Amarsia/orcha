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

test("reconstructs completed history when continuing a session", async () => {
  const fixture = await createRuntimeFixture();
  try {
    const first = await fixture.client.testAgent.run("first message").result;
    assert.equal(first.status, "completed");

    const second = await fixture.client.testAgent.run({
      sessionId: first.sessionId,
      input: "second message",
    }).result;
    assert.equal(second.status, "completed");

    assert.equal(fixture.requests.length, 2);
    assert.deepEqual(fixture.requests[1].messages, [
      { role: "user", content: "first message" },
      { role: "assistant", content: "mock-response-1" },
      { role: "user", content: "second message" },
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

async function createRuntimeFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-runtime-"));
  const mock = await createMockAnthropic();
  const bundle = {
    schemaVersion: 1,
    agents: {
      testAgent: {
        name: "testAgent",
        provider: "anthropic",
        model: "claude-test",
        systemPrompt: "You are a test agent.",
        maxTokens: 32,
        reasoningLevel: "disabled",
        outputType: "text",
      },
    },
  };
  const client = createOrcha(() => bundle);
  client.init({
    root,
    providers: {
      anthropic: {
        apiKey: "test-key",
        baseUrl: mock.baseUrl,
      },
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

async function createMockAnthropic() {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    requests.push(JSON.parse(body));
    const index = requests.length;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: `msg_mock_${index}`,
        stop_reason: "end_turn",
        content: [{ type: "text", text: `mock-response-${index}` }],
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

async function writeFixtureProject(root, baseUrl) {
  const files = {
    "package.json": JSON.stringify({
      private: true,
      type: "module",
    }),
    "orcha/testAgent/index.json": JSON.stringify({
      provider: "anthropic",
      model: "claude-test",
      maxTokens: 32,
      reasoningLevel: "disabled",
      outputType: "text",
    }),
    "orcha/testAgent/instructions.md": "You are a test agent.\n",
    "orcha/index.ts": [
      'import { orcha } from "orchajs";',
      "orcha.init({",
      `  providers: { anthropic: { apiKey: "test-key", baseUrl: ${JSON.stringify(baseUrl)} } },`,
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
