---
"orchajs": minor
---

Add registered LLM-judged agent evaluations.

Agents can register evaluation folders through `evaluations/index.js`. Each
evaluation defines its judge provider and model alongside predefined metrics
and score thresholds. Enabled evaluations score the cumulative durable session
after every completed run and return normalized scores, reasoning, evidence,
usage, and pass status separately from the agent result.

Evaluation lifecycle and results are persisted as durable session events.
Registered evaluations also run during agent tests, where judge errors and
missed metric thresholds fail the test without changing production agent
completion semantics.
