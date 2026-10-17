import { resolve } from "node:path";
import {
  generatedBundlePath,
  queueRuntimeBuild,
  watchRuntimeTargets,
} from "./runtime-build.js";

export interface OrchaMetroOptions {
  projectRoot?: string;
}

interface MetroResolverContext {
  resolveRequest(
    context: MetroResolverContext,
    moduleName: string,
    platform: string | null,
  ): unknown;
}

interface MetroConfiguration {
  resolver?: {
    resolveRequest?: MetroResolverContext["resolveRequest"];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function withOrchaMetro<T extends MetroConfiguration>(
  configuration: T,
  options: OrchaMetroOptions = {},
): Promise<T> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  await queueRuntimeBuild(projectRoot, "react-native");
  if (process.env.NODE_ENV !== "production") {
    watchRuntimeTargets(projectRoot, ["react-native"]);
  }
  const existingResolver = configuration.resolver?.resolveRequest;

  return {
    ...configuration,
    resolver: {
      ...configuration.resolver,
      resolveRequest(context, moduleName, platform) {
        const requestedModule =
          moduleName === "orchajs"
            ? generatedBundlePath(projectRoot, "react-native")
            : moduleName;
        if (existingResolver) {
          return existingResolver(context, requestedModule, platform);
        }
        return context.resolveRequest(context, requestedModule, platform);
      },
    },
  };
}
