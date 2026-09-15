---
"orchajs": patch
---

Run registered agent evaluations asynchronously.

Completed agent runs now resolve `execution.result` without waiting for LLM
judges. Applications can optionally await `execution.evaluations`, while agent
tests continue to await all registered evaluations and enforce their metric
thresholds. Evaluation lifecycle events and results remain durably persisted
in the session log.
