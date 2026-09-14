# OrchaJS roadmap

OrchaJS is a filesystem-convention framework for building stateful AI agents
in JavaScript. The roadmap is organized in implementation order: each phase
establishes a contract used by the phases after it.

## Product contract

An agent is a folder and the folder is the source of truth.

- `orcha.<agent>.run()` starts a new durable session.
- `orcha.<agent>.resume()` continues a durable session with a message or
  pending client-action results.
- `/actions`, `/tests`, `/evaluations`, and `/guardrails` add behavior through
  placement rather than manual runtime registration.
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

## Next

### 6. `/evaluations`

Add repeatable quality measurement under each agent's `/evaluations` folder.

- Define datasets, evaluators, scoring ranges, thresholds, and sample metadata
  as files.
- Support deterministic code evaluators first.
- Add model-graded evaluators through an explicit evaluator agent and provider
  configuration.
- Record output quality, tool behavior, latency, and normalized token usage.
- Compare results across agent, prompt, model, and provider revisions.
- Emit machine-readable evaluation reports without coupling Orcha to a hosted
  platform.

Completion criteria:

- Evaluation runs are reproducible from the repository.
- Scores retain per-case evidence rather than only aggregate numbers.
- Threshold failures return a non-zero CLI exit code.
- Evaluation runs retain inspectable logs in evaluation-specific storage
  instead of mixing with normal application sessions.

### 7. `/guardrails`

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

### 8. CLI completion

Finish the developer workflow after the runtime conventions are stable.

- `orcha init` creates the registry and a minimal example agent.
- `orcha dev` watches agent files, validates changes, and runs selected agents.
- Extend `orcha build` diagnostics for tests, evaluations, and guardrails.
- Add commands for running one agent test, all tests, and evaluation suites.
- Support selecting a named playground/example agent from the command line.
- Keep every CLI command usable in local development and CI without a hosted
  Orcha account.

### 9. Quick examples and release preparation

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
- Skills and lazy instruction loading.
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
