---
"orchajs": minor
"create-orcha": patch
---

Load `.env` from the project root for standalone Orcha CLI commands while
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
