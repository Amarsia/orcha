---
"orchajs": patch
---

Fix CJS/ESM dual-package singleton hazard during `buildProject()` across Next.js (`withOrcha`), Metro/Expo (`withOrchaMetro`), Webpack (`OrchaWebpackPlugin`), and esbuild (`orchaPlugin`) integrations by storing compiler hooks, the shared Node `orcha` singleton, runtime contexts, and build queues on `globalThis` via `Symbol.for(...)`, and resolving generated production runtime entry imports to the ESM `dist/` output when invoked from `dist-cjs/`.
