---
"orchajs": patch
---

Generate session IDs with filesystem-safe `HH-MM-SS` timestamps so JSONL session storage works on Windows. Existing colon-based session IDs remain valid for backward compatibility.
