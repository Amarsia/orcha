---
"orchajs": minor
---

Add registered, lazily loaded agent skills.

Agents can register skill folders through `skills/index.js`. Each skill keeps
compact discovery metadata in `index.json` and detailed procedures in
`instructions.md`. Orcha exposes the catalog through the provider-neutral
model contract and handles `load_skill` internally without executing local
code or pausing for client action results.

Loaded skills are recorded as session-scoped `skill.loaded` events and remain
active across durable `resume()` calls and provider changes. Production
bundles include only explicitly registered skills.
