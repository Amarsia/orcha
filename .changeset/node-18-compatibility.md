---
"orchajs": minor
"create-orcha": patch
---

Support Node.js 18.20.8 as a compatibility runtime while continuing to
recommend current LTS releases. Replace Node 20-only environment loading,
abort-signal composition, and recursive file watching; emit Node 18-compatible
ESM and CommonJS builds; and use Bedrock and SQLite dependency versions that
install and run on Node 18. Keep the current Google SDK optional because its
Google GenAI and Vertex AI adapters require Node 20 or newer.
