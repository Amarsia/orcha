---
"orchajs": minor
---

Add privacy-safe asynchronous run telemetry for projects configured with an Amarsia key, including usage, latency, status, lineage, action execution details, and sanitized failure metadata across Node, browser, and React Native runtimes. Telemetry now incrementally projects each session after a single initial read, sends browser-safe payload sizes, retries delivery without delaying agent runs, and provides `flushTelemetry()` for bounded short-lived runtime shutdowns.
