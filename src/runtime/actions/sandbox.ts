import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import type { CompiledActionManifest } from "../../types.js";
import type { LocalActionContext } from "./context.js";

export async function executeSandboxedAction(
  action: CompiledActionManifest,
  parameters: Record<string, unknown>,
  context: LocalActionContext,
  limits: {
    memoryLimitMb?: number;
    stackLimitKb?: number;
  } = {},
): Promise<unknown> {
  if (!action.source) {
    throw new Error(`Action "${action.name}" has no compiled source.`);
  }

  const quickJs = await newQuickJSWASMModuleFromVariant(
    import("@jitl/quickjs-singlefile-cjs-release-sync"),
  );
  const runtime = quickJs.newRuntime();
  const timeoutMs = action.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  runtime.setMemoryLimit((limits.memoryLimitMb ?? 32) * 1024 * 1024);
  runtime.setMaxStackSize((limits.stackLimitKb ?? 512) * 1024);
  runtime.setInterruptHandler(() => Date.now() > deadline);
  const vm = runtime.newContext();

  try {
    const fetchHandle = vm.newFunction(
      "__orchaFetch",
      (urlHandle, initHandle) => {
        const url = vm.getString(urlHandle);
        const rawInit = vm.getString(initHandle);
        const init = rawInit ? JSON.parse(rawInit) as RequestInit : undefined;
        const deferred = vm.newPromise();
        void context.fetch(url, init).then(
          async (response) => {
            const body = await response.text();
            const resultHandle = vm.newString(
              JSON.stringify({
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body,
              }),
            );
            deferred.resolve(resultHandle);
            resultHandle.dispose();
          },
          (error) => {
            const errorHandle = vm.newError(
              error instanceof Error ? error.message : String(error),
            );
            deferred.reject(errorHandle);
            errorHandle.dispose();
          },
        );
        void deferred.settled.then(() => {
          const jobs = runtime.executePendingJobs();
          jobs.dispose();
        });
        return deferred.handle;
      },
    );
    vm.setProp(vm.global, "__orchaFetch", fetchHandle);
    fetchHandle.dispose();

    const logHandle = vm.newFunction("__orchaLog", (...handles) => {
      context.log(...handles.map((handle) => vm.dump(handle)));
    });
    vm.setProp(vm.global, "__orchaLog", logHandle);
    logHandle.dispose();

    const source = createSandboxProgram(action, parameters, context);
    const evaluation = vm.evalCode(
      source,
      `${action.name}.js`,
    );
    const promiseHandle = vm.unwrapResult(evaluation);
    try {
      const settledPromise = vm.resolvePromise(promiseHandle);
      const pendingJobs = runtime.executePendingJobs();
      try {
        if (pendingJobs.error) {
          const error = pendingJobs.error.context.dump(pendingJobs.error);
          throw new Error(
            error instanceof Error ? error.message : String(error),
          );
        }
      } finally {
        pendingJobs.dispose();
      }
      const settled = await settledPromise;
      const resultHandle = vm.unwrapResult(settled);
      try {
        const serialized = vm.getString(resultHandle);
        return JSON.parse(serialized);
      } finally {
        resultHandle.dispose();
      }
    } finally {
      promiseHandle.dispose();
    }
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

function createSandboxProgram(
  action: CompiledActionManifest,
  parameters: Record<string, unknown>,
  context: LocalActionContext,
): string {
  return [
    action.source,
    `const __parameters = ${JSON.stringify(parameters)};`,
    `const __contextData = ${JSON.stringify({
      sessionId: context.sessionId,
      metadata: context.metadata,
      idempotencyKey: context.idempotencyKey,
      env: context.env,
    })};`,
    "const __context = Object.freeze({",
    "  ...__contextData,",
    "  log: (...values) => __orchaLog(...values),",
    "  fetch: async (url, init = {}) => {",
    "    const response = JSON.parse(await __orchaFetch(String(url), JSON.stringify(init)));",
    "    return Object.freeze({",
    "      ok: response.status >= 200 && response.status < 300,",
    "      status: response.status,",
    "      statusText: response.statusText,",
    "      headers: Object.freeze(response.headers),",
    "      text: async () => response.body,",
    "      json: async () => JSON.parse(response.body),",
    "    });",
    "  },",
    "});",
    "(async () => {",
    "  const executable = __orchaActionModule.default;",
    '  if (typeof executable !== "function") throw new Error("Action must export a default function.");',
    "  const output = await executable(__parameters, __context);",
    "  const serialized = JSON.stringify(output);",
    '  if (serialized === undefined) throw new Error("Action output must be JSON serializable.");',
    "  return serialized;",
    "})()",
  ].join("\n");
}
