import { resolve } from "node:path";
import {
  generatedBundlePath,
  queueRuntimeBuild,
  type RuntimeBuildTarget,
} from "./runtime-build.js";

export interface OrchaWebpackPluginOptions {
  projectRoot?: string;
  target?: RuntimeBuildTarget;
}

interface WebpackCompiler {
  hooks: {
    beforeCompile: {
      tapPromise(name: string, callback: () => Promise<void>): void;
    };
    afterCompile: {
      tap(
        name: string,
        callback: (compilation: {
          contextDependencies: Set<string>;
        }) => void,
      ): void;
    };
  };
}

export class OrchaWebpackPlugin {
  readonly #projectRoot: string;
  readonly #target: RuntimeBuildTarget;

  constructor(options: OrchaWebpackPluginOptions = {}) {
    this.#projectRoot = resolve(options.projectRoot ?? process.cwd());
    this.#target = options.target ?? "browser";
  }

  get bundlePath(): string {
    return generatedBundlePath(this.#projectRoot, this.#target);
  }

  apply(compiler: WebpackCompiler): void {
    compiler.hooks.beforeCompile.tapPromise("orchajs", async () => {
      await queueRuntimeBuild(this.#projectRoot, this.#target);
    });
    compiler.hooks.afterCompile.tap("orchajs", (compilation) => {
      compilation.contextDependencies.add(
        resolve(this.#projectRoot, "orcha"),
      );
    });
  }
}
