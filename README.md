# OrchaJS

**An agent is a folder.** OrchaJS is a filesystem-convention framework for building AI agents in JavaScript — no orchestration graph, no client to instantiate, no export step. It's a library, not a platform: add it to Next.js, React, React Native, Express, NestJS, or plain Node, the way you'd add Prisma or Zod.

> Early and moving fast. Not yet accepting external contributions — see [Status](#status) below.

---

## Why

Most agent frameworks or platforms ask you to trust a black box: the real logic lives inside someone else's runtime, and what you get to "own" is a copy or an export of it. OrchaJS removes that gap by making the file tree the actual source of truth — there's no internal state that isn't also a file you can open, edit, and run yourself.

Read the full concept: [`docs/concept.md`](./docs/concept.md)

---

## Create a project

Scaffold a complete Node.js application with example agents and a local
browser playground:

```bash
npm create orcha@latest my-agent-app
cd my-agent-app
npm install
cp .env.example .env
npm run dev
```

The starter demonstrates durable sessions, actions, client-action pauses,
skills, tests, evaluations, and multimodal input without a frontend framework
or hosted dependency.

---

## The convention

```
/agentname
  index.json                 → name, description, model, limits, output schema
  instructions.md           → required base agent instructions
  /skills
    /skillname
      index.json              → { name, description, triggers }
      instructions.md           → procedural knowledge, lazy-loaded into context
  /actions
    /actionname
      index.json                → definition, schemas, and execution location
      index.js                   → executable code for local actions only
  /guardrails                     → input/output policy
  /tests                          → explicitly run agent contract tests
  /evaluations                    → metrics each run is judged against
```

Placement determines behavior. Agent skills and test cases use local index
files to explicitly register which folders belong to the compiled agent.

---

## Skills

Skills keep specialized procedures out of the base prompt until the model
needs them. Register the skill folders available to an agent:

```js
// skills/index.js
import { defineSkills } from "orchajs/skills";

export default defineSkills({
  incompleteEvidenceReview: "./incompleteEvidenceReview",
});
```

Each registered folder contains compact discovery metadata and the full
instructions:

```json
{
  "name": "incomplete_evidence_review",
  "description": "Assess incomplete control evidence.",
  "triggers": ["A control has missing or stale evidence."]
}
```

```text
skills/incompleteEvidenceReview/
  index.json
  instructions.md
```

Orcha initially gives the model only each registered skill's name,
description, and trigger guidance. When the model calls the internal
`load_skill` tool, Orcha activates the full instructions without running an
application action or pausing for the client. Durable `skill.requested`,
`skill.loaded`, and `skill.failed` events expose the loading lifecycle. Loaded
skills remain active across `resume()` calls and provider changes.
Unregistered skill folders are not compiled or exposed.

---

## Model Action Protocol

What a model can do lives in `/actions`. Every action has `index.json`; local
actions additionally have `index.js`.

```
actions/
  send-refund/
    index.json   // the definition
    index.js      // the code
```

`index.json` tells the model what the action is, where it executes, and its
input/output contracts:

```json
{
  "name": "request_refund_approval",
  "description": "Ask the client application to approve a refund.",
  "execution": "client",
  "parameters": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string" },
      "amount": { "type": "number" }
    },
    "required": ["orderId", "amount"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "approved": { "type": "boolean" }
    },
    "required": ["approved"]
  }
}
```

Client actions pause the durable run. The application advertises only the
actions available on that client, executes the requested call, then resumes:

```js
const paused = await orcha.invoiceBot.run({
  content: "Refund order 123",
  clientCapabilities: orcha.invoiceBot.clientTools
}).result;

if (paused.status === "waiting_for_client_action") {
  const completed = await orcha.invoiceBot.resume(paused.sessionId, {
    toolResults: paused.clientToolCalls.map((call) => ({
      callId: call.callId,
      output: { approved: true }
    }))
  }).result;
}
```

Definitions are compiled from the filesystem and are not submitted again to
`resume()`. Requests and results are persisted in the session JSONL.

Local actions export their implementation from `index.js` and execute
automatically inside the model tool loop:

```js
import { calculateRefund } from "../../../../lib/billing.js";

export default async function sendRefund(parameters, context) {
  return {
    refunded: await calculateRefund(parameters),
    orderId: parameters.orderId,
    idempotencyKey: context.idempotencyKey,
  };
}
```

Action entrypoints and their imported JavaScript or TypeScript modules are
bundled together. Relative project imports, package imports, transitive
dependencies, and standard exports work normally.

Projects with local actions must explicitly choose their runtime:

```js
orcha.init({
  actions: {
    runtime: "native",
  },
  // providers and agents...
});
```

Native execution runs compiled action JavaScript directly without the QuickJS
dependency in the production bundle. It is trusted code with full host
privileges, including Node.js built-ins such as `node:fs`, the network, and
`process.env`. Native timeouts can reject asynchronous work but cannot
interrupt a synchronous infinite loop.

Use `"sandbox"` for isolated QuickJS execution. Declared environment and
network permissions are only securely enforced by the sandbox runtime.

---

## Quick start

```bash
npm install orchajs
npx orcha init
```

```js
// Import the consumer registry once from the application entrypoint.
import './orcha/index.js';
import { orcha } from 'orchajs';

const execution = orcha.exampleAgent.run({
  content: 'Help me understand this invoice'
});

// Native ReadableStream frames contain the complete output generated so far.
for await (const snapshot of execution.stream) {
  console.log(snapshot);
}

// The latest cumulative snapshot is also available without consuming the stream.
console.log(execution.snapshot);

const result = await execution.result;

// Every later conversational turn uses the returned sessionId.
const followUp = await orcha.exampleAgent.resume(result.sessionId, {
  content: 'Now summarize it in one sentence'
}).result;
```

Registered agents are exposed as `orcha.<agentName>`. The first implementation
supports durable Node.js runs backed by `.orcha/sessions/<sessionId>.jsonl`.
Client-action pause/resume, compiled local actions, and cumulative output
streaming are supported.
`run()` always starts a new session; `resume()` continues one with either a new
message or pending client tool results.

The CLI provides the same focused workflows without introducing a separate
application runtime:

```bash
# Offline validation that watches orcha/**
npx orcha dev

# Execute a registered agent. Input can also come from a JSON file or stdin.
npx orcha run exampleAgent --input "Help me understand this invoice"

# Continue an existing session or resolve pending client actions.
npx orcha run exampleAgent --session ses_123 --input "Summarize it"
npx orcha run exampleAgent --session ses_123 --tool-results results.json

# Run all tests, one agent, or one case.
npx orcha test
npx orcha test exampleAgent
npx orcha test exampleAgent/exampleCase

# Offline production compilation.
npx orcha build
```

`run` and `test` support `--json` for scripts and coding agents.
`orcha init` also creates a comprehensive `AGENTS.md` describing Orcha's
filesystem contract and APIs. The CLI does not provide a UI; applications can
build one from the storage-neutral runtime session APIs.

Orcha owns its built-in provider adapters. Messages, tool calls and results,
streaming snapshots, usage, and errors are normalized before reaching the
runtime, so application and action APIs do not change when an agent switches
providers. Provider-specific capabilities that cannot be represented safely
fail with an explicit Orcha error instead of silently degrading.

### Parent agents and subagents

Register private subagents on a top-level agent:

```js
orcha.init({
  providers: {
    openai: process.env.OPENAI_API_KEY,
  },
  agents: {
    coordinator: {
      path: "./coordinator",
      subagents: {
        researcher: "./researcher",
      },
    },
    researcher: "./researcher",
  },
});
```

Only top-level registrations are exposed directly, so `orcha.coordinator`
and `orcha.researcher` exist in this example. Removing the top-level
`researcher` registration makes it private while preserving delegation.

Every agent `index.json` requires a model-facing `name`; `description` is
optional and helps parent models understand when to delegate. A parent may
also configure delegation limits:

```json
{
  "name": "Coordinator",
  "description": "Delegate research and assemble the final answer.",
  "provider": "openai",
  "model": "gpt-5-mini",
  "subagents": {
    "maxPerRun": 3
  }
}
```

`maxPerRun` limits new child sessions in one parent run and defaults to `10`.

Starting or continuing a child is a synchronous internal tool call. While it
runs, the parent reports `waiting_for_subagent`. Child text, pause state,
client-action request, failure, or completion returns to the parent as a tool
result. Delegated agents cannot start further subagents.

Applications inspect a durable child through its owning parent agent:

```js
const history = await orcha.coordinator.subagentHistory(childSessionId);
```

The child session ID is included in the parent's projected history and
`subagent.initiated` event. Access is lineage-checked, so another parent agent
cannot inspect it. Parent traces record each child transition as
`subagent.initiated`, `subagent.paused`, `subagent.resumed`,
`subagent.completed`, or `subagent.failed`.

`orcha.coordinator.pause(sessionId)` immediately aborts active provider work
for the parent and active children. Already streamed text is persisted as an
incomplete assistant message. `resume()` always starts a new run with the
complete prior history, including that incomplete message:

```js
await orcha.coordinator.pause(parentSessionId);

// Adds "Continue." as the next user message.
await orcha.coordinator.resume(parentSessionId).result;

// Or provide different instructions.
await orcha.coordinator.resume(parentSessionId, {
  content: "Continue, but only use confirmed findings.",
}).result;
```

A child waiting for a client action returns control to the parent. The parent
can resolve it through its internal `resume_agent` tool, ask its own client
for information, inspect the child history, or finish without resuming the
paused child. Paused children do not block parent completion.

Anthropic, Amazon Bedrock Converse, DeepSeek Chat Completions, OpenAI
Responses, the Gemini Developer API through Google GenAI, and Vertex AI are
built in:

```js
orcha.init({
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY,
    bedrock: {
      region: process.env.AWS_REGION,
    },
    deepseek: process.env.DEEPSEEK_API_KEY,
    googlegenai: process.env.GOOGLE_GENAI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    vertexai: {
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
    },
  },
  agents: {
    invoiceAgent: "./invoiceAgent",
  },
});
```

Amazon Bedrock uses the standard AWS credential chain by default. Local AWS
profiles, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, ECS/EKS credentials,
and attached IAM roles work without copying credentials into Orcha
configuration. Explicit temporary or static credentials are also supported:

```js
orcha.init({
  providers: {
    bedrock: {
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      },
    },
  },
  agents: {
    complianceAgent: "./complianceAgent",
  },
});
```

Select `"bedrock"` in the agent and use a Bedrock model ID, inference-profile
ID, or ARN:

```json
{
  "name": "Bedrock Agent",
  "description": "Handle requests using the configured Bedrock model.",
  "provider": "bedrock",
  "model": "us.anthropic.claude-sonnet-4-6",
  "outputType": "text"
}
```

Vertex AI uses Google Application Default Credentials by default. Configure
ADC through the runtime environment, or provide `credentials: { clientEmail,
privateKey }` inside the `vertexai` configuration.

On Google Cloud, attach a service account to the Cloud Run, GKE, or Compute
runtime. No credential file or application configuration is required beyond
the project and location above.

For local development or a deployment with a mounted service-account file,
set its runtime path:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google-service-account.json
```

The credential file is read by Google's authentication library at runtime; it
is not included in the application bundle. The file must therefore exist at
that path inside the deployed container or server.

Credentials can alternatively come from environment variables:

```js
orcha.init({
  providers: {
    vertexai: {
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
      credentials: {
        clientEmail: process.env.GOOGLE_CLIENT_EMAIL,
        privateKey: process.env.GOOGLE_PRIVATE_KEY,
      },
    },
  },
  agents: {
    riskAgent: "./riskAgent",
  },
});
```

Do not import a service-account JSON file into application source because a
bundler may embed the secret in its output.

Choose the adapter and model in the agent's `index.json`:

```json
{
  "name": "Gemini Agent",
  "description": "Handle requests using the Gemini Developer API.",
  "provider": "googlegenai",
  "model": "gemini-2.5-flash",
  "outputType": "text"
}
```

Orcha requests provider-exposed reasoning summaries where that does not enable
reasoning itself, and stores any returned reasoning text as normalized blocks.
Set `reasoningLevel` to pass a provider-native effort value through unchanged
when you want to enable or configure reasoning.

Both methods accept text shorthand:

```js
const first = await orcha.exampleAgent.run("Start").result;
const second = await orcha.exampleAgent.resume(
  first.sessionId,
  "Continue",
).result;
```

Content accepts a single item or an array. Local paths and HTTP URLs infer
their MIME type from the extension unless `mimeType` is provided:

```js
const result = await orcha.exampleAgent.run({
  content: [
    { type: "text", text: "Summarize this document" },
    { filePath: "./documents/local-report.pdf" },
    { url: "https://example.com/supporting-report.pdf" },
  ],
  name: "Customer report",
  metadata: { customerId: "cus_123" },
  variables: { CUSTOMER_NAME: "Acme" },
}).result;
```

Orcha resolves local paths to absolute paths and stores only the path and MIME
type in durable session events. File bytes are loaded and encoded only while
constructing each provider request; base64 data is never persisted in the
message history. Provider file-type and size limits still apply.

Prompt variables replace `{{CUSTOMER_NAME}}` placeholders in
`instructions.md`. They are fixed when the session is created and persisted
for deterministic continuation. Do not put secrets in prompt variables; use
provider or action environment configuration for secrets.

Sessions are managed through the same registered agent:

```js
await orcha.exampleAgent.get(sessionId);
await orcha.exampleAgent.history(sessionId, { page: 1, pageSize: 50 });
await orcha.exampleAgent.events(sessionId, { page: 1, pageSize: 100 });
await orcha.exampleAgent.list({
  metadata: { customerId: "cus_123" },
  page: 1,
  pageSize: 20,
});
await orcha.exampleAgent.update(sessionId, {
  name: "September invoice",
  metadata: { approved: true },
});
```

`history()` returns a user-facing projection. `events()` returns the canonical
durable event records for observability and debugging without exposing the
active storage adapter. Applications should never read session files directly.
When paging while a session is still changing, pass the first response's
`throughSequence` into later `events()` calls to keep every page on the same
event boundary.

## Agent tests

Agent tests live beside the agent and use the same compiled instructions,
provider, output contract, action schemas, `run()`, and `resume()` behavior as
the application.

Register test folders in `tests/index.js`:

```js
import { defineTests } from "orchajs/testing";

export default defineTests({
  delayedOrder: "./delayedOrder",
});
```

Each test folder contains an `index.json` with its input, one simulated
response sequence for every action declared by the agent, and deterministic
expectations:

```json
{
  "input": {
    "content": "Explain why order ORD-4821 is late."
  },
  "actions": {
    "lookup_order_status": {
      "responses": [
        {
          "output": {
            "orderId": "ORD-4821",
            "status": "delayed"
          }
        }
      ]
    }
  },
  "expect": {
    "status": "completed",
    "text": {
      "contains": ["ORD-4821", "delayed"],
      "excludes": ["delivered"]
    },
    "actions": [
      {
        "name": "lookup_order_status",
        "arguments": {
          "equals": {
            "orderId": "ORD-4821"
          }
        }
      }
    ]
  }
}
```

The test action keys must exactly match the agent's `/actions`. Tests never run
the real local or client implementations; configured responses are submitted
through the normal client-action pause/resume flow.

Run every registered test programmatically:

```js
import { orcha } from "orchajs";
import { runTests } from "orchajs/testing";
import "./orcha/index.js";

const report = await runTests(orcha);
```

Test sessions retain complete JSONL logs beside normal sessions under
`.orcha/sessions/ses_test_<uuid>.jsonl`. The final `test.completed` event
records the suite, case, status, duration, and every assertion. Run tests
explicitly before building in CI. Tests use the configured providers, so the
test step requires provider credentials and consumes model tokens; `orcha
build` itself remains offline and does not require those credentials.

## Evaluations

Evaluations are registered LLM judges that score the cumulative session after
every completed run:

```js
// evaluations/index.js
import { defineEvaluations } from "orchajs/evaluations";

export default defineEvaluations({
  responseQuality: "./responseQuality",
});
```

```json
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
      "description": "The response relies only on confirmed session evidence.",
      "threshold": 0.8
    }
  ]
}
```

Each metric receives a normalized score from 0 to 1, reasoning, evidence, and
a threshold result. Orcha stores the judge lifecycle and results as
`evaluation.requested`, `evaluation.completed`, or `evaluation.failed` events.
Evaluation errors and missed thresholds do not change a successful production
agent result, but they do fail an agent test. Evaluator usage is reported
separately from the agent's usage.

`description` is a short human-facing summary. `instructions` contains the
potentially detailed prompt that directs the evaluator; when omitted,
`description` is used for backward compatibility. Metric descriptions define
the individual scoring criteria.

Evaluations do not delay the agent result. Await them only where the caller
needs the scores:

```js
const execution = orcha.riskBot.run(input);
const result = await execution.result;

