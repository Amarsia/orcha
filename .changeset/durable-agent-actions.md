---
"orchajs": minor
---

Expand the OrchaJS runtime with durable agent sessions and local actions.

- Support client-action pausing and tool-result submission through `resume()`.
- Add multimodal input, immutable prompt variables, session names, and metadata.
- Add agent-scoped `get()`, `history()`, `list()`, and `update()` session APIs.
- Add standardized Orcha errors and sanitized public session history.
- Compile and hash filesystem-defined local actions during project builds.
- Add explicit native and isolated QuickJS sandbox action runtimes.
- Exclude QuickJS from native production bundles.
