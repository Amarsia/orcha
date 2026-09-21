import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { orcha } from "../orcha.js";
import type { OrchaClient } from "../orcha.js";
import { loadProject } from "../project-loader.js";
import { RuntimeAgent } from "../runtime/agent.js";
import { listTests, runTests } from "../testing.js";
import type {
  AgentContentInput,
  Execution,
  MessageContentInput,
  SessionEvent,
  ToolResult,
} from "../types.js";
import { readPlaygroundAgentSource } from "./source.js";

export interface PlaygroundOptions {
  projectRoot?: string;
  host?: string;
  port?: number;
  open?: boolean;
}

export async function startPlayground(
  options: PlaygroundOptions = {},
): Promise<void> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const host = options.host ?? "localhost";
  const port = options.port ?? 4310;
  if (host === "0.0.0.0" || host === "::") {
    throw new Error(
      "Use an explicit hostname or IP address instead of a wildcard playground host.",
    );
  }
  const mutationToken = randomBytes(32).toString("base64url");
  const allowedHosts = playgroundHosts(host, port);
  await loadProject(projectRoot);

  const projectClients = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    try {
      await routeRequest({
        request,
        response,
        projectRoot,
        host,
        port,
        projectClients,
        mutationToken,
        allowedHosts,
      });
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolveListening);
  });

  const url = `http://${host}:${port}`;
  console.log(`Orcha playground: ${url}`);
  if (options.open !== false) {
    openBrowser(url);
  }

  let reloadTimer: NodeJS.Timeout | undefined;
  let reloading = false;
  let reloadAgain = false;
  const reload = async (): Promise<void> => {
    if (reloading) {
      reloadAgain = true;
      return;
    }
    reloading = true;
    try {
      await loadProject(projectRoot);
      publishProjectEvent(projectClients, {
        type: "project.updated",
        timestamp: new Date().toISOString(),
      });
      console.log("[orcha] playground reloaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publishProjectEvent(projectClients, {
        type: "project.error",
        timestamp: new Date().toISOString(),
        error: message,
      });
      console.error(`[orcha] playground reload failed — ${message}`);
    } finally {
      reloading = false;
      if (reloadAgain) {
        reloadAgain = false;
        await reload();
      }
    }
  };
  const watcher = watch(
    resolve(projectRoot, "orcha"),
    { recursive: true },
    () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void reload(), 100);
    },
  );

  await new Promise<void>((resolveStop) => {
    const stop = (): void => {
      clearTimeout(reloadTimer);
      watcher.close();
      for (const client of projectClients) {
        client.end();
      }
      server.close(() => resolveStop());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

interface RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  projectRoot: string;
  host: string;
  port: number;
  projectClients: Set<ServerResponse>;
  mutationToken: string;
  allowedHosts: Set<string>;
}

async function routeRequest(context: RouteContext): Promise<void> {
  const { request, response } = context;
  const method = request.method ?? "GET";
  const url = new URL(
    request.url ?? "/",
    `http://${context.host}:${context.port}`,
  );
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  validateRequestHost(request, context.allowedHosts);

  if (method === "GET" && url.pathname === "/api/playground") {
    sendJson(response, 200, { mutationToken: context.mutationToken });
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    validateMutationRequest(request, context.mutationToken);
  }

  if (method === "GET" && url.pathname === "/api/project/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");
    context.projectClients.add(response);
    response.once("close", () => context.projectClients.delete(response));
    return;
  }

  if (method === "GET" && url.pathname === "/api/agents") {
    sendJson(response, 200, {
      agents: Object.values(orcha.getCompiledBundle().agents).map(
        publicAgentSummary,
      ),
    });
    return;
  }

  if (
    method === "GET" &&
    segments.length === 3 &&
    segments[0] === "api" &&
    segments[1] === "agents"
  ) {
    getAgent(segments[2]);
    sendJson(
      response,
      200,
      await readPlaygroundAgentSource(orcha, segments[2]),
    );
    return;
  }

  if (
    segments.length === 4 &&
    segments[0] === "api" &&
    segments[1] === "agents" &&
    segments[3] === "tests"
  ) {
    getAgent(segments[2]);
    if (method === "GET") {
      const tests = await listTests(orcha, { agent: segments[2] });
      sendJson(response, 200, {
        tests: tests.map((test) => ({
          ...test,
          rawConfiguration: JSON.stringify(test.configuration, null, 2),
        })),
      });
      return;
    }
    if (method === "POST") {
      const body = await readJsonBody(request);
      const test = optionalString(body.test);
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
    segments.length >= 4 &&
    segments[0] === "api" &&
    segments[1] === "agents" &&
    segments[3] === "sessions"
  ) {
    const agent = getAgent(segments[2]);
    if (method === "GET" && segments.length === 4) {
      sendJson(
        response,
        200,
        await agent.list({
          page: positiveInteger(url.searchParams.get("page"), 1),
          pageSize: positiveInteger(url.searchParams.get("pageSize"), 50),
        }),
      );
      return;
    }
    if (
      method === "GET" &&
      segments.length === 5 &&
      segments[4] === "stream"
    ) {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      response.write(": connected\n\n");
      let closed = false;
      const unsubscribe = agent._subscribeAllSessionEvents((sessionId) => {
        void agent.get(sessionId).then(
          (snapshot) => {
            if (!closed) {
              response.write(
                `data: ${JSON.stringify({ snapshot })}\n\n`,
              );
            }
          },
          () => undefined,
        );
      });
      response.once("close", () => {
        closed = true;
        unsubscribe();
      });
      return;
    }
    const sessionId = segments[4];
    if (method === "GET" && segments.length === 5) {
      sendJson(response, 200, await agent.get(sessionId));
      return;
    }
    if (
      method === "GET" &&
      segments.length === 6 &&
      segments[5] === "events"
    ) {
      sendJson(response, 200, {
        events: await readAllEvents(agent, sessionId),
      });
      return;
    }
    if (
      method === "GET" &&
      segments.length === 6 &&
      segments[5] === "stream"
    ) {
      await agent.get(sessionId);
      let ready = false;
      const pending: SessionEvent[][] = [];
      const publish = (events: SessionEvent[]): void => {
        if (!ready) {
          pending.push(events);
          return;
        }
        response.write(`data: ${JSON.stringify({ events })}\n\n`);
      };
      const unsubscribe = agent._subscribeSessionEvents(
        sessionId,
        publish,
      );
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      response.write(": connected\n\n");
      ready = true;
      for (const events of pending) {
        publish(events);
      }
      pending.length = 0;
      response.once("close", unsubscribe);
      return;
    }
    if (
      method === "POST" &&
      segments.length === 6 &&
      segments[5] === "pause"
    ) {
      sendJson(response, 200, await agent.pause(sessionId));
      return;
    }
  }

  if (
    method === "GET" &&
    segments.length === 6 &&
    segments[0] === "api" &&
    segments[1] === "agents" &&
    segments[3] === "subagents" &&
    segments[5] === "events"
  ) {
    const agent = getAgent(segments[2]);
    sendJson(response, 200, {
      events: await readAllSubagentEvents(agent, segments[4]),
    });
    return;
  }

  if (
    method === "GET" &&
    segments.length === 6 &&
    segments[0] === "api" &&
    segments[1] === "agents" &&
    segments[3] === "subagents" &&
    segments[5] === "stream"
  ) {
    const agent = getAgent(segments[2]);
    let ready = false;
    const pending: SessionEvent[][] = [];
    const publish = (events: SessionEvent[]): void => {
      if (!ready) {
        pending.push(events);
        return;
      }
      response.write(`data: ${JSON.stringify({ events })}\n\n`);
    };
    const unsubscribe = await agent._subscribeSubagentSessionEvents(
      segments[4],
      publish,
    );
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    response.write(": connected\n\n");
    ready = true;
    for (const events of pending) {
      publish(events);
    }
    pending.length = 0;
    response.once("close", unsubscribe);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  if (method === "GET") {
    await serveAsset(response, url.pathname);
    return;
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
  let execution: Execution;
  if ("toolResults" in body) {
    if (!sessionId) {
      throw new HttpError(400, "sessionId is required with toolResults.");
    }
    execution = agent.resume(sessionId, {
      toolResults: parseToolResults(body.toolResults),
    });
  } else {
    const content = parseContent(body.content);
    const name = optionalString(body.name);
    execution = sessionId
      ? agent.resume(sessionId, { content, clientCapabilities })
      : agent.run({
          content,
          clientCapabilities,
          ...(name ? { name } : {}),
        });
  }
  await streamExecution(agent, execution, response);
}

async function streamExecution(
  agent: RuntimeAgent,
  execution: Execution,
  response: ServerResponse,
): Promise<void> {
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const unsubscribe = agent._subscribeSessionEvents(
    execution.sessionId,
    (events) => writeNdjson(response, { type: "events.appended", events }),
  );
  writeNdjson(response, {
    type: "execution.started",
    sessionId: execution.sessionId,
  });
  try {
    for await (const snapshot of execution.stream) {
      writeNdjson(response, { type: "snapshot", snapshot });
    }
    const result = await execution.result;
    writeNdjson(response, { type: "result", result });
    writeNdjson(response, {
      type: "events",
      sessionId: result.sessionId,
      events: await readAllEvents(agent, result.sessionId),
    });
    writeNdjson(response, {
      type: "evaluations",
      sessionId: result.sessionId,
      evaluations: await execution.evaluations,
    });
    response.end();
  } catch (error) {
    await execution.result.catch(() => undefined);
    writeNdjson(response, {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      writeNdjson(response, {
        type: "events",
        sessionId: execution.sessionId,
        events: await readAllEvents(agent, execution.sessionId),
      });
    } catch {
      // The session may have failed before it could be persisted.
    }
    response.end();
  } finally {
    unsubscribe();
  }
}

function getAgent(name: string): RuntimeAgent {
  const manifest = orcha.getCompiledBundle().agents[name];
  const agent = (orcha as OrchaClient)[name] as RuntimeAgent | undefined;
  if (!manifest || !agent) {
    throw new HttpError(404, `Unknown agent "${name}".`);
  }
  return agent;
}

function publicAgentSummary(
  manifest: ReturnType<typeof orcha.getCompiledBundle>["agents"][string],
) {
  return {
    key: manifest.key,
    name: manifest.name,
    description: manifest.description,
    provider: manifest.provider,
    model: manifest.model,
    actionCount: Object.keys(manifest.actions).length,
    skillCount: Object.keys(manifest.skills).length,
    evaluationCount: Object.keys(manifest.evaluations).length,
    subagentCount: Object.keys(manifest.subagents).length,
  };
}

async function readAllEvents(
  agent: RuntimeAgent,
  sessionId: string,
): Promise<SessionEvent[]> {
  return readAllEventPages((page, throughSequence) =>
    agent.events(sessionId, {
      page,
      pageSize: 100,
      ...(throughSequence ? { throughSequence } : {}),
    }),
  );
}

async function readAllSubagentEvents(
  agent: RuntimeAgent,
  sessionId: string,
): Promise<SessionEvent[]> {
  return readAllEventPages((page, throughSequence) =>
    agent.subagentEvents(sessionId, {
      page,
      pageSize: 100,
      ...(throughSequence ? { throughSequence } : {}),
    }),
  );
}

async function readAllEventPages(
  read: (
    page: number,
    throughSequence?: number,
  ) => Promise<{
    events: SessionEvent[];
    throughSequence: number;
    hasMore: boolean;
  }>,
): Promise<SessionEvent[]> {
  const pages: SessionEvent[][] = [];
  let page = 1;
  let hasMore = true;
  let throughSequence: number | undefined;
  while (hasMore) {
    const result = await read(page, throughSequence);
    throughSequence = result.throughSequence;
    pages.unshift(result.events);
    hasMore = result.hasMore;
    page += 1;
  }
  return pages.flat();
}

async function serveAsset(
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  const publicRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "public",
  );
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const path = resolve(publicRoot, requested);
  const relativePath = relative(publicRoot, path);
  if (
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    !existsSync(path)
  ) {
    const indexPath = resolve(publicRoot, "index.html");
    if (!existsSync(indexPath)) {
      sendJson(response, 503, {
        error: "Playground assets are missing. Rebuild orchajs.",
      });
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(await readFile(indexPath));
    return;
  }
  response.writeHead(200, {
    "content-type": contentType(path),
    "cache-control": "no-store",
  });
  response.end(await readFile(path));
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2_000_000) {
      throw new HttpError(413, "Request body exceeds 2 MB.");
    }
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must contain valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function parseContent(value: unknown): AgentContentInput {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0) {
    throw new HttpError(400, "content is required.");
  }
  const parsed = items.map(parseContentItem);
  return Array.isArray(value) ? parsed : parsed[0];
}

function parseContentItem(value: unknown): MessageContentInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Every content item must be an object.");
  }
  const item = value as Record<string, unknown>;
  if (typeof item.filePath === "string") {
    return {
      filePath: item.filePath,
      ...(typeof item.mimeType === "string"
        ? { mimeType: item.mimeType }
        : {}),
    };
  }
  if (typeof item.url === "string") {
    return {
      url: item.url,
      ...(typeof item.mimeType === "string"
        ? { mimeType: item.mimeType }
        : {}),
    };
  }
  if (item.type === "text" && typeof item.text === "string") {
    return { type: "text", text: item.text };
  }
  if (
    (item.type === "image" ||
      item.type === "video" ||
      item.type === "audio" ||
      item.type === "url") &&
    typeof item.mimeType === "string" &&
    typeof item.fileUri === "string"
  ) {
    return {
      type: item.type,
      mimeType: item.mimeType,
      fileUri: item.fileUri,
    };
  }
  throw new HttpError(400, "Content item has invalid fields.");
}

function parseToolResults(value: unknown): ToolResult[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "toolResults must be a non-empty array.");
  }
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      typeof (item as Record<string, unknown>).callId !== "string" ||
      !("output" in item)
    ) {
      throw new HttpError(
        400,
        "Every tool result requires callId and output.",
      );
    }
    const result = item as Record<string, unknown>;
    return {
      callId: result.callId as string,
      output: result.output,
      ...(result.isError === true ? { isError: true } : {}),
    };
  });
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.headersSent) {
    return;
  }
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function writeNdjson(response: ServerResponse, value: unknown): void {
  response.write(`${JSON.stringify(value)}\n`);
}

