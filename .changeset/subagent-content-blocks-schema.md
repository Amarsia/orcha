---
"orchajs": patch
---

Align `run_agent` and `resume_agent` tool schemas with `agent.run({ content })` using a clear `content[]` block array supporting text, structured JSON (`{ type: "json", data }`), and multimodal file/URL/media blocks, while preserving backward compatibility for legacy `input` calls.
