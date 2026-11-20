---
"orchajs": patch
---

Optimize direct provider adapters and Amarsia Gateway client for lower latency, connection/credential reuse, and multi-turn prompt caching parity:

- Add shared `ClientPool<T>` LRU pool and reuse SDK clients across turns and parallel subagents in `vertex-ai`, `google-genai`, and `bedrock`.
- Map default and explicit reasoning levels to model-appropriate Gemini `thinkingConfig` (`thinkingLevel` for Gemini 3.x, `thinkingBudget` for Gemini 2.5.x, omitted for non-thinking models).
- Add consistent provider request timeout handling (`src/providers/timeout.ts`) and improve transient retry/error classification.
- Preserve Amarsia Gateway prompt-cache stability, file content handling, and parallel subagent execution reliability.