function publishProjectEvent(
  clients: Set<ServerResponse>,
  value: unknown,
): void {
  const payload = `data: ${JSON.stringify(value)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const arguments_ =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, arguments_, {
    detached: true,
    stdio: "ignore",
  });
  child.once("error", () => undefined);
  child.unref();
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function playgroundHosts(host: string, port: number): Set<string> {
  const configured =
    host.includes(":") && !host.startsWith("[")
      ? `[${host}]:${port}`
      : `${host}:${port}`;
  const hosts = new Set([configured.toLowerCase()]);
  if (["127.0.0.1", "localhost", "::1"].includes(host)) {
    hosts.add(`127.0.0.1:${port}`);
    hosts.add(`localhost:${port}`);
    hosts.add(`[::1]:${port}`);
  }
  return hosts;
}

function validateRequestHost(
  request: IncomingMessage,
  allowedHosts: Set<string>,
): void {
  const host = request.headers.host?.toLowerCase();
  if (!host || !allowedHosts.has(host)) {
    throw new HttpError(403, "Playground request host is not allowed.");
  }
}

function validateMutationRequest(
  request: IncomingMessage,
  mutationToken: string,
): void {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(
      415,
      "Playground mutations require application/json.",
    );
  }
  if (request.headers["x-orcha-playground-token"] !== mutationToken) {
    throw new HttpError(403, "Invalid playground mutation token.");
  }
  const origin = request.headers.origin;
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      throw new HttpError(403, "Invalid playground request origin.");
    }
    if (originHost !== request.headers.host?.toLowerCase()) {
      throw new HttpError(403, "Cross-origin playground request denied.");
    }
  }
}
