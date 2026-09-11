---
"orchajs": minor
---

Add OpenAI as a built-in provider through the Responses API.

- Register OpenAI with the compiler and built-in provider dispatcher so agents can select `"provider": "openai"` without changing runtime APIs.
- Translate text, image, and file inputs plus assistant history through the provider-neutral message contract.
- Support local and client function calls, function results, multi-round tool execution, durable pause/resume, and provider-independent session logs.
- Stream cumulative text snapshots from OpenAI server-sent events while preserving the normalized final result promise.
- Support strict JSON Schema output with Orcha's existing structured-output validation.
- Pass user-supplied reasoning effort strings through unchanged, request readable reasoning summaries when configured, and persist normalized summaries with opaque replay data.
- Normalize response IDs, completion reasons, input/output/reasoning/cache token usage, refusals, API errors, and incomplete responses.
- Return a retryable failed run when a model exhausts its output-token budget instead of reporting an empty successful result.
- Preserve provider provenance so durable sessions can continue after switching models or providers.
- Share a robust server-sent event parser across the Anthropic and OpenAI adapters.
- Add integration coverage for streaming, multimodal input, structured output, reasoning, tool execution, token exhaustion, and cross-provider continuation.
