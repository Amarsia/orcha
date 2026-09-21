# __PROJECT_NAME__

A complete OrchaJS starter with example agents and the built-in local
playground for inspecting, testing, and running them.

## Get started

```bash
cp .env.example .env
# Add OPENAI_API_KEY to .env
npm run dev
```

Open [http://localhost:4310](http://localhost:4310).

Try the general `assistant`, ask `orderSupport` about `ord_1001`, `ord_1002`,
or an unknown order identifier, or ask `approvalAgent` to approve a purchase
to exercise the client-action pause and continuation flow.

## Included workflows

- List registered agents and their capabilities.
- Inspect model configuration, actions, skills, and evaluations.
- Start runs from text or a complete multimodal `MessageContent[]` JSON array.
- Start a durable run and stream cumulative output.
- Delegate order questions from `assistant` to a linked `orderSupport` child
  session.
- Continue an existing session with another message.
- Inspect parent and child session histories independently.
- Submit results when an agent pauses for client actions.
- Browse sessions and projected history.
- Inspect usage, status, and chronological durable session traces.
- Wait for and display asynchronous evaluations when configured.
- Run the selected agent's registered model-backed tests with one click.

The browser has no direct filesystem or provider access. `orcha playground`
binds to localhost, loads `.env`, watches `orcha/**`, and reports invalid edits
in the interface.

## Commands

```bash
npm run dev          # built-in playground with hot reload
npm run build        # production agent bundle only
npm test             # run all registered agent tests
npm run orcha:dev    # validate and watch the Orcha registry
npm run orcha:test   # run registered agent tests
```

The default Node configuration stores sessions in
`.orcha/sessions/<agentName>/ses_<timestamp>_<uuid>.jsonl`. The
playground accesses sessions through storage-neutral agent APIs, so changing
the storage adapter does not require generated application code.
