---
"orchajs": minor
---

Add configurable OpenTelemetry data capture controls, a redaction hook, and standard `OTEL_*` environment variable defaults:

- Add `telemetry.otel.capture` (`{ content: false, actionIO: false, evaluationDetail: true }`) to opt into `gen_ai.input.messages` / `gen_ai.output.messages` and `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result`, or suppress evaluation explanations/evidence while preserving privacy-safe defaults.
- Add `telemetry.otel.redact(value, context)` to transform or strip captured attributes before export.
- Support standard OpenTelemetry environment defaults (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`, `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`), `telemetry.otel.serviceName` / `resourceAttributes`, and `telemetry: { otel: false }` to disable auto-configuration, with explicit config always taking precedence.
- Document every resource, span, attribute, and event emitted per span type in `README.md`.
