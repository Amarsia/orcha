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
    const { executeSandboxedAction } = await import("./sandbox.js");
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
