---
"orchajs": minor
---

Add filesystem-convention tests for compiled agents.

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
