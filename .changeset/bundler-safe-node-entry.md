---
"orchajs": patch
---

Keep unused optional features out of the default Node bundler graph.

The compiler, provider adapters, QuickJS sandbox, MCP client, and SQLite implementation now load through runtime-only package boundaries when their corresponding feature is used. The default ESM and CommonJS entries remain compatible with zero-config `orcha.init()` while no longer requiring bundlers to resolve unused optional peers or native packages.

Add an Edge-compatible export condition, preserve the existing lazy `NodeSqliteSessionStore` API, and add consumer-bundle regression coverage for ESM, CommonJS, and zero-config runtime execution.
