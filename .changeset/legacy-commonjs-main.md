---
"orchajs": patch
---

Point the legacy `main` package entry at the CommonJS build and advertise the
ESM build through `module`. Older Jest and CommonJS resolvers that do not honor
conditional exports now load Orcha without parsing ESM as CommonJS.
