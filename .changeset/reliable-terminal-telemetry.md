---
"orchajs": patch
---

Ensure terminal telemetry is projected and dispatched before completed runs return, and make `flushTelemetry()` wait for pending projections so successful runs are not later marked as interrupted.
