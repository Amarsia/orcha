import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  orcha,
  type AgentRuntime,
  type MessageContent,
  type OrchaClient,
  type SessionEvent,
  type ToolResult,
} from "orchajs";
import { listTests, runTests } from "orchajs/testing";
import "../orcha/index.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(projectRoot, "public");
const port = Number.parseInt(process.env.PORT ?? "4310", 10);
const host = "127.0.0.1";
const playgroundConfiguration = JSON.parse(
  await readFile(resolve(projectRoot, "playground.json"), "utf8"),
) as {
  agents?: Record<
    string,
    {
      description?: string;
      examples?: Array<{
        label: string;
        content: string | MessageContent[];
      }>;
    }
  >;
};

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`Orcha playground: http://${host}:${port}`);
});

async function route(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);

  if (method === "GET" && url.pathname === "/api/agents") {
    sendJson(response, 200, {
      agents: Object.values(orcha.getCompiledBundle().agents).map(
        publicAgentManifest,
      ),
    });
    return;
  }

  if (
    method === "GET" &&
    segments.length === 4 &&
    segments[0] === "api" &&
    segments[1] === "agents" &&
    segments[3] === "tests"
  ) {
    getAgent(segments[2]);
    sendJson(response, 200, {
      tests: await listTests(orcha, { agent: segments[2] }),
    });
    return;
  }

  if (
    method === "POST" &&
    segments.length === 4 &&
    segments[0] === "api" &&
    segments[1] === "agents" &&
    segments[3] === "executions"
  ) {
    await executeAgent(segments[2], request, response);
    return;
  }

  if (
    method === "POST" &&
    segments.length === 4 &&
    segments[0] === "api" &&
    segments[1] === "agents" &&
    segments[3] === "tests"
  ) {
    getAgent(segments[2]);
    const test = url.searchParams.get("test") ?? undefined;
    sendJson(
      response,
      200,
      await runTests(orcha, {
        agent: segments[2],
        ...(test ? { test } : {}),
      }),
    );
    return;
  }

  if (
    method === "GET" &&
    segments.length === 4 &&
    segments[0] === "api" &&
    segments[1] === "agents" &&
    segments[3] === "sessions"
  ) {
    const agent = getAgent(segments[2]);
    sendJson(response, 200, await agent.list({
      page: positiveInteger(url.searchParams.get("page"), 1),
      pageSize: positiveInteger(url.searchParams.get("pageSize"), 50),
    }));
    return;
  }

  if (
    method === "GET" &&
    segments.length >= 5 &&
    segments[0] === "api" &&
    segments[1] === "agents" &&
    segments[3] === "sessions"
  ) {
    const agent = getAgent(segments[2]);
    const sessionId = segments[4];
    if (segments.length === 5) {
      sendJson(response, 200, await agent.get(sessionId));
      return;
    }
    if (segments.length === 6 && segments[5] === "history") {
      sendJson(response, 200, await agent.history(sessionId, {
        page: positiveInteger(url.searchParams.get("page"), 1),
        pageSize: positiveInteger(url.searchParams.get("pageSize"), 100),
      }));
      return;
    }
    if (segments.length === 6 && segments[5] === "events") {
      sendJson(response, 200, {
        events: await readAllSessionEvents(agent, sessionId),
      });
      return;
    }
  }

  if (method === "GET") {
    const asset = staticAsset(url.pathname);
    if (asset) {
      const contents = await readFile(resolve(publicRoot, asset.file));
      response.writeHead(200, {
        "content-type": asset.contentType,
        "cache-control": "no-store",
      });
      response.end(contents);
      return;
    }
  }

  sendJson(response, 404, { error: "Not found." });
}

