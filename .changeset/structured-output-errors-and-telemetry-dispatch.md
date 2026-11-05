---
"orchajs": patch
---

Preserve assistant messages and surface root-cause tool failures on structured output errors, and make Amarsia telemetry dispatch fully non-blocking.

- When an `outputType: "json"` agent returns plain text or invalid JSON, persist the assistant `message.created` event and token usage first, include a preview of the model's response in the error message, and surface any preceding action or subagent failures from the run.
- Distinguish action parameter validation errors from action `outputSchema` errors, surface real MCP tool error details when `isError` is returned, and safely parse non-JSON provider HTTP error bodies.
- Make `withAmarsiaTelemetry` completely non-blocking on `append()` and dispatch terminal run telemetry immediately in the background without blocking behind in-flight `running` batches.
