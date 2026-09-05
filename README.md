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
  index.js | index.json     → provider, model, system prompt, output schema
  /skills
    /skillname
      index.json              → { name, description, triggers }
      instruction.md            → procedural knowledge, lazy-loaded into context
  /actions
    /actionname
      index.json                → definition — name, params, when to use it
      index.js                   → the code — what actually runs
  /guardrails                     → input/output policy
  /tests                          → test cases, auto-run before every release
  /evaluations                    → metrics each run is judged against
```

Placement determines behavior. No manual registration of tools, skills, or routes.

---

## Model Action Protocol

What a model can do lives in `/actions`. Each action is a folder with two files — no server, no protocol handshake, no dependency to install.

```
actions/
  send-refund/
    index.json   // the definition
    index.js      // the code
```

`index.json` — tells the model what the action is and when to use it:

```json
{
  "name": "send_refund",
  "description": "Issues a refund for an order. Use when a customer asks for money back and the order qualifies.",
  "params": {
    "orderId": "string",
    "amount": "number"
  }
}
```

`index.js` — the function that runs when the model calls it, in your own code:

```js
export default async function sendRefund(params, ctx) {
  const key = ctx.env.STRIPE_SECRET_KEY;
  // call Stripe, hit your own API, query your own DB — whatever this needs
  return { refunded: true, orderId: params.orderId };
}
```

No MCP server to stand up, no SDK to pull in, no integration to configure. If you can write the function, the model can call it. Actions run sandboxed with declared permissions (network, env access), the same way in Node or the browser.

---

## Quick start

```bash
npm install orcha
```

```js
import orcha from 'orcha';

// one-shot — structured input to structured output, no session to manage
const result = await orcha.run('./agents/classifier', { text: 'refund my order' });

// durable — pause, resume, pick up anywhere
const { sessionId } = await orcha.agent.run('./agents/support-agent', input);
// ...later, any process...
const next = await orcha.agent.resume(sessionId, humanReply);
```

`orcha.run()` — single call, no state to think about. Can still call actions; can't pause.
`orcha.agent.run()` / `orcha.agent.resume()` — the durable version. Tool calls, context, and any pending human-in-the-loop step persist automatically, locally by default.

---

## What's in this repo right now

- [ ] File convention parser + `orcha build`
- [ ] Model Action Protocol — schema, sandboxed execution
- [ ] Compiler — one provider, correct tool calls + streaming
- [ ] Stateful sessions — local, `agent.run` / `agent.resume`, human-in-the-loop
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
