---
"orchajs": minor
"create-orcha": patch
---

Add first-class durable parent and subagent orchestration.

Agents now declare a required human-readable `name` and may add an optional
`description`.
Top-level registrations may explicitly attach private subagents while the
same agent can remain independently registered and accessible through
`orcha.<agentName>`.

Parent models receive built-in tools to start, continue, and inspect only the
child sessions they initiated. Each child has an independent durable session
linked to its parent, while the parent exposes
`waiting_for_subagent` during synchronous child execution and receives child
responses as normal tool results.

Add lineage-checked `subagentHistory()`, explicit initiated, paused, resumed,
completed, and failed lifecycle events, history projections, a configurable
child-count limit that defaults to 10, and first-class `pause()` behavior.
Parent pauses cascade through active children, abort provider streams, preserve
partial assistant output, and resume as a new run with complete history.

Update the project generator with a working parent/subagent example,
subagent inspection endpoints and UI, complete documentation, and the
compatible OrchaJS release range.
