import { resolve } from "node:path";
import type { Plugin } from "esbuild";
import { buildProject } from "../compiler/build-project.js";

export interface OrchaEsbuildPluginOptions {
  projectRoot?: string;
}

/**
 * Compiles the consumer's Orcha registry and replaces unchanged `orchajs`
 * application imports with the self-contained generated production runtime.
 */
export function orchaPlugin(
  options: OrchaEsbuildPluginOptions = {},
): Plugin {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const generatedBundle = resolve(projectRoot, ".orcha/dist/bundle.js");

  return {
    name: "orchajs",
    setup(builder) {
      builder.onStart(async () => {
        await buildProject({ projectRoot });
      });

      builder.onResolve({ filter: /^orchajs$/ }, () => ({
        path: generatedBundle,
      }));
    },
  };
}
