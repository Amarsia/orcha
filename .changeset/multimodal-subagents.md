---
"orchajs": patch
"create-orcha": patch
---

Allow `run_agent` to accept the same text and multimodal content input as a
normal agent run. Parent agents can forward local files, URLs, images, audio,
video, and mixed content to linked child sessions. Local paths resolve from
the configured Orcha project root without copying encoded bytes into tool
arguments or logs.
