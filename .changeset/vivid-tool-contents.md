---
"orchajs": minor
"create-orcha": patch
---

Add multimodal tool result contents for local and client actions.

- Local actions can return `{ output, contents }` so structured JSON stays
  schema-validated while media and other content items are forwarded to the
  model.
- Client action resumes accept optional `contents` alongside `output`, with the
  same envelope persisted in session events and provider adapters.
- Propagate multimodal tool contents through Amarsia-managed inference for
  OpenAI, Anthropic, and Google, and surface a clear
  `unsupported_content_type` error when DeepSeek receives non-text contents.
- Update AGENTS.md guidance and the playground `visualInspector` agent so the
  multimodal envelope is easy to exercise end to end.
