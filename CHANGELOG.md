# orchajs

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
