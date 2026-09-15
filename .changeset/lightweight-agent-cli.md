---
"orchajs": minor
---

Add a lightweight, agent-friendly Orcha CLI.

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
