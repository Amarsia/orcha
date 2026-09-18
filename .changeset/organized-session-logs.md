---
"orchajs": minor
"create-orcha": patch
---

Organize durable JSONL logs by agent and include a compact, sortable UTC timestamp
in generated session IDs. Default Node storage now writes sessions to
`.orcha/sessions/<agentName>/ses_<timestamp>_<uuid>.jsonl`, including test
sessions and private subagent sessions. Existing flat session logs remain
readable and resumable in their original location.
