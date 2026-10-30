---
"orchajs": minor
---

Add Amarsia-managed inference and durable local-first cloud session storage
across Node.js, browser, Expo, and React Native runtimes.

- Route model requests through the Amarsia Responses gateway with native
  streaming, structured output, tool calls, reasoning replay, usage metering,
  and build-time provider pruning.
- Persist cloud sessions through an encrypted, retryable outbox with ordered
  conflict reconciliation, acknowledgement tracking, lifecycle flush APIs, and
  platform-specific durable queues.
- Record run lifecycle telemetry from invocation start through completion,
  pause, or failure, preserving accumulated usage and actionable errors.
- Normalize local and remote multimodal files, including PDF-only requests,
  across supported providers.
- Keep runtime credentials optional during compilation so production builds can
  receive secrets only when the generated application starts.
