# create-orcha

## 0.1.6

### Patch Changes

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

## 0.1.5

### Patch Changes

- [#49](https://github.com/Amarsia/orcha/pull/49) [`6cf947e`](https://github.com/Amarsia/orcha/commit/6cf947e032984cd300df80b89d77c52b69067213) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Organize durable JSONL logs by agent and include a compact, sortable UTC timestamp
  in generated session IDs. Default Node storage now writes sessions to
  `.orcha/sessions/<agentName>/ses_<timestamp>_<uuid>.jsonl`, including test
  sessions and private subagent sessions. Existing flat session logs remain
  readable and resumable in their original location.

## 0.1.4

### Patch Changes

- [#47](https://github.com/Amarsia/orcha/pull/47) [`0d85800`](https://github.com/Amarsia/orcha/commit/0d8580052362535fa961b3f385cb175fa7d8a4ba) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Allow `run_agent` to accept the same text and multimodal content input as a
  normal agent run. Parent agents can forward local files, URLs, images, audio,
  video, and mixed content to linked child sessions. Local paths resolve from
  the configured Orcha project root without copying encoded bytes into tool
  arguments or logs.

## 0.1.3

### Patch Changes

- [#45](https://github.com/Amarsia/orcha/pull/45) [`605c6ff`](https://github.com/Amarsia/orcha/commit/605c6fffdc826a715587e166e48145b6c12c17ef) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add first-class local file and URL content inputs. Orcha now accepts
  `{ filePath }` and `{ url }` content, infers common MIME types, loads and
  encodes bytes only while constructing provider requests, and persists only
  local paths and MIME metadata in durable session history.

  Native actions now compile project-relative JavaScript and TypeScript imports,
  package imports, transitive dependencies, and Node.js built-ins into
  self-contained development and production runtimes.

## 0.1.2

### Patch Changes

- [#41](https://github.com/Amarsia/orcha/pull/41) [`0bd7319`](https://github.com/Amarsia/orcha/commit/0bd7319b55dc55f536dcb1da8792b7a7d912891a) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Compile native local actions for Node.js so trusted actions can import built-in
  modules such as `node:fs`, and configure the development playground and newly
  generated projects to use native action execution.

## 0.1.1

### Patch Changes

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

## 0.1.0

### Minor Changes

- Launch the `create-orcha` project generator with support for both
  `npm create orcha@latest` and `npx create-orcha`.

  Generated projects include a complete Node.js and TypeScript application,
  three example agents, durable session inspection, server and client actions,
  lazy-loaded skills, deterministic tests, model-graded evaluations, multimodal
  input, production scripts, and the framework-free Orcha playground.
  The generated `orcha/AGENTS.md` contains the complete canonical project guide
  used by `orcha init`, covering every supported convention and runtime contract.

  The dependency-free CLI validates destinations before writing, never
  overwrites non-empty directories, substitutes a valid npm project name and
  compatible `orchajs` release, and safely avoids nested Git repositories. It
  does not install dependencies or generate `node_modules`; developers retain
  control of installation. Git initialization can be disabled with `--no-git`.
