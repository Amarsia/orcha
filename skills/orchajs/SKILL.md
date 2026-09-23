---
name: orchajs
description: Build, configure, test, debug, and operate durable AI agents with OrchaJS. Use when a project imports orchajs, contains an orcha directory, or uses the orcha init, dev, run, test, build, or playground commands.
---

# OrchaJS

Use the Orcha version installed in the user's project as the source of truth.

## Establish local truth

1. Read the project's `package.json` to identify its installed `orchajs`
   version.
2. Read `orcha/AGENTS.md` before changing Orcha source. It is generated for the
   installed framework version and documents current configuration, runtime,
   event, testing, evaluation, skill, and subagent contracts.
3. If that guide is absent, read [REFERENCE.md](REFERENCE.md) before making
   changes. It contains the complete baseline needed to work in an Orcha
   project.
4. Confirm exact installed-version details in `node_modules/orchajs/README.md`
   and the declarations under `node_modules/orchajs/dist` when available.
5. Follow local project instructions when they are stricter than this skill.

Do not invent fields or rely on remembered Orcha APIs when local documentation
or types are available.

## Work in this order

1. Inspect `orcha/index.ts` and the relevant registered agent folders.
2. Identify whether the task changes configuration, instructions, actions,
   skills, tests, evaluations, subagents, or application integration.
3. Make the smallest complete change while preserving provider-neutral runtime
   behavior.
4. Update registrations whenever adding an agent, skill, test, or evaluation.
5. Validate with the narrowest relevant offline command first.
6. Explain before running commands that invoke providers, consume tokens, or
   execute live actions.

## Filesystem conventions

An agent commonly contains:

```text
orcha/
  index.ts
  agentName/
    index.json
    instructions.md
    actions/
    skills/
    tests/
    evaluations/
```

- `orcha/index.ts` initializes providers and explicitly registers agents and
  private subagents.
- `index.json` contains model-facing configuration.
- `instructions.md` contains stable agent behavior and boundaries.
- Actions have aligned metadata, schemas, and implementations.
- Skills, tests, and evaluations are included through their local registries.
- Credentials belong in environment variables, never committed configuration,
  prompts, metadata, fixtures, or session logs.

## Runtime rules

- `agent.run()` creates a new durable session.
- `agent.resume(sessionId, ...)` continues an existing session.
- Resolve every pending client-action call exactly once using its returned
  `callId`.
- Local actions execute through the configured native or sandbox runtime.
  Client actions execute in the calling application.
- Parent agents may invoke only explicitly registered subagents. Parent and
  child sessions remain separate and linked.
- Use agent session APIs for history, events, listing, pause, and resume.
  Never read or modify `.orcha` storage directly in application code.
- Do not edit generated files under `.orcha/`.

## Tests and evaluations

- Tests use the real compiled agent and provider.
- Configured action responses are mocks. Unmocked local actions execute live
  and may cause side effects; client actions require mocks.
- Test `input` may be an inline agent input object or a JSON path relative to
  the test case directory.
- Evaluations are asynchronous model-graded checks. Await evaluation results
  when the caller must gate completion on them.
- Keep deterministic contract assertions in `tests/` and probabilistic quality
  scoring in `evaluations/`.

## Commands

```bash
# Offline validation and watch
npx orcha dev

# Local inspection and execution UI
npx orcha playground

# Real provider execution
npx orcha run <agent> --input "..."

# Real provider tests; may consume tokens and run live actions
npx orcha test [agent[/case]]

# Offline production compilation
npx orcha build
```

Use existing project scripts when they wrap these commands.

## Completion checklist

- New filesystem entries are explicitly registered.
- Schemas, implementations, and instructions agree.
- No credentials or generated session data were added.
- Provider-consuming or side-effecting verification was not run silently.
- Verification performed and omitted is reported clearly.
