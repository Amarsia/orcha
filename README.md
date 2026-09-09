# OrchaJS

**An agent is a folder.** OrchaJS is a filesystem-convention framework for building AI agents in JavaScript — no orchestration graph, no client to instantiate, no export step. It's a library, not a platform: add it to Next.js, React, React Native, Express, NestJS, or plain Node, the way you'd add Prisma or Zod.

> Early and moving fast. Not yet accepting external contributions — see [Status](#status) below.

---

## Why

Most agent frameworks or platforms ask you to trust a black box: the real logic lives inside someone else's runtime, and what you get to "own" is a copy or an export of it. OrchaJS removes that gap by making the file tree the actual source of truth — there's no internal state that isn't also a file you can open, edit, and run yourself.

Read the full concept: [`docs/concept.md`](./docs/concept.md)

---

## The convention

```
/agentname
  index.js | index.json     → provider, model, generation config, output schema
  instructions.md           → required base agent instructions
  /skills
    /skillname
      index.json              → { name, description, triggers }
      instructions.md           → procedural knowledge, lazy-loaded into context
  /actions
    /actionname
      index.json                → definition, schemas, and execution location
      index.js                   → executable code for local actions only
  /guardrails                     → input/output policy
  /tests                          → test cases, auto-run before every release
  /evaluations                    → metrics each run is judged against
```

Placement determines behavior. No manual registration of tools, skills, or routes.

---

## Model Action Protocol

What a model can do lives in `/actions`. Every action has `index.json`; local
actions additionally have `index.js`.

```
actions/
  send-refund/
    index.json   // the definition
    index.js      // the code
```

`index.json` tells the model what the action is, where it executes, and its
input/output contracts:

```json
{
  "name": "request_refund_approval",
  "description": "Ask the client application to approve a refund.",
  "execution": "client",
  "parameters": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string" },
      "amount": { "type": "number" }
    },
    "required": ["orderId", "amount"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "approved": { "type": "boolean" }
    },
    "required": ["approved"]
  }
}
```

Client actions pause the durable run. The application advertises only the
actions available on that client, executes the requested call, then resumes:

```js
const paused = await orcha.invoiceBot.run({
  content: "Refund order 123",
  clientCapabilities: orcha.invoiceBot.clientTools
}).result;

if (paused.status === "waiting_for_client_action") {
  const completed = await orcha.invoiceBot.resume(paused.sessionId, {
    toolResults: paused.clientToolCalls.map((call) => ({
      callId: call.callId,
      output: { approved: true }
    }))
  }).result;
}
```

Definitions are compiled from the filesystem and are not submitted again to
`resume()`. Requests and results are persisted in the session JSONL.

Local actions export their implementation from `index.js` and execute
automatically inside the model tool loop:

```js
export default async function sendRefund(parameters, context) {
  return {
    refunded: true,
    orderId: parameters.orderId,
    idempotencyKey: context.idempotencyKey,
  };
}
```

Projects with local actions must explicitly choose their runtime:

```js
orcha.init({
  actions: {
    runtime: "sandbox", // QuickJS WASM
    env: {
      REFUND_API_KEY: process.env.REFUND_API_KEY,
    },
  },
  // providers and agents...
});
```

Use `"native"` to execute compiled action JavaScript directly without the
QuickJS dependency in the production bundle. Native execution is trusted code
with full host privileges; declared permissions are only securely enforced by
the sandbox runtime. Native timeouts can reject asynchronous work but cannot
interrupt a synchronous infinite loop.

---

## Quick start

```bash
npm install orchajs
npx orcha init
```

```js
// Import the consumer registry once from the application entrypoint.
import './orcha/index.js';
import { orcha } from 'orchajs';

const execution = orcha.exampleAgent.run({
  content: 'Help me understand this invoice'
});

// Native ReadableStream frames contain the complete output generated so far.
for await (const snapshot of execution.stream) {
  console.log(snapshot);
}

// The latest cumulative snapshot is also available without consuming the stream.
console.log(execution.snapshot);

const result = await execution.result;

// Every later conversational turn uses the returned sessionId.
const followUp = await orcha.exampleAgent.resume(result.sessionId, {
  content: 'Now summarize it in one sentence'
}).result;
```

Registered agents are exposed as `orcha.<agentName>`. The first implementation
supports durable Node.js runs backed by `.orcha/sessions/<sessionId>.jsonl`.
Client-action pause/resume, compiled local actions, and cumulative output
streaming are supported.
`run()` always starts a new session; `resume()` continues one with either a new
message or pending client tool results.

Both methods accept text shorthand:

```js
const first = await orcha.exampleAgent.run("Start").result;
const second = await orcha.exampleAgent.resume(
  first.sessionId,
  "Continue",
).result;
```

Canonical input uses a multimodal `content` array:

```js
const result = await orcha.exampleAgent.run({
  content: [
    { type: "text", text: "Summarize this document" },
    {
      type: "url",
      mimeType: "application/pdf",
      fileUri: "https://example.com/report.pdf",
    },
  ],
  name: "Customer report",
  metadata: { customerId: "cus_123" },
  variables: { CUSTOMER_NAME: "Acme" },
}).result;
```

Prompt variables replace `{{CUSTOMER_NAME}}` placeholders in
`instructions.md`. They are fixed when the session is created and persisted
for deterministic continuation. Do not put secrets in prompt variables; use
provider or action environment configuration for secrets.

Sessions are managed through the same registered agent:

```js
await orcha.exampleAgent.get(sessionId);
await orcha.exampleAgent.history(sessionId, { page: 1, pageSize: 50 });
await orcha.exampleAgent.list({
  metadata: { customerId: "cus_123" },
  page: 1,
  pageSize: 20,
});
await orcha.exampleAgent.update(sessionId, {
  name: "September invoice",
  metadata: { approved: true },
});
```

For esbuild production applications, add `orchaPlugin()` from
`orchajs/esbuild` to the existing build. It compiles the registry and replaces
unchanged `orchajs` imports with the self-contained generated runtime. The
application continues to use its normal `npm run build` command.

---

## What's in this repo right now

- [x] Registry compiler + `orcha build`
- [x] Model Action Protocol — client actions and opt-in native/sandboxed local actions
- [ ] Compiler — one provider, correct tool calls + streaming
- [x] Stateful sessions — Node JSONL replay and client-action pause/resume
- [ ] `orcha.run()` one-shot entry point
- [ ] CLI (`orcha init`, `orcha build`, `orcha dev`) + example agents

See [`ROADMAP.md`](./ROADMAP.md) for what's coming after — a second provider, an evaluations runner, OpenTelemetry tracing, MCP interop adapters, and remote session storage are all deliberately out of scope for the first release.

---

## Status

This project is being built in the open by a solo maintainer. It's not yet stable enough to take contributions productively — the core convention and API are still moving. `CONTRIBUTING.md` will open up once the shape settles.

In the meantime: [star the repo](.) to follow along, open an issue if you hit something worth flagging, or watch for weekly build-in-public updates on [X/Twitter](.).

---

## License

[MIT](./LICENSE)
