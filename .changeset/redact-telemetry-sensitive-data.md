---
"orchajs": patch
---

Redact sensitive values from evaluation reasoning, telemetry, and project sync.

Evaluation judges are instructed not to quote personal data, tax identifiers, financial figures, or secrets. Those values are also stripped from evaluation reasoning and evidence, run errors, and telemetry before they are stored or sent. Project sync now sends only the project directory name and removes credentials embedded in repository URLs.
