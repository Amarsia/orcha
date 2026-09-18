# __PROJECT_NAME__

A complete OrchaJS starter with example agents and a lightweight local
playground for running them and inspecting their durable sessions.

## Get started

```bash
cp .env.example .env
# Add OPENAI_API_KEY to .env
npm run dev
```

Open [http://127.0.0.1:4310](http://127.0.0.1:4310).

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
- Inspect usage, status, and canonical durable session events.
- Wait for and display asynchronous evaluations when configured.
- Run the selected agent's registered model-backed tests with one click.

The browser has no direct filesystem or provider access. A localhost-only Node
server owns Orcha and exposes a small JSON/NDJSON API. There is no frontend
framework, database, authentication layer, or hosted dependency.

## Commands

```bash
npm run dev          # local server with file watching
npm run build        # production bundle
npm start            # run the production bundle
npm run orcha:dev    # validate and watch the Orcha registry
npm run orcha:test   # run registered agent tests
```

The default Node configuration stores sessions in `.orcha/sessions`. The
playground accesses parent sessions through `agent.list()`, `agent.get()`, and
`agent.events()`, and child sessions through `agent.subagentHistory()`, so
changing the storage adapter does not require UI or server changes.
