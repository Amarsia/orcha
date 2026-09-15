# OrchaJS roadmap

OrchaJS is a filesystem-convention framework for building stateful AI agents
in JavaScript. The roadmap is organized in implementation order: each phase
establishes a contract used by the phases after it.

## Product contract

An agent is a folder and the folder is the source of truth.

- `orcha.<agent>.run()` starts a new durable session.
- `orcha.<agent>.resume()` continues a durable session with a message or
  pending client-action results.
- `/actions`, `/skills`, `/tests`, `/evaluations`, and `/guardrails` add
  behavior through agent-owned filesystem conventions.
- Provider adapters are maintained by Orcha and expose one normalized runtime
  contract.

## Completed

### 1. Filesystem registry and compiler

- Agent folders with required `index.json` and `instructions.md`.
- Registry compilation from `orcha/index.ts`.
- Validation for providers, models, generation settings, output types, and
  JSON output schemas.
- Compiled manifests that embed instructions and action definitions.
- `orcha build` and an esbuild integration that embeds a self-contained Orcha
  runtime into production applications.
- Provider-isolated production bundles so unused provider SDKs and
  authentication libraries are excluded.

### 2. Model Action Protocol

- Provider-neutral action definitions with JSON Schema inputs and outputs.
- Client actions that pause a run and resume with validated tool results.
- Local actions executed through opt-in native or QuickJS sandbox runtimes.
- Sandboxed permissions, timeouts, resource limits, source hashing, and
  idempotent action execution.
- Durable action-request, completion, failure, pause, and resume events.

### 3. Durable agent runtime

- `orcha.<agent>.run()` for starting a new session.
- `orcha.<agent>.resume()` for conversational turns and client-action results.
- Execution handles with cumulative `stream`, current `snapshot`, and final
  `result`.
- Durable JSONL session event storage.
- Session `get`, `history`, `list`, and `update` APIs.
- Session names, metadata, prompt variables, multimodal input, and structured
  JSON output.
- Normalized usage, stop reasons, errors, reasoning blocks, tool calls, and
  tool results.
- Cross-provider session continuation with provider-specific replay metadata
  preserved only where required.

### 4. Built-in providers

- Anthropic Messages.
- OpenAI Responses.
- Google Gemini Developer API through Google GenAI.
- Google Vertex AI with Application Default Credentials or explicit service
  account credentials.
- DeepSeek Chat Completions.
- Amazon Bedrock Converse with the AWS credential chain or explicit
  credentials.
- Streaming, tools, reasoning capture, usage normalization, and structured
  output across the shared provider contract.

### 5. `/tests`

Agent-owned deterministic test cases live under each agent's `/tests` folder.

- Require `tests/index.js` to register every test case by name and folder path.
- Define each case's input, variables, metadata, action responses, and expected
  behavior in the case folder's `index.json`.
- Require every compiled agent action to have a test action definition in each
  case. Unknown test actions and missing registered actions fail compilation.
- Do not execute real local or client actions in the first version.
- Return configured action responses in call order and automatically submit
  mocked client-action results through `resume()`.
- Support exact and deep-partial JSON output assertions, text
  contains/excludes assertions, completion status, and action call counts.
- Execute the real compiled agent and provider through the durable `run()` and
  `resume()` contract.
- Store complete JSONL logs beside normal sessions as
  `.orcha/sessions/ses_test_<uuid>.jsonl`, ending with a durable
  `test.completed` event containing the assertion results.
- Export `runTests()` from `orchajs/testing` to run every registered test.
- Run registered suites explicitly through `runTests()` before production
  builds in CI; keep `orcha build` offline and credential-free.
- Produce machine-readable reports with suite and case status, assertions,
  duration, usage, and session IDs.
- Keep framework tests separate from consumer agent tests.

Completion criteria:

- Invalid test definitions fail during compilation with file-specific errors.
- The test action set exactly matches the agent's `/actions` contract.
- Local and client actions are simulated without external side effects.
- Client-action pauses and automatic resumes are visible in JSONL.
- Test runs retain inspectable `ses_test_` JSONL logs alongside the
  application's normal sessions.
- A failing assertion identifies the agent, test case, and mismatched value.
- A failing `runTests()` process exits non-zero so CI can gate a subsequent
  production build.

### 6. `/skills`

Agent-owned skills provide specialized instructions without placing every
procedure in the base system prompt.

- Require `skills/index.js` to register the skill folders compiled for an
  agent.
- Define compact model-facing names, descriptions, and optional trigger
  guidance in each skill's `index.json`.
- Keep detailed procedures in each skill's `instructions.md`.
- Expose only the compact skill catalog until the model calls Orcha's internal
  `load_skill` tool.
