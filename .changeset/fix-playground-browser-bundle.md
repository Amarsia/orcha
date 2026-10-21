---
"orchajs": patch
"@orchajs/playground-ui": patch
---

Fix playground distribution and local CLI execution:

- Publish the prebundled playground under collision-safe asset names, preventing replacement by the similarly named TypeScript `App.js` output on case-insensitive filesystems.
- Mark the generated CLI entry point as executable after every build so workspace and file-based installations can run `npx orcha` without manual permission changes.
