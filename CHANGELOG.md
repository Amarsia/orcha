# orchajs

## 0.1.0-next.5

### Minor Changes

- [#18](https://github.com/Amarsia/orcha/pull/18) [`867eb34`](https://github.com/Amarsia/orcha/commit/867eb348aecb5fdc21ab56cc8d75e790893955cd) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add DeepSeek as a built-in provider through its official Chat Completions API.

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

## 0.1.0-next.4

### Minor Changes

- [#16](https://github.com/Amarsia/orcha/pull/16) [`7101aca`](https://github.com/Amarsia/orcha/commit/7101aca18c26cca44e0a10998efd6add902b98ae) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add Google GenAI as a built-in provider using Google's official `@google/genai`
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

## 0.1.0-next.3

### Minor Changes

- [#14](https://github.com/Amarsia/orcha/pull/14) [`fe75f01`](https://github.com/Amarsia/orcha/commit/fe75f01fd03e560647110a27df86287244a02123) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add OpenAI as a built-in provider through the Responses API.

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

## 0.1.0-next.2

### Minor Changes

- [#12](https://github.com/Amarsia/orcha/pull/12) [`8cbdb7d`](https://github.com/Amarsia/orcha/commit/8cbdb7d21fe7de2150321ef5b059e558e7a3b0b3) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add a provider-neutral runtime contract for built-in model adapters.

  - Normalize messages, reasoning, tool calls, tool results, streaming, usage, stop reasons, and errors before they reach the runtime.
  - Move Anthropic request and response translation behind the built-in provider adapter boundary.
  - Persist provider-neutral assistant and tool messages while retaining compatibility with existing Anthropic-shaped session logs.
  - Reject unsupported provider capabilities explicitly instead of silently degrading behavior.

## 0.1.0-next.1

### Minor Changes

- [#9](https://github.com/Amarsia/orcha/pull/9) [`dda9613`](https://github.com/Amarsia/orcha/commit/dda961364c8e7eb6da5a308303876316a592d88e) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Expand the OrchaJS runtime with durable agent sessions and local actions.

  - Support client-action pausing and tool-result submission through `resume()`.
  - Add multimodal input, immutable prompt variables, session names, and metadata.
  - Add agent-scoped `get()`, `history()`, `list()`, and `update()` session APIs.
  - Add standardized Orcha errors and sanitized public session history.
  - Compile and hash filesystem-defined local actions during project builds.
  - Add explicit native and isolated QuickJS sandbox action runtimes.
  - Exclude QuickJS from native production bundles.

## 0.1.0-next.0

### Minor Changes

- [#1](https://github.com/Amarsia/orcha/pull/1) [`bfdb9eb`](https://github.com/Amarsia/orcha/commit/bfdb9eb488311218fe8d326ca17612b264313007) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Add the first OrchaJS alpha foundation: filesystem agent compilation, an
  Anthropic runtime, durable JSONL sessions, structured outputs, and automatic
  esbuild production integration.
