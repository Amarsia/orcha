---
"orchajs": minor
---

Improve the Orcha development and inspection contract:

- Add dedicated evaluator instructions so evaluations can keep a short human-facing description separate from the detailed judge prompt. Existing configurations continue to use `description` as a fallback.
- Add `agent.events()` for paginated access to canonical durable session events through the configured storage adapter, allowing observability and debugging interfaces to remain independent of JSONL or any other persistence strategy.
- Add `listTests()` discovery with complete registered test definitions for development interfaces.
- Report an explicit OpenAI error when structured output exhausts `max_output_tokens` before producing valid JSON.
