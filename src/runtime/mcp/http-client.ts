import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CompiledMcpServerManifest } from "../../types.js";
import type {
  McpClientConnection,
  McpTool,
  McpToolCallResult,
} from "./client.js";

export async function createHttpMcpClient(
  server: CompiledMcpServerManifest,
  credentials: Record<string, string | undefined>,
): Promise<McpClientConnection> {
  if (server.transport !== "streamable-http") {
    throw new Error(
      `MCP transport "${server.transport}" is not available in this runtime.`,
    );
  }
  const client = new Client({
    name: "orchajs",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(server.url),
    {
      requestInit: {
        headers: resolveValues(server.headers ?? {}, credentials),
        credentials: server.credentials,
      },
      redirectPolicy: "same-origin",
    },
  );
  await client.connect(transport, {
    timeout: server.timeoutMs ?? 30_000,
  });

  return {
    async listTools(signal) {
      const tools: McpTool[] = [];
      let cursor: string | undefined;
      do {
        const result = await client.listTools(
          cursor ? { cursor } : undefined,
          {
            signal,
            timeout: server.timeoutMs ?? 30_000,
          },
        );
        tools.push(
          ...result.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        );
        cursor = result.nextCursor;
      } while (cursor);
      return tools;
    },
    async callTool(name, arguments_, signal) {
      const result = await client.callTool(
        { name, arguments: arguments_ },
        undefined,
        {
          signal,
          timeout: server.timeoutMs ?? 30_000,
          maxTotalTimeout: server.timeoutMs ?? 30_000,
        },
      );
      return normalizeMcpToolResult(result);
    },
    async close() {
      await client.close();
    },
  };
}

function resolveValues(
  values: Record<string, string>,
  credentials: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key) => {
        const resolved = credentials[key];
        if (resolved === undefined) {
          throw new Error(
            `MCP credential "${key}" required by header "${name}" is not configured.`,
          );
        }
        return resolved;
      }),
    ]),
  );
}

export function normalizeMcpToolResult(
  result: unknown,
): McpToolCallResult {
  if (!isRecord(result)) {
    throw new Error("MCP tool returned an invalid result.");
  }
  if ("toolResult" in result) {
    return normalizeMcpToolResult(result.toolResult);
  }
  if (!("content" in result)) {
    throw new Error("MCP tool result is missing content.");
  }
  return {
    output:
      result.structuredContent === undefined
        ? result.content
        : {
            content: result.content,
            structuredContent: result.structuredContent,
          },
    isError:
      typeof result.isError === "boolean" ? result.isError : undefined,
  };
}

export { resolveValues as resolveMcpConfigurationValues };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
