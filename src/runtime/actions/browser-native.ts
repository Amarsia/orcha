import type { CompiledActionManifest } from "../../types.js";
import type { LocalActionContext } from "./context.js";

type BrowserActionFunction = (
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
  if (/\brequire\s*\(/.test(action.source)) {
    throw new Error(
      `Browser action "${action.name}" contains a Node.js require() call. Rebuild it for the browser target.`,
    );
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

  const timeoutMs = action.timeoutMs ?? 10_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(
        (executable as BrowserActionFunction)(parameters, context),
      ),
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
