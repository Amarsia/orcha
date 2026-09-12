---
"orchajs": minor
---

Add Google GenAI as a built-in provider using Google's official `@google/genai`
SDK and the Gemini Developer API.

Agents can now select `"googlegenai"` without changing Orcha's run, streaming,
session, action, or resume APIs. The adapter translates Orcha's normalized
messages, Gemini Files API and inline multimodal inputs, function declarations,
function calls and results, JSON Schema output, token usage, finish reasons,
and streamed text.

Google reasoning levels are forwarded unchanged to Gemini's `thinkingLevel`
field. Returned reasoning text and opaque thought signatures are persisted so
durable tool loops can replay Gemini responses correctly, while ordinary text
messages remain provider-neutral. Sessions can continue across Anthropic,
OpenAI, and Google models through the same normalized context projection.

Direct image and audio agent outputs remain explicit unsupported capabilities.
Gemini media input accepts base64 data URIs, Gemini Files API URIs, and Google
Cloud Storage URIs; arbitrary public URLs must be uploaded to Gemini Files
before use.

Production compilation now includes only the provider adapters selected by the
project's compiled agents, so applications that do not use Google do not bundle
the Google SDK or its dependencies.
