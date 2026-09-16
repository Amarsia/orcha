# create-orcha

## 0.1.0

### Minor Changes

- Launch the `create-orcha` project generator with support for both
  `npm create orcha@latest` and `npx create-orcha`.

  Generated projects include a complete Node.js and TypeScript application,
  three example agents, durable session inspection, server and client actions,
  lazy-loaded skills, deterministic tests, model-graded evaluations, multimodal
  input, production scripts, and the framework-free Orcha playground.
  The generated `orcha/AGENTS.md` contains the complete canonical project guide
  used by `orcha init`, covering every supported convention and runtime contract.

  The dependency-free CLI validates destinations before writing, never
  overwrites non-empty directories, substitutes a valid npm project name and
  compatible `orchajs` release, and safely avoids nested Git repositories. It
  does not install dependencies or generate `node_modules`; developers retain
  control of installation. Git initialization can be disabled with `--no-git`.
