---
"orchajs": minor
---

Add privacy-safe asynchronous run telemetry for projects configured with an Amarsia key, including usage, latency, status, lineage, action execution details, and sanitized failure metadata across Node, browser, and React Native runtimes. Telemetry now incrementally projects each session after a single initial read, sends browser-safe payload sizes, retries delivery without delaying agent runs, heartbeats active runs so interrupted processes do not leave permanent running records, and provides `flushTelemetry()` for bounded short-lived runtime shutdowns. Provider network failures now preserve safe underlying diagnostics such as timeout, DNS, connection, and TLS causes instead of returning only `fetch failed`, and safe pre-connection failures receive one automatic retry.
