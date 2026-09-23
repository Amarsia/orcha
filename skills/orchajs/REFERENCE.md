# OrchaJS reference

Use this reference when a project does not contain `orcha/AGENTS.md`. Installed
package documentation and TypeScript declarations take precedence when they
describe a different API.

## Project structure

```text
orcha/
  index.ts
  supportBot/
    index.json
    instructions.md
    actions/
      lookupAccount/
        index.json
        index.js
    skills/
      index.js
      incidentTriage/
        index.json
        instructions.md
    tests/
      index.js
      activeAccount/
        index.json
    evaluations/
      index.js
      responseQuality/
        index.json
```

Only explicitly registered agents, skills, tests, and evaluations are
compiled. Action directories under a registered agent are discovered
automatically.

`.orcha/` contains generated bundles and session data. Do not edit or commit
it.

## Registry

`orcha/index.ts` initializes providers and registers agents:

```ts
import { orcha } from "orchajs";

orcha.init({
  providers: {
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
    openai: process.env.OPENAI_API_KEY ?? "",
  },
  agents: {
    supportBot: "./supportBot",
  },
});
```

Provider configuration and credentials belong in environment variables.
API-key providers accept a string or `{ apiKey, baseUrl? }`. Vertex AI uses a
project and location with optional service-account credentials. Bedrock uses a
region with optional AWS credentials. Verify exact provider shapes against the
installed package.

Local actions use the native runtime by default:

- `"sandbox"` can be selected explicitly to run bundled code in an isolated
  QuickJS runtime with declared
  environment and network permissions.
- `"native"` runs trusted action code in Node.js with host privileges and is
  the default.

## Agent configuration

Every registered agent needs `index.json` and non-empty `instructions.md`.

```json
{
  "name": "Support Agent",
  "description": "Resolve support requests using confirmed account data.",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "region": "provider_managed",
  "maxTokens": 10240,
  "outputType": "text"
}
```

Important fields:

- `name`, `provider`, and `model` are required.
- `description`, `region`, `maxTokens`, and `reasoningLevel` are optional.
- `outputType` is `"text"` by default or `"json"` for structured output.
- JSON output requires `outputSchema`.
- `subagents.maxPerRun` optionally limits child sessions created in one run.

Keep stable role, operating rules, tool guidance, and boundaries in
`instructions.md`. Prompt variables use `{{ variableName }}` and are supplied
when a session is created.

## Running agents

```ts
import "./orcha/index.js";
import { orcha } from "orchajs";

const execution = orcha.supportBot.run({
  content: "Check account acct_123.",
  name: "Account check",
  metadata: { accountId: "acct_123" },
  variables: { organizationName: "Example" },
  clientCapabilities: ["request_human_approval"],
});

for await (const snapshot of execution.stream) {
  console.log(snapshot);
}

const result = await execution.result;
const evaluations = await execution.evaluations;
```

`run()` always creates a durable session. Continue one with:

```ts
await orcha.supportBot.resume(sessionId, {
  content: "Continue with the confirmed account."
}).result;
```

If the result is waiting for client action, execute every returned call in the
application and submit all results together:

```ts
await orcha.supportBot.resume(sessionId, {
  toolResults: [
    { callId: "call_123", output: { approved: true } }
  ]
}).result;
```

Use returned call IDs exactly. A conversational resume starts a new run. A
tool-result resume continues the paused run.

Content may be text or supported multimodal blocks. Local file inputs use
`filePath`; provider-ready remote content uses `fileUri`. Confirm supported
media combinations from the installed provider documentation.

## Actions

Action metadata lives in `actions/<directory>/index.json`:

```json
{
  "name": "lookup_account",
  "description": "Look up one account.",
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
```

Local actions also provide `index.js`:

```js
export default async function lookupAccount({ accountId }, context) {
  return { status: "active" };
}
```

Action rules:

- Missing `execution` defaults to `"local"` and runs the implementation through
  the configured action runtime.
- `execution: "client"` has no implementation; Orcha pauses and delegates it
  to the application.
- `enabled` defaults to `true`; set it to `false` to keep WIP source inactive.
- Keep descriptions, parameter schemas, output schemas, and implementations
  aligned.
- Use `permissions.env` and `permissions.network` for sandbox access.
- Use `context.fetch` for sandboxed network calls.
- `context` includes session metadata and a stable idempotency key.
- `sideEffect` documents mutation behavior but does not change execution.

