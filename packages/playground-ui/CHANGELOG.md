# @orchajs/playground-ui

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
