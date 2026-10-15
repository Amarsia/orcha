---
"orchajs": patch
---

Prevent application bundlers from resolving optional QuickJS packages when a
project uses the default native action runtime. Production sandbox builds still
bundle QuickJS explicitly when the sandbox runtime is selected.
