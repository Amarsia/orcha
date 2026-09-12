export type ProviderName =
  | "anthropic"
  | "deepseek"
  | "openai"
  | "googlegenai"
  | "amarsia";

export interface ProviderConfiguration {
  apiKey: string;
  baseUrl?: string;
}

export interface ProjectConfiguration {
  providers: Partial<Record<ProviderName, ProviderConfiguration>>;
  actions?: LocalActionRuntimeConfiguration;
  storage?: {
    strategy?: "node-jsonl";
    directory?: string;
  };
}

export interface OrchaInitConfiguration {
  providers: Partial<Record<ProviderName, string | ProviderConfiguration>>;
  agents: Record<string, string>;
  actions?: LocalActionRuntimeConfiguration;
  storage?: ProjectConfiguration["storage"];
  root?: string;
}

export interface AgentConfiguration {
  provider: string;
  model: string;
  region?: string;
  maxTokens?: number;
  reasoningLevel?: string;
  outputType?: "text" | "json" | "image" | "audio";
  outputSchema?: Record<string, unknown>;
}

export interface ActionConfiguration {
  name: string;
  description: string;
  execution: "client" | "local";
  parameters: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  permissions?: {
    env?: string[];
    network?: string[];
  };
  timeoutMs?: number;
  sideEffect?: boolean;
}

export interface CompiledActionManifest extends ActionConfiguration {
  directoryName: string;
  source?: string;
  sourceHash?: string;
}

export interface LocalActionRuntimeConfiguration {
  runtime: "native" | "sandbox";
  env?: Record<string, string | undefined>;
  sandbox?: {
    memoryLimitMb?: number;
    stackLimitKb?: number;
  };
}

export interface CompiledAgentManifest
  extends Omit<AgentConfiguration, "provider"> {
  name: string;
  provider: ProviderName;
  systemPrompt: string;
  actions: Record<string, CompiledActionManifest>;
}

export interface CompiledBundle {
  schemaVersion: 1;
  actionRuntime?: "native" | "sandbox";
  agents: Record<string, CompiledAgentManifest>;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface FileContent {
  type: "image" | "video" | "audio" | "url";
  mimeType: string;
  fileUri: string;
}

export type MessageContent = TextContent | FileContent;
export type MetadataValue = string | number | boolean | null;
export type SessionMetadata = Record<string, MetadataValue>;
export type ClientCapability =
  | string
  | Pick<CompiledActionManifest, "name">;

export interface AgentInput {
  content: string | MessageContent[];
  name?: string;
  metadata?: SessionMetadata;
  variables?: Record<string, string>;
  clientCapabilities?: ClientCapability[];
}

export interface AgentContinueInput {
  content: string | MessageContent[];
  clientCapabilities?: ClientCapability[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type OrchaErrorCode =
  | "invalid_input"
  | "unsupported_content_type"
  | "unsupported_provider_capability"
  | "session_not_found"
  | "session_busy"
  | "client_action_required"
  | "missing_tool_results"
  | "unknown_call_id"
  | "invalid_tool_result"
  | "action_result_conflict"
  | "session_completed"
  | "provider_error"
  | "storage_error"
  | "aborted"
  | "execution_failed";

export interface RunError {
  code: OrchaErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface CompletedRunResult<TOutput = unknown> {
  sessionId: string;
  status: "completed";
  output: TOutput;
  usage?: Usage;
}

export interface WaitingRunResult<TOutput = unknown> {
  sessionId: string;
  status: "waiting_for_client_action";
  output?: TOutput;
  usage?: Usage;
  clientToolCalls: ClientToolCall[];
}

export interface FailedRunResult {
  sessionId: string;
  status: "failed";
  error: RunError;
}

export type RunResult<TOutput = unknown> =
  | CompletedRunResult<TOutput>
  | WaitingRunResult<TOutput>
  | FailedRunResult;

export interface StreamingRunSnapshot<TOutput = unknown> {
  sessionId: string;
  status: "streaming";
  output: TOutput;
}

export type ExecutionSnapshot<TOutput = unknown> =
  | StreamingRunSnapshot<TOutput>
  | RunResult<TOutput>;

export interface Execution<TOutput = unknown> {
  readonly stream: ReadableStream<ExecutionSnapshot<TOutput>>;
  readonly snapshot: ExecutionSnapshot<TOutput> | undefined;
  readonly result: Promise<RunResult<TOutput>>;
}

export interface ClientToolCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  output: unknown;
}

export interface ToolResumeInput {
  toolResults: ToolResult[];
}

export type ResumeInput =
  | string
  | AgentContinueInput
  | ToolResumeInput;

export type SessionEventType =
  | "session.created"
  | "session.updated"
  | "run.started"
  | "message.created"
  | "action.requested"
  | "action.completed"
  | "action.failed"
  | "client_action.requested"
  | "client_action.resolved"
  | "run.paused"
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
  listSessionIds(): Promise<string[]>;
}

export type SessionStatus = "active" | "completed";
export type RunStatus =
  | "running"
  | "waiting_for_client_action"
  | "completed"
  | "failed";

export interface SessionSnapshot {
  sessionId: string;
  name?: string;
  status: SessionStatus;
  metadata: SessionMetadata;
  createdAt: string;
  updatedAt: string;
  runStatus?: RunStatus;
  pendingClientActions: ClientToolCall[];
  lastOutput?: unknown;
  usage?: Usage;
}

export interface SessionHistoryItem {
  id: string;
  type: "message" | "action" | "client_action" | "session_completed";
  createdAt: string;
  role?: "user" | "assistant";
  content?: MessageContent[];
  name?: string;
  status?: "waiting" | "completed" | "failed";
  summary?: string;
  callId?: string;
  arguments?: Record<string, unknown>;
  durationMs?: number;
  usage?: Usage;
}

export interface SessionHistory extends SessionSnapshot {
  items: SessionHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface PaginationOptions {
  page?: number;
  pageSize?: number;
}

export interface SessionListOptions extends PaginationOptions {
  status?: SessionStatus;
  metadata?: SessionMetadata;
}

export interface SessionList {
  items: SessionSnapshot[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface SessionUpdate {
  name?: string;
  metadata?: SessionMetadata;
}

export interface AgentRuntime {
  readonly clientTools: CompiledActionManifest[];
  run(input: AgentInput | string): Execution;
  resume(sessionId: string, input: ResumeInput): Execution;
  get(sessionId: string): Promise<SessionSnapshot>;
  history(
    sessionId: string,
    options?: PaginationOptions,
  ): Promise<SessionHistory>;
  list(options?: SessionListOptions): Promise<SessionList>;
  update(
    sessionId: string,
    update: SessionUpdate,
  ): Promise<SessionSnapshot>;
}
