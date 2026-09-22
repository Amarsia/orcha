---
"orchajs": minor
"create-orcha": patch
---

Allow agent tests to combine mocked and live actions. Actions configured in a test continue to use deterministic mock responses, while unmocked local actions execute through their compiled runtime. Unmocked client actions are rejected because the test runner has no attached application client.

Live-action warnings are included in terminal output, machine-readable reports, durable session events, and the Playground. Action expectations now capture both mocked client calls and live local calls.

Test input can now reference a JSON file path relative to the test case directory. The referenced file is loaded as the normal agent input object, allowing large inputs to remain in reusable fixtures instead of being duplicated in `index.json`.

Add a play button to test-case nodes in the Playground graph so individual tests can be started directly from the graph with loading and result status feedback.
