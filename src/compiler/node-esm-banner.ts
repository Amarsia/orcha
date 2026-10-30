/** Lets esbuild's Node ESM output resolve dynamic `require()` of built-ins. */
export const nodeEsmRequireBanner = [
  'import { createRequire as __orchaCreateRequire } from "node:module";',
  "const require = __orchaCreateRequire(import.meta.url);",
].join("\n");
