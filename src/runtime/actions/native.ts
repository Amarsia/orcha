import type { CompiledActionManifest } from "../../types.js";
import type { LocalActionContext } from "./context.js";

type LocalActionFunction = (
  parameters: Record<string, unknown>,
  context: LocalActionContext,
) => unknown | Promise<unknown>;

export async function executeNativeAction(
  action: CompiledActionManifest,
  parameters: Record<string, unknown>,
  context: LocalActionContext,
): Promise<unknown> {
  if (!action.source) {
    throw new Error(`Action "${action.name}" has no compiled source.`);
  }

  const loadAction = new Function(
    `"use strict";\n${action.source}\nreturn __orchaActionModule.default;`,
  ) as () => unknown;
  const executable = loadAction();
  if (typeof executable !== "function") {
    throw new Error(
      `Action "${action.name}" index.js must export a default function.`,
    );
  }

  const execution = Promise.resolve(
    (executable as LocalActionFunction)(parameters, context),
  );
  const timeoutMs = action.timeoutMs ?? 10_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      execution,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Action timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
