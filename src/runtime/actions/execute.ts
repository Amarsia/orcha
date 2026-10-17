import type {
  CompiledActionManifest,
  LocalActionRuntimeConfiguration,
  SessionMetadata,
} from "../../types.js";
import {
  createLocalActionContext,
  type LocalActionContext,
} from "./context.js";

type SandboxRuntime = typeof import("./sandbox.js");
type SandboxRuntimeLoader = () => Promise<SandboxRuntime>;
interface NativeRuntime {
  executeNativeAction(
    action: CompiledActionManifest,
    parameters: Record<string, unknown>,
    context: LocalActionContext,
  ): Promise<unknown>;
}
type NativeRuntimeLoader = () => Promise<NativeRuntime>;

let loadConfiguredNativeRuntime: NativeRuntimeLoader = async () => {
  throw new Error(
    "The native action runtime was not included in this Orcha build.",
  );
};

let loadConfiguredSandboxRuntime: SandboxRuntimeLoader = async () => {
  throw new Error(
    "The QuickJS sandbox runtime was not included in this Orcha build.",
  );
};

/** @internal Supplies the statically bundled sandbox in production builds. */
export function setSandboxRuntimeLoader(
  loader: SandboxRuntimeLoader,
): void {
  loadConfiguredSandboxRuntime = loader;
}

/** @internal Supplies the platform-specific native action executor. */
export function setNativeRuntimeLoader(loader: NativeRuntimeLoader): void {
  loadConfiguredNativeRuntime = loader;
}

export async function executeLocalAction(options: {
  action: CompiledActionManifest;
  parameters: Record<string, unknown>;
  configuration: LocalActionRuntimeConfiguration;
  sessionId: string;
  metadata: SessionMetadata;
  idempotencyKey: string;
}): Promise<unknown> {
  const context = createLocalActionContext(options);
  if (options.configuration.runtime === "native") {
    const { executeNativeAction } = await loadConfiguredNativeRuntime();
    return executeNativeAction(options.action, options.parameters, context);
  }

  if (process.env.ORCHA_INCLUDE_SANDBOX !== "0") {
    const { executeSandboxedAction } = await loadSandboxRuntime();
    return executeSandboxedAction(
      options.action,
      options.parameters,
      context,
      options.configuration.sandbox,
    );
  }

  throw new Error(
    "The production bundle was built without the QuickJS sandbox.",
  );
}

async function loadSandboxRuntime(): Promise<
  SandboxRuntime
> {
  try {
    return await loadConfiguredSandboxRuntime();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("quickjs-emscripten-core") ||
        error.message.includes(
          "@jitl/quickjs-singlefile-cjs-release-sync",
        ))
    ) {
      throw new Error(
        'Sandboxed actions require the optional "quickjs-emscripten-core" and "@jitl/quickjs-singlefile-cjs-release-sync" packages. Install both in the application that selects the sandbox runtime.',
        { cause: error },
      );
    }
    throw error;
  }
}
