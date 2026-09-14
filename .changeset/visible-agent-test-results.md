---
"orchajs": patch
---

Make agent test outcomes visible and durable. Build output now lists every
registered test with its status, duration, and session ID. Test executions use
`ses_test_` session IDs, write alongside normal session JSONL files, and append
a `test.completed` event containing the suite identity and assertion results.
