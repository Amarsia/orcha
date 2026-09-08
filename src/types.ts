export type ProviderName = "anthropic" | "openai" | "googlegenai" | "amarsia";

export interface ProviderConfiguration {
  apiKey: string;
  baseUrl?: string;
}

export interface ProjectConfiguration {
  providers: Partial<Record<ProviderName, ProviderConfiguration>>;
  storage?: {
    strategy?: "node-jsonl";
    directory?: string;
  };
}

export interface OrchaInitConfiguration {
  providers: Partial<Record<ProviderName, string | ProviderConfiguration>>;
  agents: Record<string, string>;
  storage?: ProjectConfiguration["storage"];
  root?: string;
}

export interface AgentConfiguration {
  provider: string;
  model: string;
  region?: string;
  maxTokens?: number;
  reasoningLevel?: "disabled" | "low" | "medium" | "high";
  outputType?: "text" | "json" | "image" | "audio";
  outputSchema?: Record<string, unknown>;
}

export interface CompiledAgentManifest
  extends Omit<AgentConfiguration, "provider"> {
  name: string;
  provider: ProviderName;
  systemPrompt: string;
}

export interface CompiledBundle {
  schemaVersion: 1;
  agents: Record<string, CompiledAgentManifest>;
}

export interface AgentInput {
  input: string;
  sessionId?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface RunResult<TOutput = unknown> {
  sessionId: string;
  status: "completed" | "failed";
  output?: TOutput;
  usage?: Usage;
  error?: {
    code: string;
    message: string;
  };
}

export interface Execution<TOutput = unknown> {
  readonly result: Promise<RunResult<TOutput>>;
}

export type SessionEventType =
  | "session.created"
  | "run.started"
  | "message.created"
  | "run.completed"
  | "run.failed";

export interface SessionEvent<TData = Record<string, unknown>> {
  sequence: number;
  type: SessionEventType;
  timestamp: string;
  run?: number;
  data: TData;
}

export interface SessionStore {
  read(sessionId: string): Promise<SessionEvent[]>;
  append(sessionId: string, events: SessionEvent[]): Promise<void>;
}

export interface AgentRuntime {
  run(input: AgentInput | string): Execution;
}
