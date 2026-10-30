# orchajs

## 0.25.0

### Minor Changes

- [#122](https://github.com/Amarsia/orcha/pull/122) [`a4d2b91`](https://github.com/Amarsia/orcha/commit/a4d2b9170f419dd0146e208b9b50bc4aba090afc) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add Amarsia-managed inference and durable local-first cloud session storage
  across Node.js, browser, Expo, and React Native runtimes.

  - Route model requests through the Amarsia Responses gateway with native
    streaming, structured output, tool calls, reasoning replay, usage metering,
    and build-time provider pruning.
  - Persist cloud sessions through an encrypted, retryable outbox with ordered
    conflict reconciliation, acknowledgement tracking, lifecycle flush APIs, and
    platform-specific durable queues.
  - Record run lifecycle telemetry from invocation start through completion,
    pause, or failure, preserving accumulated usage and actionable errors.
  - Normalize local and remote multimodal files, including PDF-only requests,
    across supported providers.
  - Keep runtime credentials optional during compilation so production builds can
    receive secrets only when the generated application starts.

## 0.24.0

### Minor Changes

- [#120](https://github.com/Amarsia/orcha/pull/120) [`7aabcc1`](https://github.com/Amarsia/orcha/commit/7aabcc13e58d582d372dc0590c6628091058d104) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add MCP client support for agents and subagents. Register named MCP folders directly on each agent, discover all server tools at runtime, and execute namespaced MCP tools through the durable provider tool loop. Streamable HTTP works across Node.js, browser, Expo, and React Native builds, while stdio is available for Node.js targets. The MCP SDK remains optional and is installed only for projects that configure MCP connections.

## 0.23.12

### Patch Changes

- [#118](https://github.com/Amarsia/orcha/pull/118) [`657419c`](https://github.com/Amarsia/orcha/commit/657419c6b90a7764f3a64e43ba3815572fd8efa0) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Automatically install the optional SDK required by each provider selected by an agent or enabled evaluation. Build, development, playground, run, test, and framework integration workflows now add only the missing provider dependencies using the project's package manager before compiling or loading the project. Add `orchajs` as the preferred CLI binary while retaining `orcha` as a backward-compatible alias.

## 0.23.11

### Patch Changes

- [#116](https://github.com/Amarsia/orcha/pull/116) [`6c0738c`](https://github.com/Amarsia/orcha/commit/6c0738cdbd1d3c66f90cee310327162d0a5344f5) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Make `npx orchajs init` a complete one-command setup for existing projects. It installs `orchajs` and development-only compiler and playground tooling with the detected package manager before creating the starter agent files.

## 0.23.10

### Patch Changes

- [#114](https://github.com/Amarsia/orcha/pull/114) [`72954e2`](https://github.com/Amarsia/orcha/commit/72954e231dad49fbcaa9fdb575ba67bbc149f4df) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Flush evaluation telemetry after durable evaluation results are recorded so short-lived and serverless requests report evaluation logs and metrics to Amarsia Analytics before `execution.evaluations` resolves.

## 0.23.9

### Patch Changes

- [#112](https://github.com/Amarsia/orcha/pull/112) [`9288263`](https://github.com/Amarsia/orcha/commit/928826352413d1f655f20c326c7ed98984dd9e05) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Ensure terminal telemetry is projected and dispatched before completed runs return, and make `flushTelemetry()` wait for pending projections so successful runs are not later marked as interrupted.

## 0.23.8

### Patch Changes

- [#110](https://github.com/Amarsia/orcha/pull/110) [`937a3a1`](https://github.com/Amarsia/orcha/commit/937a3a196ef909c932a72005f6920d277c10a01f) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Route playground startup failures through the CLI bootstrapper so missing or outdated development tooling is installed automatically. Require the compatible playground UI release before restarting the playground.

## 0.23.7

### Patch Changes

- [#108](https://github.com/Amarsia/orcha/pull/108) [`d36cb7e`](https://github.com/Amarsia/orcha/commit/d36cb7e6c3f3858f03fbfffacc149b7f2e298a0a) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Fix playground distribution and local CLI execution:

  - Publish the prebundled playground under collision-safe asset names, preventing replacement by the similarly named TypeScript `App.js` output on case-insensitive filesystems.
  - Mark the generated CLI entry point as executable after every build so workspace and file-based installations can run `npx orcha` without manual permission changes.

- Updated dependencies [[`d36cb7e`](https://github.com/Amarsia/orcha/commit/d36cb7e6c3f3858f03fbfffacc149b7f2e298a0a)]:
  - @orchajs/playground-ui@0.2.5

## 0.23.6

### Patch Changes

- [#106](https://github.com/Amarsia/orcha/pull/106) [`a70132d`](https://github.com/Amarsia/orcha/commit/a70132d64bdcfb8278d845f945b560438b08d8ee) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Generate session IDs with filesystem-safe `HH-MM-SS` timestamps so JSONL session storage works on Windows. Existing colon-based session IDs remain valid for backward compatibility.

## 0.23.5

### Patch Changes

- [#104](https://github.com/Amarsia/orcha/pull/104) [`ee45e5f`](https://github.com/Amarsia/orcha/commit/ee45e5fe5b375ad0e3d14f65b204e3412636c16c) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Require the Node 18-compatible playground UI release when automatically installing development tooling, preventing existing Yarn lockfiles from retaining the incompatible 0.2.3 release.

## 0.23.4

### Patch Changes

- [#102](https://github.com/Amarsia/orcha/pull/102) [`f5ca6e6`](https://github.com/Amarsia/orcha/commit/f5ca6e69a0dcc35def3c3037a5fdd7c7c772fa15) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Restore Node.js 18 and 20 installation compatibility by publishing the playground as prebundled browser assets. Playground UI libraries are now build-time dependencies and no longer install the unused Base Web, React Map GL, Mapbox, or Node 22-only JSON parser dependency tree in customer projects.

- Updated dependencies [[`f5ca6e6`](https://github.com/Amarsia/orcha/commit/f5ca6e69a0dcc35def3c3037a5fdd7c7c772fa15)]:
  - @orchajs/playground-ui@0.2.4

## 0.23.3

### Patch Changes

- [#100](https://github.com/Amarsia/orcha/pull/100) [`2ba7594`](https://github.com/Amarsia/orcha/commit/2ba75947fe3daed08fdcf0e555be6f0ae71802ab) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Install development-only playground tooling automatically on the first `orcha playground` run. The CLI detects npm, Yarn, pnpm, or Bun, records the tooling as development dependencies, and restarts the playground after installation.

  Deduplicate agents that are registered both at the project root and as subagents when syncing project metadata to Amarsia, so valid reusable-agent registries connect successfully and can ingest run telemetry.

  Keep the model's system context aligned with the actions available on every runtime turn, preventing agents from incorrectly skipping configured local actions after subagent calls.

## 0.23.2

### Patch Changes

- [#98](https://github.com/Amarsia/orcha/pull/98) [`9a49e87`](https://github.com/Amarsia/orcha/commit/9a49e87155f5e50e4bc9df18cf19cf99f2abd953) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Fix playground startup when the optional UI package is installed by resolving its ESM exports correctly. Ship the UI package with its React runtime dependencies so projects do not need to install them separately.

- Updated dependencies [[`9a49e87`](https://github.com/Amarsia/orcha/commit/9a49e87155f5e50e4bc9df18cf19cf99f2abd953)]:
  - @orchajs/playground-ui@0.2.3

## 0.23.1

### Patch Changes

- [#96](https://github.com/Amarsia/orcha/pull/96) [`f3ed653`](https://github.com/Amarsia/orcha/commit/f3ed653fca1e37152bb7d72818a5fbc997130424) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Discover and compile symlinked action, skill, and evaluation directories. The playground now also displays linked resources and connects enabled linked actions in the agent graph.

## 0.23.0

### Minor Changes

- [#94](https://github.com/Amarsia/orcha/pull/94) [`55353da`](https://github.com/Amarsia/orcha/commit/55353da0e8150ebc0d3174903d1edf015fb6a0b6) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Include privacy-safe evaluation outcomes, evaluator metadata, token usage, rubric scores, thresholds, reasoning, and evidence in Amarsia run telemetry.

## 0.22.0

### Minor Changes

- [#92](https://github.com/Amarsia/orcha/pull/92) [`f39382d`](https://github.com/Amarsia/orcha/commit/f39382d4eeb2160814e259c1b27419ef551fe9d9) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add privacy-safe asynchronous run telemetry for projects configured with an Amarsia key, including usage, latency, status, lineage, action execution details, and sanitized failure metadata across Node, browser, and React Native runtimes. Telemetry now incrementally projects each session after a single initial read, sends browser-safe payload sizes, retries delivery without delaying agent runs, heartbeats active runs so interrupted processes do not leave permanent running records, and provides `flushTelemetry()` for bounded short-lived runtime shutdowns. Provider network failures now preserve safe underlying diagnostics such as timeout, DNS, connection, and TLS causes instead of returning only `fetch failed`, and safe pre-connection failures receive one automatic retry.

## 0.21.0

### Minor Changes

- [#90](https://github.com/Amarsia/orcha/pull/90) [`363429e`](https://github.com/Amarsia/orcha/commit/363429e1d5b80901687a7c0b86312e9bb05b9822) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Run precompiled agents through the same `orchajs` import in Node, browsers,
  Next.js, Expo, and bare React Native. Add Vite, Webpack, Next.js, Expo, and
  Metro integrations, durable IndexedDB and AsyncStorage session stores,
  target-specific action compilation, and optional development-tool peers so
  production installs and client bundles exclude compiler, playground,
  platform-incompatible storage, and unselected provider dependencies.

## 0.20.3

### Patch Changes

- [#88](https://github.com/Amarsia/orcha/pull/88) [`df8bba8`](https://github.com/Amarsia/orcha/commit/df8bba839179c736f193a14fa65d7c6109fa8a94) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Document that manual and unbundled production workflows must include
  `.orcha/dist/**` in the final deployment artifact, including Serverless
  Framework package configuration and artifact verification steps.

## 0.20.2

### Patch Changes

- [#86](https://github.com/Amarsia/orcha/pull/86) [`bb00049`](https://github.com/Amarsia/orcha/commit/bb000497ba7d150aab3011a57563f1de356d7e71) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Emit a compiled runtime manifest from `orcha build` and load it automatically
  from normal `orchajs` imports in AWS Lambda and other production environments.
  This allows unbundled TypeScript deployments to omit agent source directories
  without recompiling agents at runtime.

## 0.20.1

### Patch Changes

- [#84](https://github.com/Amarsia/orcha/pull/84) [`15cc11d`](https://github.com/Amarsia/orcha/commit/15cc11dd55194abe654b8cfc1f973908b25e0b6c) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Prevent application bundlers from resolving optional QuickJS packages when a
  project uses the default native action runtime. Production sandbox builds still
  bundle QuickJS explicitly when the sandbox runtime is selected.

## 0.20.0

### Minor Changes

- [#82](https://github.com/Amarsia/orcha/pull/82) [`c3f5412`](https://github.com/Amarsia/orcha/commit/c3f541225c28772b15e86389ada094fb6b083e82) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add `orchajs/serverless`, which automatically composes Orcha into
  `serverless-esbuild` packaging and deployment builds while rejecting
  configurations that would ship the full development package.

## 0.19.0

### Minor Changes

- [#80](https://github.com/Amarsia/orcha/pull/80) [`6927ee4`](https://github.com/Amarsia/orcha/commit/6927ee45289c0ec364efa9073f8af09a768539f6) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Reduce default install and deployment weight by moving Bedrock, Google, SQLite,
  and QuickJS runtimes behind optional peer dependencies. Remove source maps from
  published builds, add package and provider bundle size budgets, and document
  production Serverless integration requirements.

## 0.18.0

### Minor Changes

- [#78](https://github.com/Amarsia/orcha/pull/78) [`1a97509`](https://github.com/Amarsia/orcha/commit/1a97509dcd8a5d7ed4656da64b5d74721c4f571c) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Support Node.js 18.20.8 as a compatibility runtime while continuing to
  recommend current LTS releases. Replace Node 20-only environment loading,
  abort-signal composition, and recursive file watching; emit Node 18-compatible
  ESM and CommonJS builds; and use Bedrock and SQLite dependency versions that
  install and run on Node 18. Keep the current Google SDK optional because its
  Google GenAI and Vertex AI adapters require Node 20 or newer.

## 0.17.0

### Minor Changes

- [#73](https://github.com/Amarsia/orcha/pull/73) [`efd2061`](https://github.com/Amarsia/orcha/commit/efd2061e226b6204e8437002be1d1bc8ca3c877a) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Publish the Orcha playground React UI as a shared package and have the Orcha playground bundle consume that package source.

## 0.16.0

### Minor Changes

- [#71](https://github.com/Amarsia/orcha/pull/71) [`acdf268`](https://github.com/Amarsia/orcha/commit/acdf2685489e07d95cfbc19ed159a937ec3e5cf8) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add Amarsia project sync support through `orcha.init({ amarsia: { key, endpoint } })`, sending sanitized structural project and agent metadata without credentials, prompts, instructions, test inputs, or action source.

## 0.15.1

### Patch Changes

- [#69](https://github.com/Amarsia/orcha/pull/69) [`3e8b2a0`](https://github.com/Amarsia/orcha/commit/3e8b2a0567e3df579aef1a67ff4b71f7d4febf51) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Point the legacy `main` package entry at the CommonJS build and advertise the
  ESM build through `module`. Older Jest and CommonJS resolvers that do not honor
  conditional exports now load Orcha without parsing ESM as CommonJS.

## 0.15.0

### Minor Changes

- [#67](https://github.com/Amarsia/orcha/pull/67) [`4ec4218`](https://github.com/Amarsia/orcha/commit/4ec4218625c842655270dc1c4b2e09f15dbfe8d0) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Publish a parallel CommonJS build and add `require` conditions for the main
  package, `orchajs/testing`, and `orchajs/esbuild` exports. TypeScript projects
  that compile to CommonJS can now import Orcha without package export errors.

## 0.14.0

### Minor Changes

- [#65](https://github.com/Amarsia/orcha/pull/65) [`a599cee`](https://github.com/Amarsia/orcha/commit/a599cee96c9887cb1c7a9c8383ecf1fc4f5e7ab1) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add an opt-in SQLite session store with JSONL migration and export commands.
  JSONL remains the default storage strategy.

## 0.13.0

### Minor Changes

- [#63](https://github.com/Amarsia/orcha/pull/63) [`22bf4f2`](https://github.com/Amarsia/orcha/commit/22bf4f2ab2b29be0e5d4a4c3d70f5673c1969990) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Auto-discover direct child folders under each agent's `actions`, `skills`, `tests`, and `evaluations` directories. Remove the skill, test, and evaluation registry files and their registration helpers. Every discovered item now supports optional `enabled: false` metadata so WIP folders can remain present without becoming active.

  Local actions now default to `execution: "local"`, and projects default to the native Node.js action runtime. Normal local actions no longer need an `execution` field or top-level `actions.runtime` configuration. Client execution and sandbox runtime remain explicit opt-ins.

  Update the built-in Playground, examples, create-orcha template, coding-agent skill, tests, and documentation for the simplified filesystem conventions. Disabled actions, skills, and evaluations remain visible as disabled in the Playground and are excluded from run graphs.

## 0.12.2

### Patch Changes

- [#61](https://github.com/Amarsia/orcha/pull/61) [`f602cc5`](https://github.com/Amarsia/orcha/commit/f602cc52d7ec857df06f0c74bd361f1f67180d30) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add an installable `orchajs` coding-agent skill with version-aware guidance for creating, configuring, testing, debugging, and operating Orcha agents. Include a self-contained framework reference for projects without a generated `orcha/AGENTS.md`, and document installation and updates through the open Skills CLI.

## 0.12.1

### Patch Changes

- [#59](https://github.com/Amarsia/orcha/pull/59) [`28c5c03`](https://github.com/Amarsia/orcha/commit/28c5c03f3e9976baafdd81e6c3923f3c12c27f04) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Preserve registered subagents when constructing isolated agent test runtimes. Tests that allow natural execution can now use `run_agent` normally and create linked durable child sessions instead of failing with an unavailable-action error. Playground session transcripts now show the underlying run error message directly beneath failed runs.

## 0.12.0

### Minor Changes

- [#57](https://github.com/Amarsia/orcha/pull/57) [`3aa1c70`](https://github.com/Amarsia/orcha/commit/3aa1c70acd459a856142e49480f79d46252a0bee) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Allow agent tests to combine mocked and live actions. Actions configured in a test continue to use deterministic mock responses, while unmocked local actions execute through their compiled runtime. Unmocked client actions are rejected because the test runner has no attached application client.

  Live-action warnings are included in terminal output, machine-readable reports, durable session events, and the Playground. Action expectations now capture both mocked client calls and live local calls.

  Test input can now reference a JSON file path relative to the test case directory. The referenced file is loaded as the normal agent input object, allowing large inputs to remain in reusable fixtures instead of being duplicated in `index.json`.

  Add a play button to test-case nodes in the Playground graph so individual tests can be started directly from the graph with loading and result status feedback.

## 0.11.0

### Minor Changes

- [#55](https://github.com/Amarsia/orcha/pull/55) [`4b0431f`](https://github.com/Amarsia/orcha/commit/4b0431fae72b39913c6be7e769a60c4982ee914f) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add the built-in `orcha playground` developer interface and migrate newly scaffolded projects to use it.

  The playground provides hot-reloaded agent discovery, instructions, actions, skills, evaluations, test execution, subagent configuration, run graphs, and a tabbed session workspace. Session transcripts render model Markdown and structured JSON, expose action, skill, evaluation, and subagent events, and allow navigation into child sessions.

  Session lists and open transcripts now update live when JSONL files change, including writes made by other processes. Running sessions display an activity indicator, evaluation rows expose their passed or failed result without expansion, transcripts follow the latest event automatically, and wide JSON or code content can be scrolled horizontally.

  The local playground server includes host and origin validation, mutation-token protection, paginated session APIs, and server-sent event streams for parent and subagent sessions. Playground UI dependencies remain development-only and are not included in user application bundles.

  `create-orcha` projects now use the built-in playground instead of shipping a separate frontend and server implementation.

## 0.10.0

### Minor Changes

- [#53](https://github.com/Amarsia/orcha/pull/53) [`6c0d217`](https://github.com/Amarsia/orcha/commit/6c0d2177156c8f4e527e9e7906cd59ec1a789fcc) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add `orcha playground`, a bundled localhost React and Base Web interface for
  exploring registered agents, source instructions, actions, skills,
  evaluations, model-backed tests, durable sessions, live execution events, and
  linked subagent transcripts.

  Include a dedicated subagent list tab and role-labelled, compact Cursor-style
  trace disclosures for model reasoning, tool responses, actions, skills,
  evaluations, and client waits.

  Render model reasoning and text responses as Markdown while preserving
  structured model output as formatted JSON.

  Add a per-agent topology graph connecting the main agent to its registered
  skills, test cases, actions, evaluations, and subagents, powered by React Flow
  with panning, zoom, fit-to-view, workflow edges, readable rectangular nodes,
  and a run-oriented hierarchy.

  Expose lineage-checked `agent.subagentEvents()` alongside
  `subagentHistory()` so observability interfaces can render a child's complete
  reasoning, action, skill, evaluation, and message timeline.

  The playground hot reloads `orcha/**`, reports invalid edits in the interface,
  loads credentials through the standalone CLI, and is excluded from production
  `orcha build` output.

  Protect paid model, action, and test execution routes with strict host and
  same-origin validation plus a per-process mutation token.

  Simplify new `create-orcha` projects to use the built-in playground instead of
  shipping and maintaining a generated server, HTML, CSS, frontend JavaScript,
  or playground build pipeline.

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
