---
"orchajs": minor
---

Add Amazon Bedrock as a built-in provider through AWS's ConverseStream API.

Agents can select `"bedrock"` and provide a Bedrock model ID, inference-profile
ID, or ARN while retaining the same Orcha run, streaming, session, action, and
resume APIs used by every other provider. The adapter uses Bedrock's common
message and tool contract so compatible Claude, Nova, Llama, Mistral, Cohere,
and other hosted model families can share one integration.

Bedrock uses the standard AWS credential chain by default, including local AWS
profiles, environment credentials, container credentials, and attached IAM
roles. Applications can alternatively provide an access key, secret key, and
optional session token explicitly.

The adapter normalizes streamed text, reasoning text and signatures, fragmented
tool inputs, tool results, structured JSON output, cache usage, finish reasons,
and provider errors. User-supplied reasoning effort values are forwarded
unchanged for adaptive-thinking Anthropic models.

Production builds include the AWS SDK and credential chain only when a compiled
agent uses Bedrock. A security-compliance scenario is included in the
development playground.
