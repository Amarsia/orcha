---
"orchajs": minor
---

Request and persist provider-returned reasoning text without enabling
reasoning by default.

Google GenAI and Vertex AI now request thought summaries without overriding
the model's reasoning level. OpenAI requests automatic reasoning summaries and
replay metadata without setting an effort level.

Anthropic and DeepSeek continue to enable reasoning only when an agent supplies
`reasoningLevel`. User-supplied values pass through unchanged. Every adapter
stores reasoning text whenever its provider returns it, allowing reasoning
token usage to be matched with the available provider-exposed explanation.
