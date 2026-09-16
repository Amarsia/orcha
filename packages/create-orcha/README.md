# create-orcha

Create a complete OrchaJS application with example agents and a lightweight
local playground.

```bash
npm create orcha@latest my-agent-app
cd my-agent-app
npm install
```

The generated project includes:

- a Node.js and TypeScript application;
- a framework-free HTML, CSS, and JavaScript playground;
- text and multimodal agent input;
- durable sessions and chronological execution traces;
- server and client actions;
- lazy-loaded skills;
- deterministic agent tests;
- model-graded evaluations;
- production build and start commands.

## Options

```text
--no-git      Do not initialize a Git repository
-h, --help    Show help
```

The CLI only writes project source files. It does not install dependencies or
generate `node_modules`, and it never overwrites a non-empty directory.
