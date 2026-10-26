import { Client } from "@modelcontextprotocol/sdk/client";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CompiledMcpServerManifest } from "../../types.js";
import type {
  McpClientConnection,
  McpTool,
} from "./client.js";
import {
  createHttpMcpClient,
  normalizeMcpToolResult,
  resolveMcpConfigurationValues,
} from "./http-client.js";

export async function createNodeMcpClient(
  server: CompiledMcpServerManifest,
  configuredCredentials: Record<string, string | undefined>,
): Promise<McpClientConnection> {
  const credentials = {
    ...process.env,
    ...configuredCredentials,
  };
  if (server.transport === "streamable-http") {
    return createHttpMcpClient(server, credentials);
  }

  const client = new Client({
    name: "orchajs",
    version: "1.0.0",
  });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: server.env
      ? {
          ...getDefaultEnvironment(),
          ...resolveMcpConfigurationValues(server.env, credentials),
        }
      : undefined,
    stderr: "inherit",
  });
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
