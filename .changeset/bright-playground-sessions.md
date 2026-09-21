---
"orchajs": minor
"create-orcha": minor
---

Add the built-in `orcha playground` developer interface and migrate newly scaffolded projects to use it.

The playground provides hot-reloaded agent discovery, instructions, actions, skills, evaluations, test execution, subagent configuration, run graphs, and a tabbed session workspace. Session transcripts render model Markdown and structured JSON, expose action, skill, evaluation, and subagent events, and allow navigation into child sessions.

Session lists and open transcripts now update live when JSONL files change, including writes made by other processes. Running sessions display an activity indicator, evaluation rows expose their passed or failed result without expansion, transcripts follow the latest event automatically, and wide JSON or code content can be scrolled horizontally.

The local playground server includes host and origin validation, mutation-token protection, paginated session APIs, and server-sent event streams for parent and subagent sessions. Playground UI dependencies remain development-only and are not included in user application bundles.

`create-orcha` projects now use the built-in playground instead of shipping a separate frontend and server implementation.
