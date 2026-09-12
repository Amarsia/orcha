---
"orchajs": minor
---

Add DeepSeek as a built-in provider through its official Chat Completions API.

Agents can select `"deepseek"` while retaining the same Orcha run, streaming,
session, action, and resume APIs used by every other provider. The adapter
normalizes streamed text, plaintext reasoning, fragmented function calls,
tool results, JSON output, token usage, cache usage, finish reasons, and
provider errors.

When `reasoningLevel` is configured, its value is forwarded unchanged as
DeepSeek's `reasoning_effort` and thinking mode is enabled. DeepSeek reasoning
content is stored as normalized text and replayed in subsequent tool and
conversation turns as required by the provider.

DeepSeek currently accepts text input and text or JSON agent output through
Orcha. Unsupported multimodal input and direct image or audio output fail
explicitly instead of being silently transformed.

Production builds include the DeepSeek adapter only when a compiled agent uses
it. A DeepSeek Reasoner incident-analysis scenario is included in the
development playground.
