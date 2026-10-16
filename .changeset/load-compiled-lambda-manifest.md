---
"orchajs": patch
---

Emit a compiled runtime manifest from `orcha build` and load it automatically
from normal `orchajs` imports in AWS Lambda and other production environments.
This allows unbundled TypeScript deployments to omit agent source directories
without recompiling agents at runtime.
