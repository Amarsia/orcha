---
"orchajs": patch
"@orchajs/playground-ui": patch
---

Fix playground startup when the optional UI package is installed by resolving its ESM exports correctly. Ship the UI package with its React runtime dependencies so projects do not need to install them separately.
