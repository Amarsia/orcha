# @orchajs/playground-ui

## 0.2.5

### Patch Changes

- [#108](https://github.com/Amarsia/orcha/pull/108) [`d36cb7e`](https://github.com/Amarsia/orcha/commit/d36cb7e6c3f3858f03fbfffacc149b7f2e298a0a) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Fix playground distribution and local CLI execution:

  - Publish the prebundled playground under collision-safe asset names, preventing replacement by the similarly named TypeScript `App.js` output on case-insensitive filesystems.
  - Mark the generated CLI entry point as executable after every build so workspace and file-based installations can run `npx orcha` without manual permission changes.

## 0.2.4

### Patch Changes

- [#102](https://github.com/Amarsia/orcha/pull/102) [`f5ca6e6`](https://github.com/Amarsia/orcha/commit/f5ca6e69a0dcc35def3c3037a5fdd7c7c772fa15) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Restore Node.js 18 and 20 installation compatibility by publishing the playground as prebundled browser assets. Playground UI libraries are now build-time dependencies and no longer install the unused Base Web, React Map GL, Mapbox, or Node 22-only JSON parser dependency tree in customer projects.

## 0.2.3

### Patch Changes

- [#98](https://github.com/Amarsia/orcha/pull/98) [`9a49e87`](https://github.com/Amarsia/orcha/commit/9a49e87155f5e50e4bc9df18cf19cf99f2abd953) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Fix playground startup when the optional UI package is installed by resolving its ESM exports correctly. Ship the UI package with its React runtime dependencies so projects do not need to install them separately.

## 0.2.2

### Patch Changes

- [#80](https://github.com/Amarsia/orcha/pull/80) [`6927ee4`](https://github.com/Amarsia/orcha/commit/6927ee45289c0ec364efa9073f8af09a768539f6) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Reduce default install and deployment weight by moving Bedrock, Google, SQLite,
  and QuickJS runtimes behind optional peer dependencies. Remove source maps from
  published builds, add package and provider bundle size budgets, and document
  production Serverless integration requirements.

## 0.2.1

### Patch Changes

- [#76](https://github.com/Amarsia/orcha/pull/76) [`135a5fe`](https://github.com/Amarsia/orcha/commit/135a5fe4e1f3f45ba5a52df1dbbecd6c77720a4c) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Publish compiled JavaScript and TypeScript declarations instead of raw TSX source.

## 0.2.0

### Minor Changes

- [#73](https://github.com/Amarsia/orcha/pull/73) [`efd2061`](https://github.com/Amarsia/orcha/commit/efd2061e226b6204e8437002be1d1bc8ca3c877a) Thanks [@anuj-sia](https://github.com/anuj-sia)! - Publish the Orcha playground React UI as a shared package and have the Orcha playground bundle consume that package source.
