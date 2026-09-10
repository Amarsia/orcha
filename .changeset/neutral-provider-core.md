---
"orchajs": minor
---

Add a provider-neutral runtime contract for built-in model adapters.

- Normalize messages, reasoning, tool calls, tool results, streaming, usage, stop reasons, and errors before they reach the runtime.
- Move Anthropic request and response translation behind the built-in provider adapter boundary.
- Persist provider-neutral assistant and tool messages while retaining compatibility with existing Anthropic-shaped session logs.
- Reject unsupported provider capabilities explicitly instead of silently degrading behavior.
