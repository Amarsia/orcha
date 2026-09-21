# orchajs

## 0.9.0

### Minor Changes

- [#51](https://github.com/Amarsia/orcha/pull/51) [`c640e49`](https://github.com/Amarsia/orcha/commit/c640e4957c7853627af0f427812e7a94d5d1641a) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Load `.env` from the project root for standalone Orcha CLI commands while
  preserving environment variables already supplied by the process. Library and
  production-bundle imports remain side-effect free and consume the host
  application's existing `process.env`.

  Report output-token exhaustion as an explicit failed run for both text and
  structured JSON agents. Truncated JSON is preserved as incomplete assistant
  content instead of being misreported as an invalid structured response, and
  the failure includes the output type and configured token limit.

  Improve human-readable `orcha run` output with a chronological execution
  trace, action and subagent statuses, child action summaries, and direct paths
  to every parent and subagent JSONL log. `--json` remains machine-readable.

## 0.8.0

### Minor Changes

- [#49](https://github.com/Amarsia/orcha/pull/49) [`6cf947e`](https://github.com/Amarsia/orcha/commit/6cf947e032984cd300df80b89d77c52b69067213) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Organize durable JSONL logs by agent and include a compact, sortable UTC timestamp
  in generated session IDs. Default Node storage now writes sessions to
  `.orcha/sessions/<agentName>/ses_<timestamp>_<uuid>.jsonl`, including test
  sessions and private subagent sessions. Existing flat session logs remain
  readable and resumable in their original location.

## 0.7.1

### Patch Changes

- [#47](https://github.com/Amarsia/orcha/pull/47) [`0d85800`](https://github.com/Amarsia/orcha/commit/0d8580052362535fa961b3f385cb175fa7d8a4ba) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Allow `run_agent` to accept the same text and multimodal content input as a
  normal agent run. Parent agents can forward local files, URLs, images, audio,
  video, and mixed content to linked child sessions. Local paths resolve from
  the configured Orcha project root without copying encoded bytes into tool
  arguments or logs.

## 0.7.0

### Minor Changes

- [#45](https://github.com/Amarsia/orcha/pull/45) [`605c6ff`](https://github.com/Amarsia/orcha/commit/605c6fffdc826a715587e166e48145b6c12c17ef) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add first-class local file and URL content inputs. Orcha now accepts
  `{ filePath }` and `{ url }` content, infers common MIME types, loads and
  encodes bytes only while constructing provider requests, and persists only
  local paths and MIME metadata in durable session history.

  Native actions now compile project-relative JavaScript and TypeScript imports,
  package imports, transitive dependencies, and Node.js built-ins into
  self-contained development and production runtimes.

## 0.6.2

### Patch Changes

- [#43](https://github.com/Amarsia/orcha/pull/43) [`afd3977`](https://github.com/Amarsia/orcha/commit/afd39778ce94984269ad1cc0eb4def18b47c8b3a) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Include actionable Bedrock tool-argument diagnostics with the sent tool
  definition, expected schema, received payload boundaries, size and hash, model
  and request identifiers, retry guidance, and the Orcha issue URL. Preserve
  structured provider error details in failed run results and durable session
  events.

## 0.6.1

### Patch Changes

- [#41](https://github.com/Amarsia/orcha/pull/41) [`0bd7319`](https://github.com/Amarsia/orcha/commit/0bd7319b55dc55f536dcb1da8792b7a7d912891a) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Compile native local actions for Node.js so trusted actions can import built-in
  modules such as `node:fs`, and configure the development playground and newly
  generated projects to use native action execution.

## 0.6.0

### Minor Changes

- [#39](https://github.com/Amarsia/orcha/pull/39) [`b242c9c`](https://github.com/Amarsia/orcha/commit/b242c9c4aa3356f5ca5d2ab7bfec57086c9ff688) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add first-class durable parent and subagent orchestration.

  Agents now declare a required human-readable `name` and may add an optional
  `description`.
  Top-level registrations may explicitly attach private subagents while the
  same agent can remain independently registered and accessible through
  `orcha.<agentName>`.

  Parent models receive built-in tools to start, continue, and inspect only the
  child sessions they initiated. Each child has an independent durable session
  linked to its parent, while the parent exposes
  `waiting_for_subagent` during synchronous child execution and receives child
  responses as normal tool results.

  Add lineage-checked `subagentHistory()`, explicit initiated, paused, resumed,
  completed, and failed lifecycle events, history projections, a configurable
  child-count limit that defaults to 10, and first-class `pause()` behavior.
  Parent pauses cascade through active children, abort provider streams, preserve
  partial assistant output, and resume as a new run with complete history.

  Update the project generator with a working parent/subagent example,
  subagent inspection endpoints and UI, complete documentation, and the
  compatible OrchaJS release range.

## 0.5.0

### Minor Changes

- [#36](https://github.com/Amarsia/orcha/pull/36) [`ff9d873`](https://github.com/Amarsia/orcha/commit/ff9d873bde4e18c197919c8cf25d252e9b2bee71) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Improve the Orcha development and inspection contract:

  - Add dedicated evaluator instructions so evaluations can keep a short human-facing description separate from the detailed judge prompt. Existing configurations continue to use `description` as a fallback.
  - Add `agent.events()` for paginated access to canonical durable session events through the configured storage adapter, allowing observability and debugging interfaces to remain independent of JSONL or any other persistence strategy.
  - Add `listTests()` discovery with complete registered test definitions for development interfaces.
  - Report an explicit OpenAI error when structured output exhausts `max_output_tokens` before producing valid JSON.

## 0.4.0

### Minor Changes

- [#34](https://github.com/Amarsia/orcha/pull/34) [`a44d38c`](https://github.com/Amarsia/orcha/commit/a44d38c157624989f887b3226404eaaa8a66f489) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add a lightweight, agent-friendly Orcha CLI.

  `orcha init` now safely creates a minimal registered agent and a comprehensive
  `AGENTS.md` construction reference. The generated guide documents every
  registry, provider, agent, action, skill, test, evaluation, and local-runtime
  option; explains compilation, durable execution, replay, and context
  projection; and specifies the exact payload stored for every JSONL event.

  `orcha dev` performs offline registry validation and watches agent files,
  `orcha run` executes or resumes a selected agent, and `orcha test` runs all
  tests or a selected agent or case. Run and test commands support
  machine-readable JSON output for automation and coding agents.

  Client and mocked test action results also preserve the documented `isError`
  marker when results are persisted and returned to providers.

## 0.3.0

### Minor Changes

- [#32](https://github.com/Amarsia/orcha/pull/32) [`ebaa5c0`](https://github.com/Amarsia/orcha/commit/ebaa5c0ebab2845d4abe51fe9ab52c70e9fa1bf3) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add registered LLM-judged agent evaluations.

  Agents can register evaluation folders through `evaluations/index.js`. Each
  evaluation defines its judge provider and model alongside predefined metrics
  and score thresholds. Enabled evaluations score the cumulative durable session
  after every completed run and return normalized scores, reasoning, evidence,
  usage, and pass status separately from the agent result.

  Evaluation lifecycle and results are persisted as durable session events.
  Registered evaluations also run during agent tests, where judge errors and
  missed metric thresholds fail the test without changing production agent
  completion semantics.

### Patch Changes

- [#32](https://github.com/Amarsia/orcha/pull/32) [`ebaa5c0`](https://github.com/Amarsia/orcha/commit/ebaa5c0ebab2845d4abe51fe9ab52c70e9fa1bf3) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Run registered agent evaluations asynchronously.

  Completed agent runs now resolve `execution.result` without waiting for LLM
  judges. Applications can optionally await `execution.evaluations`, while agent
  tests continue to await all registered evaluations and enforce their metric
  thresholds. Evaluation lifecycle events and results remain durably persisted
  in the session log.

## 0.2.0

### Minor Changes

- [#30](https://github.com/Amarsia/orcha/pull/30) [`e1f873c`](https://github.com/Amarsia/orcha/commit/e1f873c6cbc3f1b7e8f275442b55cdf78e704083) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add registered, lazily loaded agent skills.

  Agents can register skill folders through `skills/index.js`. Each skill keeps
  compact discovery metadata in `index.json` and detailed procedures in
  `instructions.md`. Orcha exposes the catalog through the provider-neutral
  model contract and handles `load_skill` internally without executing local
  code or pausing for client action results.

  Loaded skills are recorded as session-scoped `skill.loaded` events and remain
  active across durable `resume()` calls and provider changes. Production
  bundles include only explicitly registered skills.

## 0.1.0

### Minor Changes

- [#26](https://github.com/Amarsia/orcha/pull/26) [`b45c3c7`](https://github.com/Amarsia/orcha/commit/b45c3c7b3085bb1e9f68a8fdc6d43c0b667d8d74) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add filesystem-convention tests for compiled agents.

  Agents can register case folders through `tests/index.js`. Each JSON test case
  defines an input, simulated responses for the agent's complete action set, and
  deterministic status, output, text, and action-call expectations. Missing or
  unknown actions fail validation so tests cannot silently execute undeclared or
  real action implementations.

  The new `runTests()` API from `orchajs/testing` executes registered cases
  through the same durable `run()` and `resume()` lifecycle used by applications.
  Local and client actions are simulated through client-action pauses, while
  complete JSONL logs are retained in an isolated test-run directory. Reports
  include assertion details, usage, duration, and session IDs.

  `orcha build` now runs the registered agent test suite before producing a
  bundle and aborts when a test fails.

- [#24](https://github.com/Amarsia/orcha/pull/24) [`425f1e6`](https://github.com/Amarsia/orcha/commit/425f1e6e111e6bbdda49452108d15453f0a18430) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add Amazon Bedrock as a built-in provider through AWS's ConverseStream API.

  Agents can select `"bedrock"` and provide a Bedrock model ID, inference-profile
  ID, or ARN while retaining the same Orcha run, streaming, session, action, and
  resume APIs used by every other provider. The adapter uses Bedrock's common
  message and tool contract so compatible Claude, Nova, Llama, Mistral, Cohere,
  and other hosted model families can share one integration.

  Bedrock uses the standard AWS credential chain by default, including local AWS
  profiles, environment credentials, container credentials, and attached IAM
  roles. Applications can alternatively provide an access key, secret key, and
  optional session token explicitly.

  The adapter normalizes streamed text, reasoning text and signatures, fragmented
  tool inputs, tool results, structured JSON output, cache usage, finish reasons,
  and provider errors. User-supplied reasoning effort values are forwarded
  unchanged for adaptive-thinking Anthropic models.

  Production builds include the AWS SDK and credential chain only when a compiled
  agent uses Bedrock. A security-compliance scenario is included in the
  development playground.

- [#18](https://github.com/Amarsia/orcha/pull/18) [`867eb34`](https://github.com/Amarsia/orcha/commit/867eb348aecb5fdc21ab56cc8d75e790893955cd) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add DeepSeek as a built-in provider through its official Chat Completions API.

  Agents can select `"deepseek"` while retaining the same Orcha run, streaming,
  session, action, and resume APIs used by every other provider. The adapter
  normalizes streamed text, plaintext reasoning, fragmented function calls,
  tool results, JSON output, token usage, cache usage, finish reasons, and
  provider errors.

  When `reasoningLevel` is configured, its value is forwarded unchanged as
  DeepSeek's `reasoning_effort` and thinking mode is enabled. DeepSeek reasoning
  content is stored as normalized text and replayed in subsequent tool and
  conversation turns as required by the provider.

  DeepSeek currently accepts text input and text or JSON agent output through
  Orcha. Unsupported multimodal input and direct image or audio output fail
  explicitly instead of being silently transformed.

  Production builds include the DeepSeek adapter only when a compiled agent uses
  it. A DeepSeek Reasoner incident-analysis scenario is included in the
  development playground.

- [#9](https://github.com/Amarsia/orcha/pull/9) [`dda9613`](https://github.com/Amarsia/orcha/commit/dda961364c8e7eb6da5a308303876316a592d88e) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Expand the OrchaJS runtime with durable agent sessions and local actions.

  - Support client-action pausing and tool-result submission through `resume()`.
  - Add multimodal input, immutable prompt variables, session names, and metadata.
  - Add agent-scoped `get()`, `history()`, `list()`, and `update()` session APIs.
  - Add standardized Orcha errors and sanitized public session history.
  - Stream cumulative model output snapshots while preserving a final result promise.
  - Compile and hash filesystem-defined local actions during project builds.
  - Add explicit native and isolated QuickJS sandbox action runtimes.
  - Exclude QuickJS from native production bundles.

- [#1](https://github.com/Amarsia/orcha/pull/1) [`bfdb9eb`](https://github.com/Amarsia/orcha/commit/bfdb9eb488311218fe8d326ca17612b264313007) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add the first OrchaJS alpha foundation: filesystem agent compilation, an
  Anthropic runtime, durable JSONL sessions, structured outputs, and automatic
  esbuild production integration.

- [#16](https://github.com/Amarsia/orcha/pull/16) [`7101aca`](https://github.com/Amarsia/orcha/commit/7101aca18c26cca44e0a10998efd6add902b98ae) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add Google GenAI as a built-in provider using Google's official `@google/genai`
  SDK and the Gemini Developer API.

  Agents can now select `"googlegenai"` without changing Orcha's run, streaming,
  session, action, or resume APIs. The adapter translates Orcha's normalized
  messages, Gemini Files API and inline multimodal inputs, function declarations,
  function calls and results, JSON Schema output, token usage, finish reasons,
  and streamed text.

  Google reasoning levels are forwarded unchanged to Gemini's `thinkingLevel`
  field. Returned reasoning text and opaque thought signatures are persisted so
  durable tool loops can replay Gemini responses correctly, while ordinary text
  messages remain provider-neutral. Sessions can continue across Anthropic,
  OpenAI, and Google models through the same normalized context projection.

  Direct image and audio agent outputs remain explicit unsupported capabilities.
  Gemini media input accepts base64 data URIs, Gemini Files API URIs, and Google
  Cloud Storage URIs; arbitrary public URLs must be uploaded to Gemini Files
  before use.

  Production compilation now includes only the provider adapters selected by the
  project's compiled agents, so applications that do not use Google do not bundle
  the Google SDK or its dependencies.

- [#12](https://github.com/Amarsia/orcha/pull/12) [`8cbdb7d`](https://github.com/Amarsia/orcha/commit/8cbdb7d21fe7de2150321ef5b059e558e7a3b0b3) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add a provider-neutral runtime contract for built-in model adapters.

  - Normalize messages, reasoning, tool calls, tool results, streaming, usage, stop reasons, and errors before they reach the runtime.
  - Move Anthropic request and response translation behind the built-in provider adapter boundary.
  - Persist provider-neutral assistant and tool messages while retaining compatibility with existing Anthropic-shaped session logs.
  - Reject unsupported provider capabilities explicitly instead of silently degrading behavior.

- [#14](https://github.com/Amarsia/orcha/pull/14) [`fe75f01`](https://github.com/Amarsia/orcha/commit/fe75f01fd03e560647110a27df86287244a02123) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add OpenAI as a built-in provider through the Responses API.

  - Register OpenAI with the compiler and built-in provider dispatcher so agents can select `"provider": "openai"` without changing runtime APIs.
  - Translate text, image, and file inputs plus assistant history through the provider-neutral message contract.
  - Support local and client function calls, function results, multi-round tool execution, durable pause/resume, and provider-independent session logs.
  - Stream cumulative text snapshots from OpenAI server-sent events while preserving the normalized final result promise.
  - Support strict JSON Schema output with Orcha's existing structured-output validation.
  - Pass user-supplied reasoning effort strings through unchanged, request readable reasoning summaries when configured, and persist normalized summaries with opaque replay data.
  - Normalize response IDs, completion reasons, input/output/reasoning/cache token usage, refusals, API errors, and incomplete responses.
  - Return a retryable failed run when a model exhausts its output-token budget instead of reporting an empty successful result.
  - Preserve provider provenance so durable sessions can continue after switching models or providers.
  - Share a robust server-sent event parser across the Anthropic and OpenAI adapters.
  - Add integration coverage for streaming, multimodal input, structured output, reasoning, tool execution, token exhaustion, and cross-provider continuation.

- [#22](https://github.com/Amarsia/orcha/pull/22) [`3db236c`](https://github.com/Amarsia/orcha/commit/3db236ce6cb545c839537622e9aa6931a68f01de) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Request and persist provider-returned reasoning text without enabling
  reasoning by default.

  Google GenAI and Vertex AI now request thought summaries without overriding
  the model's reasoning level. OpenAI requests automatic reasoning summaries and
  replay metadata without setting an effort level.

  Anthropic and DeepSeek continue to enable reasoning only when an agent supplies
  `reasoningLevel`. User-supplied values pass through unchanged. Every adapter
  stores reasoning text whenever its provider returns it, allowing reasoning
  token usage to be matched with the available provider-exposed explanation.

- [#20](https://github.com/Amarsia/orcha/pull/20) [`82b2a38`](https://github.com/Amarsia/orcha/commit/82b2a38126501cac433bb6190dcf24bd3d74b88b) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add Vertex AI as a built-in provider using Google's official `@google/genai`
  Node SDK.

  Vertex agents use the same normalized messages, streaming snapshots, reasoning,
  function calls, structured output, usage, durable sessions, and cross-provider
  continuation contract as Gemini Developer API agents. Both Google backends now
  share one Gemini protocol implementation instead of maintaining duplicate
  request and response translations.

  Configure Vertex with a Google Cloud project and location. Authentication uses
  Google Application Default Credentials by default, including credentials
  provided through `GOOGLE_APPLICATION_CREDENTIALS`. Service-account
  `clientEmail` and `privateKey` values can instead be supplied explicitly in the
  provider configuration.

  Production compilation includes the Node SDK and Google Cloud authentication
  dependencies only when a compiled agent selects `"vertexai"`. Other provider
  bundles remain unaffected.

  The development playground includes a Vertex-powered payment-risk agent with a
  sandboxed transaction lookup.

### Patch Changes

- [#26](https://github.com/Amarsia/orcha/pull/26) [`b45c3c7`](https://github.com/Amarsia/orcha/commit/b45c3c7b3085bb1e9f68a8fdc6d43c0b667d8d74) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Make agent test outcomes visible and durable. Build output now lists every
  registered test with its status, duration, and session ID. Test executions use
  `ses_test_` session IDs, write alongside normal session JSONL files, and append
  a `test.completed` event containing the suite identity and assertion results.

## 0.1.0-next.9

### Minor Changes

- [#26](https://github.com/Amarsia/orcha/pull/26) [`b45c3c7`](https://github.com/Amarsia/orcha/commit/b45c3c7b3085bb1e9f68a8fdc6d43c0b667d8d74) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add filesystem-convention tests for compiled agents.

  Agents can register case folders through `tests/index.js`. Each JSON test case
  defines an input, simulated responses for the agent's complete action set, and
  deterministic status, output, text, and action-call expectations. Missing or
  unknown actions fail validation so tests cannot silently execute undeclared or
  real action implementations.

  The new `runTests()` API from `orchajs/testing` executes registered cases
  through the same durable `run()` and `resume()` lifecycle used by applications.
  Local and client actions are simulated through client-action pauses, while
  complete JSONL logs are retained in an isolated test-run directory. Reports
  include assertion details, usage, duration, and session IDs.

  `orcha build` now runs the registered agent test suite before producing a
  bundle and aborts when a test fails.

### Patch Changes

- [#26](https://github.com/Amarsia/orcha/pull/26) [`b45c3c7`](https://github.com/Amarsia/orcha/commit/b45c3c7b3085bb1e9f68a8fdc6d43c0b667d8d74) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Make agent test outcomes visible and durable. Build output now lists every
  registered test with its status, duration, and session ID. Test executions use
  `ses_test_` session IDs, write alongside normal session JSONL files, and append
  a `test.completed` event containing the suite identity and assertion results.

## 0.1.0-next.8

### Minor Changes

- [#24](https://github.com/Amarsia/orcha/pull/24) [`425f1e6`](https://github.com/Amarsia/orcha/commit/425f1e6e111e6bbdda49452108d15453f0a18430) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add Amazon Bedrock as a built-in provider through AWS's ConverseStream API.

  Agents can select `"bedrock"` and provide a Bedrock model ID, inference-profile
  ID, or ARN while retaining the same Orcha run, streaming, session, action, and
  resume APIs used by every other provider. The adapter uses Bedrock's common
  message and tool contract so compatible Claude, Nova, Llama, Mistral, Cohere,
  and other hosted model families can share one integration.

  Bedrock uses the standard AWS credential chain by default, including local AWS
  profiles, environment credentials, container credentials, and attached IAM
  roles. Applications can alternatively provide an access key, secret key, and
  optional session token explicitly.

  The adapter normalizes streamed text, reasoning text and signatures, fragmented
  tool inputs, tool results, structured JSON output, cache usage, finish reasons,
  and provider errors. User-supplied reasoning effort values are forwarded
  unchanged for adaptive-thinking Anthropic models.

  Production builds include the AWS SDK and credential chain only when a compiled
  agent uses Bedrock. A security-compliance scenario is included in the
  development playground.

## 0.1.0-next.7

### Minor Changes

- [#22](https://github.com/Amarsia/orcha/pull/22) [`3db236c`](https://github.com/Amarsia/orcha/commit/3db236ce6cb545c839537622e9aa6931a68f01de) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Request and persist provider-returned reasoning text without enabling
  reasoning by default.

  Google GenAI and Vertex AI now request thought summaries without overriding
  the model's reasoning level. OpenAI requests automatic reasoning summaries and
  replay metadata without setting an effort level.

  Anthropic and DeepSeek continue to enable reasoning only when an agent supplies
  `reasoningLevel`. User-supplied values pass through unchanged. Every adapter
  stores reasoning text whenever its provider returns it, allowing reasoning
  token usage to be matched with the available provider-exposed explanation.

## 0.1.0-next.6

### Minor Changes

- [#20](https://github.com/Amarsia/orcha/pull/20) [`82b2a38`](https://github.com/Amarsia/orcha/commit/82b2a38126501cac433bb6190dcf24bd3d74b88b) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add Vertex AI as a built-in provider using Google's official `@google/genai`
  Node SDK.

  Vertex agents use the same normalized messages, streaming snapshots, reasoning,
  function calls, structured output, usage, durable sessions, and cross-provider
  continuation contract as Gemini Developer API agents. Both Google backends now
  share one Gemini protocol implementation instead of maintaining duplicate
  request and response translations.

  Configure Vertex with a Google Cloud project and location. Authentication uses
  Google Application Default Credentials by default, including credentials
  provided through `GOOGLE_APPLICATION_CREDENTIALS`. Service-account
  `clientEmail` and `privateKey` values can instead be supplied explicitly in the
  provider configuration.

  Production compilation includes the Node SDK and Google Cloud authentication
  dependencies only when a compiled agent selects `"vertexai"`. Other provider
  bundles remain unaffected.

  The development playground includes a Vertex-powered payment-risk agent with a
  sandboxed transaction lookup.

## 0.1.0-next.5

### Minor Changes

- [#18](https://github.com/Amarsia/orcha/pull/18) [`867eb34`](https://github.com/Amarsia/orcha/commit/867eb348aecb5fdc21ab56cc8d75e790893955cd) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add DeepSeek as a built-in provider through its official Chat Completions API.

  Agents can select `"deepseek"` while retaining the same Orcha run, streaming,
  session, action, and resume APIs used by every other provider. The adapter
  normalizes streamed text, plaintext reasoning, fragmented function calls,
  tool results, JSON output, token usage, cache usage, finish reasons, and
  provider errors.

  When `reasoningLevel` is configured, its value is forwarded unchanged as
  DeepSeek's `reasoning_effort` and thinking mode is enabled. DeepSeek reasoning
  content is stored as normalized text and replayed in subsequent tool and
  conversation turns as required by the provider.

  DeepSeek currently accepts text input and text or JSON agent output through
  Orcha. Unsupported multimodal input and direct image or audio output fail
  explicitly instead of being silently transformed.

  Production builds include the DeepSeek adapter only when a compiled agent uses
  it. A DeepSeek Reasoner incident-analysis scenario is included in the
  development playground.

## 0.1.0-next.4

### Minor Changes

- [#16](https://github.com/Amarsia/orcha/pull/16) [`7101aca`](https://github.com/Amarsia/orcha/commit/7101aca18c26cca44e0a10998efd6add902b98ae) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add Google GenAI as a built-in provider using Google's official `@google/genai`
  SDK and the Gemini Developer API.

  Agents can now select `"googlegenai"` without changing Orcha's run, streaming,
  session, action, or resume APIs. The adapter translates Orcha's normalized
  messages, Gemini Files API and inline multimodal inputs, function declarations,
  function calls and results, JSON Schema output, token usage, finish reasons,
  and streamed text.

  Google reasoning levels are forwarded unchanged to Gemini's `thinkingLevel`
  field. Returned reasoning text and opaque thought signatures are persisted so
  durable tool loops can replay Gemini responses correctly, while ordinary text
  messages remain provider-neutral. Sessions can continue across Anthropic,
  OpenAI, and Google models through the same normalized context projection.

  Direct image and audio agent outputs remain explicit unsupported capabilities.
  Gemini media input accepts base64 data URIs, Gemini Files API URIs, and Google
  Cloud Storage URIs; arbitrary public URLs must be uploaded to Gemini Files
  before use.

  Production compilation now includes only the provider adapters selected by the
  project's compiled agents, so applications that do not use Google do not bundle
  the Google SDK or its dependencies.

## 0.1.0-next.3

### Minor Changes

- [#14](https://github.com/Amarsia/orcha/pull/14) [`fe75f01`](https://github.com/Amarsia/orcha/commit/fe75f01fd03e560647110a27df86287244a02123) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add OpenAI as a built-in provider through the Responses API.

  - Register OpenAI with the compiler and built-in provider dispatcher so agents can select `"provider": "openai"` without changing runtime APIs.
  - Translate text, image, and file inputs plus assistant history through the provider-neutral message contract.
  - Support local and client function calls, function results, multi-round tool execution, durable pause/resume, and provider-independent session logs.
  - Stream cumulative text snapshots from OpenAI server-sent events while preserving the normalized final result promise.
  - Support strict JSON Schema output with Orcha's existing structured-output validation.
  - Pass user-supplied reasoning effort strings through unchanged, request readable reasoning summaries when configured, and persist normalized summaries with opaque replay data.
  - Normalize response IDs, completion reasons, input/output/reasoning/cache token usage, refusals, API errors, and incomplete responses.
  - Return a retryable failed run when a model exhausts its output-token budget instead of reporting an empty successful result.
  - Preserve provider provenance so durable sessions can continue after switching models or providers.
  - Share a robust server-sent event parser across the Anthropic and OpenAI adapters.
  - Add integration coverage for streaming, multimodal input, structured output, reasoning, tool execution, token exhaustion, and cross-provider continuation.

## 0.1.0-next.2

### Minor Changes

- [#12](https://github.com/Amarsia/orcha/pull/12) [`8cbdb7d`](https://github.com/Amarsia/orcha/commit/8cbdb7d21fe7de2150321ef5b059e558e7a3b0b3) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add a provider-neutral runtime contract for built-in model adapters.

  - Normalize messages, reasoning, tool calls, tool results, streaming, usage, stop reasons, and errors before they reach the runtime.
  - Move Anthropic request and response translation behind the built-in provider adapter boundary.
  - Persist provider-neutral assistant and tool messages while retaining compatibility with existing Anthropic-shaped session logs.
  - Reject unsupported provider capabilities explicitly instead of silently degrading behavior.

## 0.1.0-next.1

### Minor Changes

- [#9](https://github.com/Amarsia/orcha/pull/9) [`dda9613`](https://github.com/Amarsia/orcha/commit/dda961364c8e7eb6da5a308303876316a592d88e) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Expand the OrchaJS runtime with durable agent sessions and local actions.

  - Support client-action pausing and tool-result submission through `resume()`.
  - Add multimodal input, immutable prompt variables, session names, and metadata.
  - Add agent-scoped `get()`, `history()`, `list()`, and `update()` session APIs.
  - Add standardized Orcha errors and sanitized public session history.
  - Compile and hash filesystem-defined local actions during project builds.
  - Add explicit native and isolated QuickJS sandbox action runtimes.
  - Exclude QuickJS from native production bundles.

## 0.1.0-next.0

### Minor Changes

- [#1](https://github.com/Amarsia/orcha/pull/1) [`bfdb9eb`](https://github.com/Amarsia/orcha/commit/bfdb9eb488311218fe8d326ca17612b264313007) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add the first OrchaJS alpha foundation: filesystem agent compilation, an
  Anthropic runtime, durable JSONL sessions, structured outputs, and automatic
  esbuild production integration.
