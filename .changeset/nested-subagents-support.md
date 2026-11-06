---
"orchajs": patch
---

Support nested subagent chains and cycle detection across the compiler, runtime, and test runner.

- When an agent is referenced as a subagent of another agent, automatically inherit its own declared `subagents` and `mcp` registrations (or allow inline nested `subagents` declarations).
- Recursively instantiate nested `RuntimeAgent` subagent trees in `orcha.init()` and `orcha.runTests()`, and allow `subagentHistory()` / `subagentEvents()` to inspect descendant sessions across the hierarchy.
- Detect and reject circular subagent chains (`A -> B -> C -> A`) at compile and initialization time.