// Optional in production; agent tests always await this.
const evaluations = await execution.evaluations;
```

Short-lived processes should await `execution.evaluations` before exiting if
they need every judge result to finish and persist.

For esbuild production applications, add `orchaPlugin()` from
`orchajs/esbuild` to the existing build. It compiles the registry and replaces
unchanged `orchajs` imports with the self-contained generated runtime. The
application continues to use its normal `npm run build` command.

---

## What's in this repo right now

- [x] Registry compiler + `orcha build`
- [x] Model Action Protocol — client actions and opt-in native/sandboxed local actions
- [x] Provider-neutral Anthropic, Bedrock, DeepSeek, OpenAI, Google GenAI, and Vertex AI adapters
- [x] Stateful sessions — Node JSONL replay and client-action pause/resume
- [x] Registered `/skills` with lazy, durable instruction loading
- [x] Agent `/tests` with durable test-prefixed logs and explicit CI gating
- [x] Registered LLM-judged `/evaluations`
- [ ] Agent `/guardrails`
- [x] Production compiler and `orcha build`
- [x] Lightweight CLI for init, validation, execution, tests, and builds

See [`ROADMAP.md`](./ROADMAP.md) for what's coming after — guardrails,
OpenTelemetry tracing, MCP interop adapters, and remote session storage remain
deliberately out of scope for the first release.

---

## Status

This project is being built in the open by a solo maintainer. It's not yet stable enough to take contributions productively — the core convention and API are still moving. `CONTRIBUTING.md` will open up once the shape settles.

In the meantime: [star the repo](.) to follow along, open an issue if you hit something worth flagging, or watch for weekly build-in-public updates on [X/Twitter](.).

---

## License

[MIT](./LICENSE)
