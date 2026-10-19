---
"orchajs": patch
"@orchajs/playground-ui": patch
---

Restore Node.js 18 and 20 installation compatibility by publishing the playground as prebundled browser assets. Playground UI libraries are now build-time dependencies and no longer install the unused Base Web, React Map GL, Mapbox, or Node 22-only JSON parser dependency tree in customer projects.
