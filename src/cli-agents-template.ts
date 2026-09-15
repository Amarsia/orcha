export const AGENTS_MD = `# Orcha project guide

This repository uses OrchaJS, a filesystem-convention framework for durable
AI agents. Treat the \`orcha/\` directory as source code. Do not edit generated
files under \`.orcha/\`.

## Commands

- \`orcha init\` creates the initial Orcha files without overwriting files.
- \`orcha dev\` validates the registry and watches \`orcha/**\` for changes.
- \`orcha run <agent> --input "…"\` executes one registered agent.
- \`orcha run <agent> --input-file request.json\` accepts structured input.
- \`orcha run <agent> --session <id> --input "…"\` continues a session.
- \`orcha run <agent> --session <id> --tool-results results.json\` submits
  pending client-action results.
- \`orcha test\` runs every registered agent test.
- \`orcha test <agent>\` or \`orcha test <agent>/<case>\` narrows the run.
- \`orcha build\` creates the production Orcha bundle without calling models.
- Add \`--json\` to \`run\` and \`test\` for machine-readable output.

\`run\` and \`test\` use real providers and require credentials. \`dev\` and
\`build\` are offline. Session logs are JSONL files under
\`.orcha/sessions/<sessionId>.jsonl\`.

## Registry

\`orcha/index.ts\` initializes providers and explicitly registers agents:

\`\`\`ts
import { orcha } from "orchajs";

orcha.init({
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
    openai: process.env.OPENAI_API_KEY ?? "",
  },
  actions: { runtime: "sandbox" },
  agents: {
    supportBot: "./supportBot",
  },
});
\`\`\`

Only registered folders are compiled. Agent keys become runtime properties
such as \`orcha.supportBot\`. Use \`actions.runtime: "sandbox"\` for isolated
local action execution or \`"native"\` when the application intentionally
allows action modules to execute in its Node.js process.

\`orcha.init()\` fields:

- \`providers\` (required): provider configurations keyed by built-in provider
  name.
- \`agents\` (required): runtime property names mapped to folders relative to
  \`orcha/\`. At least one agent is required.
- \`actions\` (required only when a registered agent has local actions):
  selects the local execution runtime and its environment/sandbox settings.
- \`storage.strategy\` (optional): currently only \`"node-jsonl"\`.
- \`storage.directory\` (optional): session directory relative to project
  root; defaults to \`.orcha/sessions\`.
- \`root\` (optional): absolute or working-directory-relative project root;
  defaults to \`ORCHA_PROJECT_ROOT\` and then \`process.cwd()\`.

Provider configuration shapes:

\`\`\`ts
providers: {
  anthropic: process.env.ANTHROPIC_API_KEY ?? "",
  deepseek: process.env.DEEPSEEK_API_KEY ?? "",
  googlegenai: process.env.GOOGLE_API_KEY ?? "",
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseUrl: "https://api.openai.com/v1", // optional override
  },
  vertexai: {
    project: process.env.GOOGLE_CLOUD_PROJECT ?? "",
    location: process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1",
    // credentials is optional; omit it to use Google ADC.
    credentials: {
      clientEmail: process.env.GOOGLE_CLIENT_EMAIL ?? "",
      privateKey: process.env.GOOGLE_PRIVATE_KEY ?? "",
    },
    baseUrl: undefined, // optional override
  },
  bedrock: {
    region: process.env.AWS_REGION ?? "us-east-1",
    // credentials is optional; omit it to use the AWS credential chain.
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
      sessionToken: process.env.AWS_SESSION_TOKEN,
    },
    baseUrl: undefined, // optional override
  },
}
\`\`\`

API-key providers accept either a string shorthand or
\`{ apiKey, baseUrl? }\`. Vertex AI requires \`project\` and \`location\`;
explicit service-account credentials are optional. Bedrock requires \`region\`;
explicit AWS credentials are optional. Never place credentials in
\`index.json\`, instructions, tests, session metadata, or committed files.

## Agent folders

\`\`\`text
orcha/
  index.ts
  supportBot/
    index.json
    instructions.md
    actions/
    skills/
    tests/
    evaluations/
\`\`\`

\`index.json\` selects the model:

\`\`\`json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "region": "provider_managed",
  "maxTokens": 10240,
  "outputType": "text"
}
\`\`\`

Optional fields include \`reasoningLevel\`, \`outputType: "json"\`, and an
\`outputSchema\` JSON Schema. Provider-specific reasoning values are forwarded
without translation. Put the agent's stable role, boundaries, and operating
instructions in \`instructions.md\`.

Agent \`index.json\` fields:

- \`provider\` (required): \`"anthropic"\`, \`"bedrock"\`, \`"deepseek"\`,
  \`"openai"\`, \`"googlegenai"\`, or \`"vertexai"\`.
- \`model\` (required): exact provider model identifier.
- \`region\` (optional): provider/model routing hint; defaults in durable
  metadata to \`"provider_managed"\`.
- \`maxTokens\` (optional): positive integer. If omitted, the provider adapter
  chooses its default.
- \`reasoningLevel\` (optional): non-empty provider-native string. Orcha does
  not translate values between providers.
- \`outputType\` (optional): \`"text"\` (default) or \`"json"\`. Image and
  audio are reserved but not implemented.
- \`outputSchema\` (required for JSON output): JSON Schema used for provider
  structured output and final validation.

\`instructions.md\` is required and cannot be empty. At compile time it becomes
the base system prompt. Orcha appends the compact available-skill catalog and
the full instructions for skills already loaded in this durable session.

## Core execution model

An **agent** is the compiled definition: model settings, instructions, actions,
skills, and evaluations. An agent can create many independent sessions.

A **session** is one durable conversation owned by one agent. It has one
\`sessionId\`, optional name and metadata, fixed prompt variables, and one
append-only JSONL timeline. Completing one response does not close the
session—the application can resume it later. A session cannot be transferred
to another registered agent, but later runs may use a different provider or
model if that same agent's configuration changes.

A **run** is one attempt to advance a session. \`run()\` creates a session and
its first run. A conversational \`resume(sessionId, { content })\` creates the
next numbered run in that session. Each run accumulates its own model usage and
ends in exactly one of these states:

- \`completed\`: the model produced final output.
- \`waiting_for_client_action\`: the model requested work that only the
  application can perform. The run is paused, not completed.
- \`failed\`: validation, provider, storage, or execution failed. The durable
  events remain available for diagnosis.

An **execution** is the in-process handle returned by one call to \`run()\` or
\`resume()\`. It exposes a cumulative output stream, latest snapshot, final
result promise, and evaluation promise. An execution ends when that invocation
completes, pauses, or fails; the durable session may continue through another
execution.

A **model round** is one provider request inside a run. One run may contain
several rounds:

\`\`\`text
user input
  → model round
  → tool calls
  → tool results
  → another model round
  → final answer
\`\`\`

Local actions and skill loads are handled automatically inside the same
execution. Their results are sent back to the model and the model loop
continues without application involvement.

A **client action** deliberately crosses the application boundary. Orcha can
describe the tool to the model but cannot execute it because the operation
belongs to a browser, mobile app, approval system, or other caller-owned
environment. The complete pause/continue flow is:

\`\`\`text
1. Application calls agent.run(...) or agent.resume(...content).
2. Model requests one or more client actions.
3. Orcha stores client_action.requested and run.paused.
4. execution.result resolves with:
   {
     status: "waiting_for_client_action",
     sessionId,
     clientToolCalls: [{ callId, name, arguments }]
   }
5. Application executes every requested action.
6. Application calls agent.resume(sessionId, {
     toolResults: [{ callId, output, isError? }]
   }).
7. Orcha validates every callId and output, stores the results, and continues
   the same paused run from its prior model context.
8. The resumed execution either completes, requests more client actions, or
   fails.
\`\`\`

Every pending call must be resolved exactly once in one resume operation.
\`callId\` links the submitted result to the model's request; the action name
must not be substituted for it. Re-submitting the identical resolved result is
idempotent and returns the prior completed result. Submitting different data
for an already-resolved call fails with \`action_result_conflict\`.

\`clientCapabilities\` is supplied per invocation because different callers
may support different client actions. Orcha exposes only declared client
actions to that model round. Local actions are always available when compiled.

Only one execution may mutate a session at a time. Concurrent calls for the
same \`sessionId\` return \`session_busy\`; different sessions can run
independently.

## Running and resuming

\`\`\`ts
const execution = orcha.supportBot.run({
  content: "Check subscription sub_123.",
  name: "Subscription check",
  metadata: { accountId: "acct_123" },
  clientCapabilities: ["request_human_approval"],
});

for await (const snapshot of execution.stream) {
  console.log(snapshot);
}

const result = await execution.result;
const evaluations = await execution.evaluations;
\`\`\`

\`run()\` input fields:

- \`content\` (required): a non-empty string or array of text/file blocks.
  File blocks contain \`type\`, \`mimeType\`, and \`fileUri\`; unsupported
  provider/content combinations fail explicitly.
- \`name\` (optional): trimmed session label from 1 through 200 characters.
- \`metadata\` (optional): at most 50 fields with non-empty keys and finite
  string, number, boolean, or null values. Metadata is durable and available
  to local action context; never place secrets in it.
- \`variables\` (optional): at most 50 string values whose keys are JavaScript
  identifiers. They replace \`{{ variableName }}\` placeholders in
  \`instructions.md\`, are fixed when the session is created, and are reused
  by later resumes. A missing referenced variable fails the run.
- \`clientCapabilities\` (optional): action names the current caller can
  execute. Client actions not declared here are withheld from the model.

\`run()\` always creates a new durable session. Continue one with:

\`\`\`ts
const execution = orcha.supportBot.resume(sessionId, {
  content: "Continue with the confirmed account.",
});
\`\`\`

If a result has \`status: "waiting_for_client_action"\`, execute the requested
client actions in the application and submit every result:

\`\`\`ts
orcha.supportBot.resume(sessionId, {
  toolResults: [
    { callId: "call_123", output: { approved: true } }
  ],
});
\`\`\`

Never invent call IDs. Use the IDs returned in \`clientToolCalls\`.

## Actions

Each action has metadata and, for local actions, executable code:

\`\`\`text
actions/
  lookupAccount/
    index.json
    index.js
\`\`\`

\`\`\`json
{
  "name": "lookup_account",
  "description": "Look up one account.",
  "execution": "local",
  "parameters": {
    "type": "object",
    "properties": {
      "accountId": { "type": "string" }
    },
    "required": ["accountId"],
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "status": { "type": "string" }
    },
    "required": ["status"],
    "additionalProperties": false
  }
}
\`\`\`

\`\`\`js
export default async function lookupAccount({ accountId }) {
  return { status: "active" };
}
\`\`\`

Client actions use \`"execution": "client"\` and do not include executable
code. Orcha pauses until the caller submits their results. Keep action names,
descriptions, schemas, and implementations aligned.

Action \`index.json\` fields:

- \`name\` (required): model-facing tool name, 1–64 letters, numbers,
  underscores, or hyphens. \`load_skill\` is reserved.
- \`description\` (required): tells the model when and why to call the action.
- \`execution\` (required): \`"local"\` executes \`index.js\`; \`"client"\`
  pauses the run and delegates execution to the application.
- \`parameters\` (required): JSON Schema for model-generated arguments.
- \`outputSchema\` (optional): JSON Schema validated against local or submitted
  client output before the model receives it.
- \`timeoutMs\` (optional): integer from 1 through 120000; defaults to 10000.
- \`permissions.env\` (optional): names copied from \`orcha.init().actions.env\`
  into the action context.
- \`permissions.network\` (optional): exact hosts or wildcard subdomains such
  as \`"api.example.com"\` or \`"*.example.com"\` allowed through
  \`context.fetch\`. Redirects are rejected.
- \`sideEffect\` (optional): descriptive metadata for whether the operation
  mutates external state. It does not currently change execution behavior.

\`orcha.init().actions.runtime\` and an action's \`execution\` solve different
problems:

- \`execution: "client"\`: Orcha never executes code for this action.
- \`execution: "local"\` + \`runtime: "sandbox"\`: compiled code runs in a
  QuickJS isolate with JSON-only inputs/outputs, default 32 MB memory, default
  512 KB stack, interruptible timeout, declared environment values, and
  allowlisted network access through the provided context.
- \`execution: "local"\` + \`runtime: "native"\`: code runs in the host Node.js
  process. It can use host privileges directly. The timeout rejects slow
  asynchronous work but cannot interrupt synchronous blocking code.

Global local-action configuration:

\`\`\`ts
actions: {
  runtime: "sandbox", // required when any registered action is local
  env: {
    BILLING_API_TOKEN: process.env.BILLING_API_TOKEN,
  },
  sandbox: {
    memoryLimitMb: 32,
    stackLimitKb: 512,
  },
}
\`\`\`

The local action signature is
\`(parameters, context) => output | Promise<output>\`. Context contains
\`sessionId\`, immutable session \`metadata\`, a stable \`idempotencyKey\`,
allowlisted \`env\`, guarded \`fetch\`, and prefixed \`log\`.

## Skills

Skills are lazy-loaded procedural instructions. Register only intended skills:

\`\`\`js
// skills/index.js
import { defineSkills } from "orchajs/skills";

export default defineSkills({
  incidentTriage: "./incidentTriage",
});
\`\`\`

Each skill folder contains \`index.json\` metadata and \`instructions.md\`.
The model receives a compact catalog and can call the internal \`load_skill\`
tool. Loaded instructions remain active for the durable session. Lifecycle
events are \`skill.requested\`, \`skill.loaded\`, and \`skill.failed\`.

Skill \`index.json\` fields:

- \`name\` (required): model-facing name, 1–64 letters, numbers, underscores,
  or hyphens; unique within the agent.
- \`description\` (required): compact catalog description shown before loading.
- \`triggers\` (optional): non-empty array of non-empty situations describing
  when the model should load the skill.

\`instructions.md\` is required and cannot be empty. The key in
\`skills/index.js\` is only a registration label; \`index.json.name\` is the
name used by the model and durable events. Unregistered folders are ignored.

## Tests

Register tests in \`tests/index.js\`:

\`\`\`js
import { defineTests } from "orchajs/testing";

export default defineTests({
  activeAccount: "./activeAccount",
});
\`\`\`

Each case's \`index.json\` defines \`input\`, mocked responses for every action,
and \`expect\`. Tests run the real compiled agent and provider but never execute
real actions. The mocked action set must exactly match the compiled action set.

\`\`\`json
{
  "input": { "content": "Check account acct_123." },
  "actions": {
    "lookup_account": {
      "responses": [
        { "output": { "status": "active" } }
      ]
    }
  },
  "expect": {
    "status": "completed",
    "text": { "contains": ["active"] },
    "actions": [
      {
        "name": "lookup_account",
        "arguments": { "equals": { "accountId": "acct_123" } }
      }
    ]
  }
}
\`\`\`

Test sessions use the \`ses_test_\` prefix and end with a \`test.completed\`
event. Prefer semantic output assertions; verify exact identifiers and values
through action-argument assertions.

Test \`index.json\` fields:

- \`description\` (optional): human-readable purpose.
- \`input.content\` (required): string or multimodal content array.
- \`input.variables\` (optional): string map available to the session.
- \`input.metadata\` (optional): string, number, boolean, or null values.
- \`actions\` (required): exactly one key for every compiled action, including
  local actions. Every \`responses\` array is consumed in call order.
- \`responses[].output\` (required): mocked action result.
- \`responses[].isError\` (optional): marks the mocked result as an error.
- \`expect.status\` (optional): \`"completed"\` or \`"failed"\`; defaults to
  \`"completed"\`.
- \`expect.output.equals\` / \`partial\` (optional): exact or recursive partial
  comparison against structured output.
- \`expect.text.contains\` / \`excludes\` (optional): case-sensitive semantic
  text checks.
- \`expect.actions\` (optional): ordered expected calls. Each may assert
  \`arguments.equals\` or \`arguments.partial\`.

The registration key in \`tests/index.js\` is the test selector used by
\`orcha test agent/testName\`; its value resolves to the case folder.

## Evaluations

Evaluations are asynchronous LLM judges registered in
\`evaluations/index.js\` with \`defineEvaluations\` from
\`orchajs/evaluations\`. Each folder's \`index.json\` defines its provider,
model, metrics, and thresholds:

\`\`\`json
{
  "name": "response_quality",
  "description": "Grounding of agent responses.",
  "instructions": "Judge the complete response using only confirmed evidence recorded in the session.",
  "enabled": true,
  "provider": "openai",
  "model": "gpt-5-mini",
  "metrics": [
    {
      "name": "groundedness",
      "description": "The answer relies on confirmed session evidence.",
      "threshold": 0.8
    }
  ]
}
\`\`\`

\`execution.result\` does not wait for judges. Await
\`execution.evaluations\` when results must finish before process exit.
Evaluations always finish during \`orcha test\`; judge errors and missed
thresholds fail the test. Lifecycle events are \`evaluation.requested\`,
\`evaluation.completed\`, and \`evaluation.failed\`.

Evaluation \`index.json\` fields:

- \`name\` (required): durable model-facing identifier, 1–64 letters, numbers,
  underscores, or hyphens; unique within the agent.
- \`description\` (optional): short human-facing summary of the evaluator.
- \`instructions\` (optional): detailed prompt supplied to the judge. When
  omitted, \`description\` is used for backward compatibility.
- \`enabled\` (optional): defaults to \`true\`. Disabled evaluations are
  compiled but do not run.
- \`provider\` and \`model\` (required): independently select the judge. The
  provider must also exist in \`orcha.init().providers\`.
- \`maxTokens\` (optional): positive integer; defaults to 2000 for judges.
- \`reasoningLevel\` (optional): non-empty provider-native string forwarded
  without translation.
- \`metrics\` (required): non-empty array with unique metric names.
- \`metrics[].name\`: 1–64 letters, numbers, underscores, or hyphens.
- \`metrics[].description\`: exact criterion supplied to the judge.
- \`metrics[].threshold\`: inclusive number from 0 to 1. A metric passes when
  the returned score is greater than or equal to this threshold.

The judge sees a sanitized transcript of user/assistant messages, action
requests and outcomes, client-action activity, and loaded skill names. It does
not receive internal reasoning blocks, replay metadata, previous evaluation
results, or test assertions. It must return exactly one score, reasoning
string, and non-empty evidence array for every configured metric.

## Sessions and logs

JSONL is the durable source of truth. Each line is one complete JSON object;
never treat the file as one JSON array. Events are append-only and ordered by
\`sequence\`.

All events use this envelope:

\`\`\`ts
type SessionEvent<T> = {
  sequence: number;       // starts at 1 and increases across the whole session
  type: SessionEventType;
  timestamp: string;      // ISO-8601 UTC timestamp
  run?: number;           // present for run-scoped events
  data: T;
};
\`\`\`

Session-scoped events omit \`run\`. Optional properties whose values are
\`undefined\` are omitted from serialized JSON.

Shared stored structures:

\`\`\`ts
type Usage = {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

type ErrorData = {
  code: string;
  message: string;
  retryable?: boolean;
};

type UserContent =
  | { type: "text"; text: string }
  | {
      type: "image" | "video" | "audio" | "url";
      mimeType: string;
      fileUri: string;
    };

type AssistantContent =
  | { type: "text"; text: string }
  | {
      type: "reasoning";
      text: string;
      replay?: { providerId?: string; opaqueData?: string };
    }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      arguments: Record<string, unknown>;
      replay?: { providerId?: string; opaqueData?: string };
    };

type ToolResult = {
  callId: string;
  output: unknown;
  isError?: boolean;
};
\`\`\`

Exact event payloads:

\`\`\`ts
type SessionCreated = SessionEvent<{
  schemaVersion: 1;
  sessionId: string;
  agent: string;
  status: "active";
  name?: string;
  metadata: Record<string, string | number | boolean | null>;
  variables: Record<string, string>;
}>; // type "session.created", no run

type SessionUpdated = SessionEvent<{
  name?: string;
  metadata?: Record<string, string | number | boolean | null>;
}>; // type "session.updated", no run

type RunStarted = SessionEvent<{
  status: "running";
  agent: string;
  provider: string;
  model: string;
  region: string;
  reasoningLevel?: string;
  outputType: "text" | "json";
  clientCapabilities: string[];
}>; // type "run.started"

type UserMessageCreated = SessionEvent<{
  role: "user";
  content: UserContent[];
}>; // type "message.created"

type AssistantMessageCreated = SessionEvent<{
  status: "completed" | "incomplete";
  provider: string;
  model: string;
  responseId?: string;
  stopReason?: "end_turn" | "tool_call" | "max_tokens" |
    "content_filter" | "unknown";
  role: "assistant";
  content: AssistantContent[];
  parsedOutput?: unknown; // final JSON output only
  usage: Usage;
  durationMs: number;
}>; // type "message.created"

type ToolMessageCreated = SessionEvent<{
  role: "tool";
  content: ToolResult[];
}>; // type "message.created"

type ActionRequested = SessionEvent<{
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  sourceHash?: string;
  idempotencyKey: string; // sessionId:callId
}>; // type "action.requested"

type ActionCompleted = SessionEvent<{
  callId: string;
  name: string;
  output: unknown;
  sourceHash?: string;
  durationMs: number;
}>; // type "action.completed"

type ActionFailed = SessionEvent<{
  callId: string;
  name: string;
  sourceHash?: string;
  durationMs: number;
  error: {
    code: "action_execution_failed";
    message: string;
  };
}>; // type "action.failed"

type ClientActionRequested = SessionEvent<{
  status: "waiting";
  calls: Array<{
    callId: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  localResults: ToolResult[];
  toolCallOrder: string[];
}>; // type "client_action.requested"

type ClientActionResolved = SessionEvent<{
  status: "completed";
  results: ToolResult[];
}>; // type "client_action.resolved"

type SkillRequested = SessionEvent<{
  callId: string;
  name: unknown;
}>; // type "skill.requested"

type SkillLoaded = SessionEvent<{
  callId: string;
  name: string;
  alreadyLoaded: boolean;
}>; // type "skill.loaded", no run

type SkillFailed = SessionEvent<{
  callId: string;
  name: unknown;
  error: {
    code: "skill_not_found";
    message: string;
  };
}>; // type "skill.failed"

type EvaluationRequested = SessionEvent<{
  name: string;
  provider: string;
  model: string;
  evaluatedThroughSequence: number;
}>; // type "evaluation.requested"

type EvaluationMetric = {
  name: string;
  score: number;
  threshold: number;
  passed: boolean;
  reasoning: string;
  evidence: string[];
};

type EvaluationCompleted = SessionEvent<{
  name: string;
  status: "passed" | "failed";
  metrics: EvaluationMetric[];
  usage?: Usage;
  durationMs: number;
  provider: string;
  model: string;
  evaluatedThroughSequence: number;
}>; // type "evaluation.completed"

type EvaluationFailed = SessionEvent<{
  name: string;
  status: "error";
  metrics: [];
  durationMs: number;
  error: { message: string };
  provider: string;
  model: string;
  evaluatedThroughSequence: number;
}>; // type "evaluation.failed"

type RunPaused = SessionEvent<{
  status: "waiting_for_client_action";
  clientToolCalls: Array<{
    callId: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: Usage;
}>; // type "run.paused"

type RunCompleted = SessionEvent<{
  status: "completed";
  durationMs: number;
  usage: Usage;
}>; // type "run.completed"

type RunFailed = SessionEvent<{
  status: "failed";
  durationMs: number;
  usage?: Usage;
  error: ErrorData;
}>; // type "run.failed"

type TestCompleted = SessionEvent<{
  suiteId: string;
  agent: string;
  test: string;
  status: "passed" | "failed";
  durationMs: number;
  assertions: Array<{
    path: string;
    passed: boolean;
    message: string;
    expected?: unknown;
    actual?: unknown;
  }>;
  usage?: Usage;
  evaluations?: Array<{
    name: string;
    status: "passed" | "failed" | "error";
    metrics: EvaluationMetric[];
    usage?: Usage;
    durationMs: number;
    error?: { message: string };
  }>;
  error?: ErrorData;
}>; // type "test.completed", no run
\`\`\`

Typical event order:

\`\`\`text
session.created
run.started
message.created (user)
message.created (assistant, possibly with tool_call)
action.requested → action.completed|action.failed       # local action
message.created (tool)
...additional model/action rounds...
message.created (assistant final)
run.completed
evaluation.requested
evaluation.completed|evaluation.failed
\`\`\`

For client actions, \`client_action.requested\` and \`run.paused\` replace the
immediate tool message. A later \`resume(...toolResults)\` appends
\`client_action.resolved\`, the tool message, and continues the same run
number. A conversational \`resume(...content)\` starts a new run number.

## How Orcha works behind the scenes

### Compilation

1. \`orcha/index.ts\` calls \`orcha.init()\` with explicit agent paths.
2. The compiler reads each registered agent's \`index.json\` and
   \`instructions.md\`.
3. Every directory under \`actions/\` is compiled. Skills, tests, and
   evaluations are included only through their local \`index.js\` registry.
4. Local action source is bundled and SHA-256 hashed. Production bundles keep
   only provider adapters required by agents and enabled evaluations.
5. Invalid paths, duplicate model-facing names, missing files, unsupported
   configuration values, and missing schema objects fail before execution.
   Concrete action arguments and outputs are validated against their schemas
   when the action is used.

\`orcha dev\` repeats validation when files change. \`orcha build\` performs
offline production compilation. Neither command invokes a provider.

### Run lifecycle

1. \`run()\` creates a \`ses_<uuid>\`, acquires the per-session execution lock,
   appends \`session.created\`, then starts run 1.
2. \`resume()\` reads and validates the existing session. Message continuation
   starts a new run; submitted client results continue the paused run.
3. The provider receives the base instructions, available-skill catalog,
   loaded skill instructions, normalized conversation messages, action
   schemas, model settings, and current client capabilities.
4. Provider-specific responses are normalized into text, reasoning, and tool
   call blocks. Opaque replay metadata is stored only when a provider needs it
   to replay its own prior block correctly.
5. Tool calls are checked against compiled actions and declared client
   capabilities. Arguments and outputs are validated against JSON Schema.
6. \`load_skill\` updates durable session instructions. Local actions execute
   through the configured runtime. Client actions pause safely. Tool results
   are reordered to match the model's original call order.
7. The model loop continues until final output, failure, a client pause, or
   the maximum of 10 action rounds.
8. Usage is normalized and aggregated across every model call in the run.
9. After \`run.completed\`, enabled evaluations start in the background.
   \`execution.result\` is already available; \`execution.evaluations\` waits
   for judge completion and durable persistence.

The per-session lock prevents two model executions from mutating one session
at once. Background evaluation writes queue behind active runs so they cannot
cause \`resume()\` to fail spuriously or reuse sequence numbers.

### Replay and context

Orcha does not send raw JSONL back to the model. It projects durable events
into provider-neutral conversation messages. Completed conversational runs
become user, assistant, and tool messages; lifecycle bookkeeping such as
durations, test assertions, and evaluation events is excluded from model
context. Reasoning text and provider replay metadata are retained where needed
for faithful continuation but are omitted from evaluation transcripts.

### Reading sessions

- \`agent.get(sessionId)\` projects the latest status, pending client actions,
  last output, metadata, and aggregate usage.
- \`agent.history(sessionId, { page, pageSize })\` returns a safe user-facing
  timeline rather than raw provider bookkeeping.
- \`agent.events(sessionId, { page, pageSize })\` returns the canonical durable
  event records for observability, audit, and debugging tools. For subsequent
  pages of a changing session, pass the first response's \`throughSequence\`
  back in the options to keep pagination on a stable event boundary.
- \`agent.list({ page, pageSize, status, metadata })\` lists projected session
  snapshots.
- Never read storage files directly. Use these methods so applications remain
  compatible with JSONL, SQLite, IndexedDB, remote, and future storage adapters.

## Change rules

- Register every new agent, skill, test, and evaluation explicitly.
- Keep runtime behavior provider-neutral.
- Do not call real actions from tests.
- Do not commit \`.orcha/\`; it contains generated output and session data.
- Run \`orcha dev\` after filesystem changes and \`orcha test\` when behavior
  changes.
- Do not weaken assertions to match incorrect behavior. Remove an assertion
  only when it is stricter than the documented agent contract.
`;
