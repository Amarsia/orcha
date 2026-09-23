---
"orchajs": minor
"create-orcha": minor
---

Auto-discover direct child folders under each agent's `actions`, `skills`, `tests`, and `evaluations` directories. Remove the skill, test, and evaluation registry files and their registration helpers. Every discovered item now supports optional `enabled: false` metadata so WIP folders can remain present without becoming active.

Local actions now default to `execution: "local"`, and projects default to the native Node.js action runtime. Normal local actions no longer need an `execution` field or top-level `actions.runtime` configuration. Client execution and sandbox runtime remain explicit opt-ins.

Update the built-in Playground, examples, create-orcha template, coding-agent skill, tests, and documentation for the simplified filesystem conventions. Disabled actions, skills, and evaluations remain visible as disabled in the Playground and are excluded from run graphs.
