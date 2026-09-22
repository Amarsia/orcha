---
"orchajs": patch
---

Preserve registered subagents when constructing isolated agent test runtimes. Tests that allow natural execution can now use `run_agent` normally and create linked durable child sessions instead of failing with an unavailable-action error. Playground session transcripts now show the underlying run error message directly beneath failed runs.
