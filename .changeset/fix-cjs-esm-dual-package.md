---
"orchajs": minor
---

Enable zero-bundler-config initialization across Node.js, Next.js, React, and React Native/Expo, automatic `prebuild`/`predev` compilation hooks, and fix the CJS/ESM dual-package singleton hazard:

- **Zero-config Node.js & Next.js server initialization**: `orcha.init()` compiles `orcha/` automatically on the spot when no precompiled `.orcha/dist/manifest.json` exists — including in production if `.orcha/dist/manifest.json` was not prebuilt and `orcha/` is deployed alongside the server.
- **Zero-config Browser & React Native**: `orchajs init`, `orchajs dev`, `orchajs build`, and Node `orcha.init()` sync the compiled manifest directly into `orchajs`'s runtime manifest module (`compiled-manifest.js`) and `globalThis`, so `import { orcha } from "orchajs"` works in React, Next.js client components, and React Native / Expo with zero bundler configuration.
- **Automatic framework target detection & lifecycle hooks**: `orchajs build` and `orchajs dev` auto-detect Next.js, Vite/React, and React Native/Expo targets from the project, and `orchajs init` wires `prebuild` and `predev` in `package.json` so `npm run build` and `npm run dev` compile Orcha automatically.
- **Shared `globalThis` singletons**: Store `orcha` runtime singletons (`Symbol.for("orchajs.runtime")`), compiler hooks, runtime contexts, and build queues on `globalThis` so ESM (`dist/`) and CommonJS (`dist-cjs/`) always share the exact same state in the same Node process.
