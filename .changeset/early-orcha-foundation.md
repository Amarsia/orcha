---
"orchajs": minor
---

Introduce the first OrchaJS alpha foundation.

- Compile filesystem-defined agents and actions into self-contained production bundles.
- Add Anthropic model execution and structured JSON outputs.
- Add durable, append-only JSONL sessions with run and resume support.
- Support client-action pausing and tool-result submission through `resume()`.
- Add native and isolated QuickJS sandbox runtimes for local actions.
- Add multimodal input, immutable prompt variables, session names, and metadata.
- Add agent-scoped `get()`, `history()`, `list()`, and `update()` session APIs.
- Add standardized Orcha errors and sanitized public session history.
- Add automatic esbuild integration while excluding QuickJS from native bundles.
