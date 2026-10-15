import type {
  CompiledActionManifest,
  LocalActionRuntimeConfiguration,
  SessionMetadata,
} from "../../types.js";
import { createLocalActionContext } from "./context.js";
import { executeNativeAction } from "./native.js";

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
  typeof import("./sandbox.js")
> {
  try {
    return await import("./sandbox.js");
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
