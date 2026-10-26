import type {
  CompiledMcpServerManifest,
  ProjectConfiguration,
} from "../../types.js";
import type { ProviderToolDefinition } from "../../providers/types.js";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  output: unknown;
  isError?: boolean;
}

export interface McpClientConnection {
  listTools(signal?: AbortSignal): Promise<McpTool[]>;
  callTool(
    name: string,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolCallResult>;
  close(): Promise<void>;
}

type McpClientFactory = (
  server: CompiledMcpServerManifest,
  credentials: Record<string, string | undefined>,
) => Promise<McpClientConnection>;

let loadMcpClient: McpClientFactory = async () => {
  throw new Error(
    'MCP support requires the optional "@modelcontextprotocol/sdk" package.',
  );
};

/** @internal Supplies the platform-specific MCP client implementation. */
export function setMcpClientFactory(factory: McpClientFactory): void {
  loadMcpClient = factory;
}

export interface AvailableMcpTool extends ProviderToolDefinition {
  serverKey: string;
  remoteName: string;
}

export class McpClientPool {
  readonly #servers: Record<string, CompiledMcpServerManifest>;
  readonly #credentials: Record<string, string | undefined>;
  readonly #connections = new Map<
    string,
    Promise<McpClientConnection>
  >();
  #tools: Promise<AvailableMcpTool[]> | undefined;

  constructor(
    servers: Record<string, CompiledMcpServerManifest>,
    configuration: ProjectConfiguration["mcp"],
  ) {
    this.#servers = servers;
    this.#credentials = configuration?.credentials ?? {};
  }

  tools(signal?: AbortSignal): Promise<AvailableMcpTool[]> {
    if (!this.#tools) {
      this.#tools = this.#loadTools(signal).catch((error) => {
        this.#tools = undefined;
        throw error;
      });
    }
    return this.#tools;
  }

  async callTool(
    modelName: string,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolCallResult> {
    const tool = (await this.tools(signal)).find(
      (candidate) => candidate.name === modelName,
    );
    if (!tool) {
      throw new Error(`Unknown MCP tool "${modelName}".`);
    }
    const connection = await this.#connection(tool.serverKey);
    const result = await connection.callTool(
      tool.remoteName,
      arguments_,
      signal,
    );
    const serialized = JSON.stringify(result.output);
    if (serialized === undefined) {
      throw new Error(`MCP tool "${modelName}" returned non-JSON output.`);
    }
    const limit =
      this.#servers[tool.serverKey]?.maxOutputBytes ?? 1_000_000;
    if (new TextEncoder().encode(serialized).byteLength > limit) {
      throw new Error(
        `MCP tool "${modelName}" output exceeded ${limit} bytes.`,
      );
    }
    return {
      output: JSON.parse(serialized),
      isError: result.isError,
    };
  }

  async close(): Promise<void> {
    const connections = await Promise.allSettled(
      this.#connections.values(),
    );
    await Promise.allSettled(
      connections.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.close()] : [],
      ),
    );
    this.#connections.clear();
    this.#tools = undefined;
  }

  async #loadTools(
    signal?: AbortSignal,
  ): Promise<AvailableMcpTool[]> {
    const discovered = await Promise.all(
      Object.keys(this.#servers).map(async (serverKey) => {
        const connection = await this.#connection(serverKey);
        const tools = await connection.listTools(signal);
        return tools.map((tool) => ({
          name: modelToolName(serverKey, tool.name),
          description:
            tool.description ??
            `Run "${tool.name}" on the "${serverKey}" MCP server.`,
          parameters: tool.inputSchema,
          serverKey,
          remoteName: tool.name,
        }));
      }),
    );
    const tools = discovered.flat();
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name)) {
        throw new Error(`Duplicate MCP tool name "${tool.name}".`);
      }
      names.add(tool.name);
    }
    return tools;
  }

  #connection(serverKey: string): Promise<McpClientConnection> {
    const existing = this.#connections.get(serverKey);
    if (existing) {
      return existing;
    }
    const server = this.#servers[serverKey];
    if (!server) {
      throw new Error(`Unknown MCP server "${serverKey}".`);
    }
    const connection = loadMcpClient(server, this.#credentials).catch(
      (error) => {
        this.#connections.delete(serverKey);
        throw error;
      },
    );
    this.#connections.set(serverKey, connection);
    return connection;
  }
}

function modelToolName(serverKey: string, remoteName: string): string {
  const normalized = `${serverKey}__${remoteName}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  if (normalized.length <= 64) {
    return normalized;
  }
  return `${normalized.slice(0, 55)}_${stableHash(normalized)}`;
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
