---
"orchajs": patch
---

Install development-only playground tooling automatically on the first `orcha playground` run. The CLI detects npm, Yarn, pnpm, or Bun, records the tooling as development dependencies, and restarts the playground after installation.

Deduplicate agents that are registered both at the project root and as subagents when syncing project metadata to Amarsia, so valid reusable-agent registries connect successfully and can ingest run telemetry.

Keep the model's system context aligned with the actions available on every runtime turn, preventing agents from incorrectly skipping configured local actions after subagent calls.