async function executeAgent(
  agentName: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const agent = getAgent(agentName);
  const body = await readJsonBody(request);
  const sessionId = optionalString(body.sessionId);
  const clientCapabilities = agent.clientTools.map((tool) => tool.name);
  let execution;

  if ("toolResults" in body) {
    if (!sessionId) {
      throw new Error("sessionId is required with toolResults.");
    }
    execution = agent.resume(sessionId, {
      toolResults: parseToolResults(body.toolResults),
    });
  } else {
    const content = parseContent(body.content);
    const name = optionalString(body.name) ?? sessionNameFromContent(content);
    execution = sessionId
      ? agent.resume(sessionId, { content, clientCapabilities })
      : agent.run({
          content,
          clientCapabilities,
          ...(name ? { name } : {}),
        });
  }

  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });

  try {
    for await (const snapshot of execution.stream) {
      writeEvent(response, { type: "snapshot", snapshot });
    }
    const result = await execution.result;
    writeEvent(response, { type: "result", result });
    const evaluations = await execution.evaluations;
    writeEvent(response, {
      type: "evaluations",
      sessionId: result.sessionId,
      evaluations,
    });
    response.end();
  } catch (error) {
    writeEvent(response, {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    response.end();
  }
}

function getAgent(name: string): AgentRuntime {
  const manifest = orcha.getCompiledBundle().agents[name];
  const agent = (orcha as OrchaClient)[name] as AgentRuntime | undefined;
  if (!manifest || !agent) {
    throw new Error(`Unknown agent "${name}".`);
  }
  return agent;
}

function publicAgentManifest(
  manifest: ReturnType<typeof orcha.getCompiledBundle>["agents"][string],
) {
  return {
    name: manifest.name,
    description:
      playgroundConfiguration.agents?.[manifest.name]?.description,
    examples:
      playgroundConfiguration.agents?.[manifest.name]?.examples ?? [],
    provider: manifest.provider,
    model: manifest.model,
    region: manifest.region ?? "provider_managed",
    maxTokens: manifest.maxTokens,
    reasoningLevel: manifest.reasoningLevel,
    outputType: manifest.outputType,
    outputSchema: manifest.outputSchema,
    systemPrompt: manifest.systemPrompt,
    actions: Object.values(manifest.actions).map((action) => ({
      name: action.name,
      description: action.description,
      execution: action.execution,
      parameters: action.parameters,
      outputSchema: action.outputSchema,
      permissions: action.permissions,
      timeoutMs: action.timeoutMs,
      sideEffect: action.sideEffect ?? false,
    })),
    skills: Object.values(manifest.skills).map((skill) => ({
      name: skill.name,
      description: skill.description,
      triggers: skill.triggers ?? [],
      instructions: skill.instructions,
    })),
    evaluations: Object.values(manifest.evaluations).map((evaluation) => ({
      name: evaluation.name,
      description: evaluation.description,
      instructions: evaluation.instructions ?? evaluation.description,
      enabled: evaluation.enabled,
      provider: evaluation.provider,
      model: evaluation.model,
      maxTokens: evaluation.maxTokens,
      reasoningLevel: evaluation.reasoningLevel,
      metrics: evaluation.metrics,
    })),
  };
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new Error("Request body exceeds 1 MB.");
    }
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function writeEvent(response: ServerResponse, value: unknown): void {
  response.write(`${JSON.stringify(value)}\n`);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function parseContent(value: unknown): string | MessageContent[] {
  if (typeof value === "string") {
    return requiredString(value, "content");
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      "content must be a non-empty string or MessageContent array.",
    );
  }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.type !== "string") {
      throw new Error("Every content item requires a valid type.");
    }
    if (item.type === "text" && typeof item.text === "string") {
      return { type: "text", text: item.text };
    }
    if (
      isFileContentType(item.type) &&
      typeof item.mimeType === "string" &&
      typeof item.fileUri === "string"
    ) {
      return {
        type: item.type,
        mimeType: item.mimeType,
        fileUri: item.fileUri,
      };
    }
    throw new Error(
      `Content item "${item.type}" has invalid fields.`,
    );
  });
}

function isFileContentType(
  value: unknown,
): value is "image" | "video" | "audio" | "url" {
  return (
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "url"
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function parseToolResults(value: unknown): ToolResult[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("toolResults must be a non-empty array.");
  }
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.callId !== "string" ||
      !("output" in item) ||
      (item.isError !== undefined &&
        typeof item.isError !== "boolean")
    ) {
      throw new Error(
        "Each tool result requires callId, output, and optional boolean isError.",
      );
    }
    return {
      callId: item.callId,
      output: item.output,
      ...(item.isError === true ? { isError: true } : {}),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function positiveInteger(
  value: string | null,
  fallback: number,
): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readAllSessionEvents(
  agent: AgentRuntime,
  sessionId: string,
): Promise<Awaited<ReturnType<AgentRuntime["events"]>>["events"]> {
  const pages: SessionEvent[][] = [];
  let page = 1;
  let hasMore = true;
  let throughSequence: number | undefined;
  while (hasMore) {
    const result = await agent.events(sessionId, {
      page,
      pageSize: 100,
      ...(throughSequence ? { throughSequence } : {}),
    });
    throughSequence = result.throughSequence;
    pages.unshift(result.events);
    hasMore = result.hasMore;
    page += 1;
  }
  return pages.flat();
}

function sessionNameFromContent(content: string | MessageContent[]): string {
  const text = typeof content === "string"
    ? content
    : content.find(
        (item): item is Extract<MessageContent, { type: "text" }> =>
          item.type === "text",
      )?.text ?? "Untitled session";
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 64
    ? `${normalized.slice(0, 61)}…`
    : normalized;
}

function staticAsset(
  pathname: string,
): { file: string; contentType: string } | undefined {
  const assets: Record<string, { file: string; contentType: string }> = {
    "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
    "/app.js": {
      file: "app.js",
      contentType: "text/javascript; charset=utf-8",
    },
    "/styles.css": {
      file: "styles.css",
      contentType: "text/css; charset=utf-8",
    },
    "/orcha-logo.svg": {
      file: "orcha-logo.svg",
      contentType: "image/svg+xml",
    },
  };
  return assets[pathname];
}