- Handle skill loading inside the runtime without local execution, client
  pauses, or provider-specific behavior.
- Persist `skill.requested`, `skill.loaded`, and `skill.failed` lifecycle
  events, with successful loads remaining active across `resume()` calls and
  provider changes.
- Ignore unregistered skill folders and reject invalid paths, metadata, empty
  instructions, duplicate names, and reserved action-name collisions.

Completion criteria:

- Production bundles contain exactly the skills registered for each compiled
  agent.
- Full skill instructions are absent from model context until loaded.
- Loading a skill continues the existing model loop without application
  intervention.
- Repeated loads are idempotent and do not duplicate instructions.
- Durable logs identify every skill activated in a session.

### 7. `/evaluations`

Add repeatable quality measurement under each agent's `/evaluations` folder.

- Require `evaluations/index.js` to register the evaluations compiled for an
  agent.
- Define each LLM judge, model, predefined metrics, and per-metric thresholds
  in the registered folder's `index.json`.
- Run every enabled evaluation against the cumulative durable session after
  each completed agent run.
- Give judges a sanitized transcript containing user-visible messages, action
  activity, results, and loaded skills without internal reasoning or replay
  metadata.
- Persist `evaluation.requested`, `evaluation.completed`, and
  `evaluation.failed` events with scores, evidence, evaluator usage, model,
  duration, and evaluated sequence.
- Return evaluation results separately without converting a successful
  production agent run into a failure.
- Resolve `execution.result` as soon as agent work completes, run judges in
  the background, and expose `execution.evaluations` for callers that choose
  to await the outcomes.
- Apply registered evaluations to agent tests and fail the test when a metric
  threshold is missed or its judge fails.

Completion criteria:

- Invalid evaluation definitions fail compilation with file-specific errors.
- Every configured metric receives exactly one normalized score from 0 to 1,
  concise reasoning, and supporting evidence.
- Evaluation lifecycle and results remain inspectable in the same durable
  session JSONL.
- Agent and evaluator token usage remain separate.
- Production runs expose evaluation outcomes without changing their agent
  completion status.

## Next

### 8. `/guardrails`

Add composable input, output, and action policy under each agent's
`/guardrails` folder.

- Compile guardrails from files in deterministic order.
- Separate input, output, and action guardrail stages.
- Support deterministic local policies before optional model-based policies.
- Allow, reject, redact, or transform content through explicit typed results.
- Persist guardrail decisions in durable runs without storing secrets or
  unsafe raw content unnecessarily.
- Apply the same policy pipeline to `run()` and `resume()`.

Completion criteria:

- Guardrail failures are normalized Orcha errors with actionable details.
- Streaming never publishes output before required output policy checks.
- Action guardrails run before local or client-side execution.
- Policy ordering and fail-open versus fail-closed behavior are explicit.

### 9. CLI completion

Finish the developer workflow after the runtime conventions are stable.

- `orcha init` creates the registry and a minimal example agent.
- `orcha dev` watches agent files, validates changes, and runs selected agents.
- Extend `orcha build` diagnostics for tests, evaluations, and guardrails.
- Add commands for running one agent test, all tests, and evaluation suites.
- Support selecting a named playground/example agent from the command line.
- Keep every CLI command usable in local development and CI without a hosted
  Orcha account.

### 10. Quick examples and release preparation

- Add focused examples for durable chat, client actions, local actions,
  structured output, multimodal input, and each built-in provider.
- Keep examples small enough to copy into an existing Node.js application.
- Document authentication without encouraging credentials in source code.
- Publish a first-release migration and compatibility guide.
- Align README status, package exports, and generated API documentation.

## Later

These remain outside the first-release sequence:

- Comprehensive test fixtures with dynamic JavaScript action implementations,
  custom assertion functions, reusable fixtures, setup/teardown hooks,
  parameterized cases, retries, concurrency controls, and provider matrices.
- Actor-driven simulation tests with independent actor and agent models,
  repeated runs, turn limits, token budgets, and evaluation aggregation.
- Remote session-store adapters.
- OpenTelemetry tracing.
- MCP interoperability adapters.
- Hosted evaluation dashboards.
- Additional providers after the built-in provider contract is stable.

## Roadmap rules

- Complete phases in order unless a production bug requires an interruption.
- Add a new changeset for every releasable change; never rewrite a released
  changeset.
- Keep provider-specific behavior inside maintained adapters.
- Do not silently translate user-supplied model or reasoning values.
- Prefer explicit unsupported-capability errors over degraded behavior.
- Do not add hosted-service requirements to the core library.
