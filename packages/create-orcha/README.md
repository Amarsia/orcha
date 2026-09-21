# create-orcha

Create a complete OrchaJS project with example agents and the built-in local
playground.

```bash
npm create orcha@latest my-agent-app
cd my-agent-app
npm install
```

The generated project includes:

- an Orcha agent registry with example agents;
- `orcha playground` for a hot-reloading local interface;
- text and multimodal agent input;
- durable sessions and chronological execution traces;
- parent agents with private durable subagents;
- server and client actions;
- lazy-loaded skills;
- deterministic agent tests;
- model-graded evaluations;
- a production agent build command that excludes playground assets.

## Options

```text
--no-git      Do not initialize a Git repository
-h, --help    Show help
```

The CLI only writes project source files. It does not install dependencies or
generate `node_modules`, and it never overwrites a non-empty directory.
