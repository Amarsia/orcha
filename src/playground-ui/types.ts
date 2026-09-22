export interface AgentSummary {
  key: string;
  name: string;
  description?: string;
  provider: string;
  model: string;
  actionCount: number;
  skillCount: number;
  evaluationCount: number;
  subagentCount: number;
}

export interface SourceItem {
  key: string;
  name: string;
  description?: string;
  configuration: Record<string, unknown>;
  rawConfiguration: string;
  instructions?: string;
  source?: string;
}

export interface AgentSource extends AgentSummary {
  configuration: Record<string, unknown>;
  rawConfiguration: string;
  instructions: string;
  actions: SourceItem[];
  skills: SourceItem[];
  evaluations: SourceItem[];
  subagents: Array<{
    key: string;
    name: string;
    description?: string;
  }>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface SessionSnapshot {
  sessionId: string;
  agent: string;
  name?: string;
  status: "active" | "paused" | "completed";
  runStatus?: string;
  createdAt: string;
  updatedAt: string;
  usage?: Usage;
  pendingClientActions: ClientToolCall[];
}

export interface ClientToolCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface SessionEvent {
  sequence: number;
  type: string;
  timestamp: string;
  run?: number;
  data: Record<string, unknown>;
}

export interface AgentTest {
  agent: string;
  name: string;
  description?: string;
  warnings?: TestWarning[];
  configuration: Record<string, unknown>;
  rawConfiguration: string;
}

export interface TestWarning {
  code: "live_actions";
  message: string;
  actions: string[];
}

export interface TestCaseReport {
  agent: string;
  name: string;
  status: "passed" | "failed";
  sessionId?: string;
  sessionPath?: string;
  durationMs: number;
  warnings?: TestWarning[];
  assertions: Array<{
    path: string;
    passed: boolean;
    message: string;
  }>;
}

export interface TestReport {
  status: "passed" | "failed";
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  cases: TestCaseReport[];
}

export interface TranscriptTab {
  id: string;
  agent: string;
  sessionId: string;
  label: string;
  kind: "parent" | "subagent";
  parentSessionId?: string;
  parentAgent?: string;
}