## Agent skills

Direct child folders under `skills/` are discovered automatically. Each skill
folder contains:

```json
{
  "name": "incident_triage",
  "description": "Investigate and classify service incidents.",
  "triggers": ["A user reports an outage or degraded service."]
}
```

and a non-empty `instructions.md`. The model sees a compact catalog and loads
skills through the internal `load_skill` tool. Loaded skill instructions
remain active for the durable session.

`enabled` defaults to `true`; set it to `false` to keep a WIP skill inactive.

These runtime agent skills are separate from the installable `orchajs` coding
skill containing this reference.

## Subagents

Allowlist private subagents in the parent registration:

```ts
agents: {
  coordinator: {
    path: "./coordinator",
    subagents: {
      researcher: "./researcher",
    },
  },
}
```

Register the same folder as a top-level agent only when applications should
also call it directly.

The parent receives internal tools to start, resume, and inspect child
sessions. Children have separate durable logs linked to the parent session.
The parent waits synchronously for child completion or pause. Parent pause
cascades to active children. Use `subagentHistory()` to inspect owned child
sessions.

## Tests

Direct child folders under `tests/` are discovered automatically. The folder
name is the CLI selector. A case can provide inline input:

```json
{
  "input": {
    "content": "Check account acct_123."
  },
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
        "arguments": {
          "equals": { "accountId": "acct_123" }
        }
      }
    ]
  }
}
```

For reusable input, `input` may be a JSON path relative to the case directory:

```json
{
  "input": "../../../../fixtures/account.json",
  "expect": { "status": "completed" }
}
```

Test behavior:

- Tests call the real provider and consume tokens.
- `enabled` defaults to `true`; set it to `false` to keep a WIP test inactive.
- Configured action entries are mocked and consumed in call order.
- Unmocked local actions run live and may cause side effects.
- Client actions require mocks because no application client is attached.
- `expect.output` supports `equals` or recursive `partial`.
- `expect.text` supports `contains` and `excludes`.
- `expect.actions` checks ordered calls and optional arguments.
- Enabled evaluations also gate test success.
- Test sessions use `ses_test_` IDs and end with `test.completed`.

## Evaluations

Direct child folders under `evaluations/` are discovered automatically.
Evaluation configuration:

```json
{
  "name": "response_quality",
  "description": "Grounding of agent responses.",
  "instructions": "Judge only against confirmed session evidence.",
  "enabled": true,
  "provider": "openai",
  "model": "gpt-5-mini",
  "metrics": [
    {
      "name": "groundedness",
      "description": "The response relies on confirmed evidence.",
      "threshold": 0.8
    }
  ]
}
```

Evaluations start after a completed run. `execution.result` does not wait for
them; `execution.evaluations` does. Judges receive a sanitized transcript, not
internal reasoning or previous evaluation results.

## Sessions

Use runtime methods rather than reading JSONL directly:

- `agent.get(sessionId)` returns the current snapshot.
- `agent.history(sessionId, options)` returns a user-facing timeline.
- `agent.events(sessionId, options)` returns canonical durable events.
- `agent.list(options)` returns paginated session snapshots.
- `agent.pause(sessionId)` pauses active provider work and children.
- `agent.resume(sessionId, input?)` continues a durable session.
- `agent.subagentHistory(childSessionId, options)` reads an owned child.

Only one execution may mutate a session at a time. Concurrent mutation returns
`session_busy`. Keep secrets out of session metadata because it is durable.

## Commands

```bash
orcha init
orcha dev
orcha playground
orcha run <agent> --input "..."
orcha run <agent> --input-file request.json
orcha run <agent> --session <id> --input "..."
orcha run <agent> --session <id> --tool-results results.json
orcha test [agent[/case]]
orcha build
```

`dev` and `build` are offline. `run` and `test` call real providers and require
credentials. The standalone CLI loads the project `.env` without overriding
variables already present in the process.

`playground` is local development tooling for inspecting configuration,
running agents and tests, viewing graphs, and following live session traces.
It is not included in production agent bundles.

## Verification

Choose checks proportional to the change:

- Registry or filesystem changes: `npx orcha dev`
- Agent behavior: targeted `npx orcha test agent/case`
- Production compilation: `npx orcha build`
- Manual provider flow: targeted `npx orcha run`

Do not invoke provider-consuming tests or live side effects without making
their cost and impact clear to the user.
