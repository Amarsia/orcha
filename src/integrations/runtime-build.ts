import { resolve } from "node:path";
import { watch } from "chokidar";
import { buildProject } from "../compiler/build-project.js";
import { loadProjectEnvironment } from "../env.js";

export type RuntimeBuildTarget = "node" | "browser" | "react-native";

let buildQueue = Promise.resolve();
const watchedTargets = new Set<string>();

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
  const build = buildQueue.then(async () => {
    loadProjectEnvironment(projectRoot);
    await buildProject({ projectRoot, target });
  });
  buildQueue = build.catch(() => undefined);
  return build;
}

export function watchRuntimeTargets(
  projectRoot: string,
  targets: RuntimeBuildTarget[],
): void {
  const key = `${projectRoot}:${targets.join(",")}`;
  if (watchedTargets.has(key)) {
    return;
  }
  watchedTargets.add(key);
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(resolve(projectRoot, "orcha"), { ignoreInitial: true }).on(
    "all",
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void targets.reduce(
          (pending, target) =>
            pending.then(() => queueRuntimeBuild(projectRoot, target)),
          Promise.resolve(),
        );
      }, 75);
    },
  );
}
