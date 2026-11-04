import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { buildProject } from "../compiler/build-project.js";
import { loadProjectEnvironment } from "../env.js";

const require = createRequire(import.meta.url);

export type RuntimeBuildTarget = "node" | "browser" | "react-native";

interface RuntimeBuildGlobalState {
  buildQueue: Promise<void>;
  watchedTargets: Set<string>;
}

const RUNTIME_BUILD_STATE_KEY = Symbol.for("orchajs.runtimeBuildState");

function getRuntimeBuildState(): RuntimeBuildGlobalState {
  const globalRecord = globalThis as Record<
    symbol,
    RuntimeBuildGlobalState | undefined
  >;
  if (!globalRecord[RUNTIME_BUILD_STATE_KEY]) {
    globalRecord[RUNTIME_BUILD_STATE_KEY] = {
      buildQueue: Promise.resolve(),
      watchedTargets: new Set<string>(),
    };
  }
  return globalRecord[RUNTIME_BUILD_STATE_KEY];
}

export function generatedBundlePath(
  projectRoot: string,
  target: RuntimeBuildTarget,
): string {
  const fileName =
    target === "node" ? "bundle.js" : `bundle.${target}.js`;
  return resolve(projectRoot, ".orcha/dist", fileName);
}

export function queueRuntimeBuild(
  projectRoot: string,
  target: RuntimeBuildTarget,
): Promise<void> {
  const state = getRuntimeBuildState();
  const build = state.buildQueue.then(async () => {
    loadProjectEnvironment(projectRoot);
    await buildProject({ projectRoot, target });
  });
  state.buildQueue = build.catch(() => undefined);
  return build;
}

export function watchRuntimeTargets(
  projectRoot: string,
  targets: RuntimeBuildTarget[],
): void {
  const state = getRuntimeBuildState();
  const key = `${projectRoot}:${targets.join(",")}`;
  if (state.watchedTargets.has(key)) {
    return;
  }
  let watchFn: typeof import("chokidar").watch;
  try {
    const chokidarModule = require("chokidar") as typeof import("chokidar");
    watchFn = chokidarModule.watch;
  } catch {
    return;
  }
  state.watchedTargets.add(key);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watchFn(resolve(projectRoot, "orcha"), {
    ignoreInitial: true,
    persistent: false,
  });
  watcher.on("all", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!existsSync(resolve(projectRoot, "orcha/index.ts"))) {
        return;
      }
      void targets
        .reduce(
          (pending, target) =>
            pending.then(() => queueRuntimeBuild(projectRoot, target)),
          Promise.resolve(),
        )
        .catch(() => undefined);
    }, 75);
    timer.unref?.();
  });
}
