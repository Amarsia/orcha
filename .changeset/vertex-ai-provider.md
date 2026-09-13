---
"orchajs": minor
---

Add Vertex AI as a built-in provider using Google's official `@google/genai`
Node SDK.

Vertex agents use the same normalized messages, streaming snapshots, reasoning,
function calls, structured output, usage, durable sessions, and cross-provider
continuation contract as Gemini Developer API agents. Both Google backends now
share one Gemini protocol implementation instead of maintaining duplicate
request and response translations.

Configure Vertex with a Google Cloud project and location. Authentication uses
Google Application Default Credentials by default, including credentials
provided through `GOOGLE_APPLICATION_CREDENTIALS`. Service-account
`clientEmail` and `privateKey` values can instead be supplied explicitly in the
provider configuration.

Production compilation includes the Node SDK and Google Cloud authentication
dependencies only when a compiled agent selects `"vertexai"`. Other provider
bundles remain unaffected.

The development playground includes a Vertex-powered payment-risk agent with a
sandboxed transaction lookup.
