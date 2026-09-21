---
"orchajs": minor
"create-orcha": minor
---

Add `orcha playground`, a bundled localhost React and Base Web interface for
exploring registered agents, source instructions, actions, skills,
evaluations, model-backed tests, durable sessions, live execution events, and
linked subagent transcripts.

Include a dedicated subagent list tab and role-labelled, compact Cursor-style
trace disclosures for model reasoning, tool responses, actions, skills,
evaluations, and client waits.

Render model reasoning and text responses as Markdown while preserving
structured model output as formatted JSON.

Add a per-agent topology graph connecting the main agent to its registered
skills, test cases, actions, evaluations, and subagents, powered by React Flow
with panning, zoom, fit-to-view, workflow edges, readable rectangular nodes,
and a run-oriented hierarchy.

Expose lineage-checked `agent.subagentEvents()` alongside
`subagentHistory()` so observability interfaces can render a child's complete
reasoning, action, skill, evaluation, and message timeline.

The playground hot reloads `orcha/**`, reports invalid edits in the interface,
loads credentials through the standalone CLI, and is excluded from production
`orcha build` output.

Protect paid model, action, and test execution routes with strict host and
same-origin validation plus a per-process mutation token.

Simplify new `create-orcha` projects to use the built-in playground instead of
shipping and maintaining a generated server, HTML, CSS, frontend JavaScript,
or playground build pipeline.
