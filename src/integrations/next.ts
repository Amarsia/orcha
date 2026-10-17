import { resolve } from "node:path";
import {
  generatedBundlePath,
  queueRuntimeBuild,
  watchRuntimeTargets,
  type RuntimeBuildTarget,
} from "./runtime-build.js";
import { OrchaWebpackPlugin } from "./webpack.js";

export interface OrchaNextOptions {
  projectRoot?: string;
}

interface NextWebpackContext {
  isServer: boolean;
  nextRuntime?: string;
}

interface WebpackConfiguration {
  plugins?: unknown[];
  resolve?: {
    alias?: Record<string, unknown>;
  };
}

interface NextConfiguration {
  turbopack?: {
    resolveAlias?: Record<string, unknown>;
    [key: string]: unknown;
  };
  webpack?: (
    configuration: WebpackConfiguration,
    context: NextWebpackContext,
  ) => WebpackConfiguration;
  [key: string]: unknown;
}

export async function withOrcha<T extends NextConfiguration>(
  configuration: T = {} as T,
  options: OrchaNextOptions = {},
): Promise<T> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  await queueRuntimeBuild(projectRoot, "browser");
  await queueRuntimeBuild(projectRoot, "node");
  if (process.env.NODE_ENV !== "production") {
    watchRuntimeTargets(projectRoot, ["browser", "node"]);
  }
  const existingWebpack = configuration.webpack;
  return {
    ...configuration,
    turbopack: {
      ...configuration.turbopack,
      resolveAlias: {
        ...configuration.turbopack?.resolveAlias,
        orchajs: {
          browser: generatedBundlePath(projectRoot, "browser"),
        },
      },
    },
    webpack(webpackConfiguration, context) {
      const target = nextTarget(context);
      if (target === "node") {
        return existingWebpack
          ? existingWebpack(webpackConfiguration, context)
          : webpackConfiguration;
      }
      const plugin = new OrchaWebpackPlugin({
        projectRoot,
        target,
      });
      webpackConfiguration.resolve ??= {};
      webpackConfiguration.resolve.alias = {
        ...webpackConfiguration.resolve.alias,
        orchajs$: plugin.bundlePath,
      };
      webpackConfiguration.plugins = [
        ...(webpackConfiguration.plugins ?? []),
        plugin,
      ];
      return existingWebpack
        ? existingWebpack(webpackConfiguration, context)
        : webpackConfiguration;
    },
  } as T;
}

function nextTarget(context: NextWebpackContext): RuntimeBuildTarget {
  return context.isServer && context.nextRuntime !== "edge"
    ? "node"
    : "browser";
}
