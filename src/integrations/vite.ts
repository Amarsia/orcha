import { resolve, sep } from "node:path";
import {
  generatedBundlePath,
  queueRuntimeBuild,
} from "./runtime-build.js";

export interface OrchaVitePluginOptions {
  projectRoot?: string;
}

export function orchaVitePlugin(
  options: OrchaVitePluginOptions = {},
): {
  name: string;
  enforce: "pre";
  configResolved(config: { root: string }): void;
  buildStart(): Promise<void>;
  configureServer(server: {
    watcher: {
      add(path: string): void;
      on(event: "all", listener: (_event: string, path: string) => void): void;
    };
    ws: { send(message: { type: "full-reload" }): void };
  }): void;
  resolveId(source: string): string | undefined;
} {
  let projectRoot = resolve(options.projectRoot ?? process.cwd());
  return {
    name: "orchajs",
    enforce: "pre",
    configResolved(config) {
      projectRoot = resolve(options.projectRoot ?? config.root);
    },
    async buildStart() {
      await queueRuntimeBuild(projectRoot, "browser");
    },
    configureServer(server) {
      const registryDirectory = resolve(projectRoot, "orcha");
      server.watcher.add(registryDirectory);
      server.watcher.on("all", (_event, path) => {
        if (
          path === registryDirectory ||
          path.startsWith(`${registryDirectory}${sep}`)
        ) {
          void queueRuntimeBuild(projectRoot, "browser").then(() => {
            server.ws.send({ type: "full-reload" });
          });
        }
      });
    },
    resolveId(source) {
      return source === "orchajs"
        ? generatedBundlePath(projectRoot, "browser")
        : undefined;
    },
  };
}
