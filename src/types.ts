export type ProviderName =
  | "anthropic"
  | "bedrock"
  | "deepseek"
  | "openai"
  | "googlegenai"
  | "vertexai"
  | "amarsia";

export interface ApiKeyProviderConfiguration {
  apiKey: string;
  baseUrl?: string;
  project?: never;
  location?: never;
  region?: never;
  credentials?: never;
}

export interface GoogleServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
}

export interface VertexAIProviderConfiguration {
  apiKey?: never;
  baseUrl?: string;
  project: string;
  location: string;
  region?: never;
  credentials?: GoogleServiceAccountCredentials;
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface BedrockProviderConfiguration {
  apiKey?: never;
  baseUrl?: string;
  project?: never;
  location?: never;
  region: string;
  credentials?: AwsCredentials;
}

export type ProviderConfiguration =
  | ApiKeyProviderConfiguration
  | BedrockProviderConfiguration
  | VertexAIProviderConfiguration;

export type ResolvedProviderConfigurations = {
  [Name in ProviderName]?: Name extends "vertexai"
    ? VertexAIProviderConfiguration
    : Name extends "bedrock"
      ? BedrockProviderConfiguration
      : ApiKeyProviderConfiguration;
};

export type ProviderInitConfigurations = {
  [Name in ProviderName]?: Name extends "vertexai"
    ? VertexAIProviderConfiguration
    : Name extends "bedrock"
      ? BedrockProviderConfiguration
      : string | ApiKeyProviderConfiguration;
};

export interface ProjectConfiguration {
  providers: ResolvedProviderConfigurations;
  actions?: LocalActionRuntimeConfiguration;
  storage?: {
    strategy?: "node-jsonl";
    directory?: string;
  };
}

export interface OrchaInitConfiguration {
  providers: ProviderInitConfigurations;
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

export type AgentSkillRegistrations = Record<string, string>;

export interface SkillConfiguration {
  name: string;
  description: string;
  triggers?: string[];
}

export interface CompiledSkillManifest extends SkillConfiguration {
  directoryName: string;
  instructions: string;
}

export type AgentEvaluationRegistrations = Record<string, string>;

export interface EvaluationMetricConfiguration {
  name: string;
  description: string;
  threshold: number;
}

export interface EvaluationConfiguration {
  name: string;
  description?: string;
  enabled?: boolean;
  provider: string;
  model: string;
  maxTokens?: number;
  reasoningLevel?: string;
  metrics: readonly EvaluationMetricConfiguration[];
}

export interface CompiledEvaluationManifest
  extends Omit<EvaluationConfiguration, "provider"> {
  directoryName: string;
  provider: ProviderName;
}

export interface EvaluationMetricResult {
  name: string;
  score: number;
  threshold: number;
  passed: boolean;
  reasoning: string;
  evidence: string[];
}

export interface EvaluationResult {
  name: string;
  status: "passed" | "failed" | "error";
  metrics: EvaluationMetricResult[];
  usage?: Usage;
  durationMs: number;
  error?: {
    message: string;
  };
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
  skills: Record<string, CompiledSkillManifest>;
  evaluations: Record<string, CompiledEvaluationManifest>;
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
  readonly evaluations: Promise<EvaluationResult[]>;
}

export interface ClientToolCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  output: unknown;
  isError?: boolean;
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
  | "skill.requested"
  | "skill.loaded"
  | "skill.failed"
  | "evaluation.requested"
  | "evaluation.completed"
  | "evaluation.failed"
  | "run.paused"
  | "run.completed"
  | "run.failed"
  | "test.completed";

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
  type:
    | "message"
    | "action"
    | "client_action"
    | "skill"
    | "evaluation"
    | "session_completed";
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
  metrics?: EvaluationMetricResult[];
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

export type AgentTestRegistrations = Record<string, string>;

export interface AgentTestActionResponse {
  output: unknown;
  isError?: boolean;
}

export interface AgentTestActionConfiguration {
  responses: AgentTestActionResponse[];
}

export interface AgentTestValueExpectation {
  equals?: unknown;
  partial?: unknown;
}

export interface AgentTestTextExpectation {
  contains?: string[];
  excludes?: string[];
}

export interface AgentTestActionExpectation {
  name: string;
  arguments?: AgentTestValueExpectation;
}

export interface AgentTestExpectation {
  status?: "completed" | "failed";
  output?: AgentTestValueExpectation;
  text?: AgentTestTextExpectation;
  actions?: AgentTestActionExpectation[];
}

export interface AgentTestCaseConfiguration {
  description?: string;
  input: {
    content: string | MessageContent[];
    variables?: Record<string, string>;
    metadata?: SessionMetadata;
  };
  actions: Record<string, AgentTestActionConfiguration>;
  expect: AgentTestExpectation;
}

export interface AgentTestAssertionResult {
  path: string;
  passed: boolean;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface AgentTestCaseReport {
  agent: string;
  name: string;
  description?: string;
  status: "passed" | "failed";
  sessionId?: string;
  sessionPath?: string;
  durationMs: number;
  usage?: Usage;
  evaluations?: EvaluationResult[];
  assertions: AgentTestAssertionResult[];
  error?: RunError;
}

export interface AgentTestReport {
  suiteId: string;
  status: "passed" | "failed";
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  cases: AgentTestCaseReport[];
}

export interface RunTestsOptions {
  agent?: string;
  test?: string;
}
