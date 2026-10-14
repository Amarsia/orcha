import type {
  CompiledActionManifest,
  LocalActionRuntimeConfiguration,
  SessionMetadata,
} from "../../types.js";

export interface LocalActionContext {
  sessionId: string;
  metadata: SessionMetadata;
  idempotencyKey: string;
  env: Record<string, string>;
  fetch(
    input: string | URL,
    init?: RequestInit,
  ): Promise<Response>;
  log(...values: unknown[]): void;
}

export function createLocalActionContext(options: {
  action: CompiledActionManifest;
  configuration: LocalActionRuntimeConfiguration;
  sessionId: string;
  metadata: SessionMetadata;
  idempotencyKey: string;
}): LocalActionContext {
  const allowedEnvironment = new Set(options.action.permissions?.env ?? []);
  const env = Object.fromEntries(
    Object.entries(options.configuration.env ?? {}).filter(
      (entry): entry is [string, string] =>
        allowedEnvironment.has(entry[0]) &&
        typeof entry[1] === "string",
    ),
  );

  return Object.freeze({
    sessionId: options.sessionId,
    metadata: Object.freeze({ ...options.metadata }),
    idempotencyKey: options.idempotencyKey,
    env: Object.freeze(env),
    fetch: async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error(
          `Action "${options.action.name}" cannot use protocol "${url.protocol}".`,
        );
      }
      if (!isAllowedHost(url.hostname, options.action.permissions?.network ?? [])) {
        throw new Error(
          `Action "${options.action.name}" cannot access "${url.hostname}".`,
        );
      }
      const timeoutSignal = AbortSignal.timeout(
        options.action.timeoutMs ?? 10_000,
      );
      const response = await fetch(url, {
        ...init,
        redirect: "manual",
        signal: init?.signal
          ? combineAbortSignals(init.signal, timeoutSignal)
          : timeoutSignal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new Error(
          `Action "${options.action.name}" network redirects are not allowed.`,
        );
      }
      return response;
    },
    log: (...values: unknown[]) => {
      console.log(`[orcha:${options.action.name}]`, ...values);
    },
  });
}

function combineAbortSignals(
  first: AbortSignal,
  second: AbortSignal,
): AbortSignal {
  const controller = new AbortController();
  const registrations: Array<{
    signal: AbortSignal;
    listener: () => void;
  }> = [];
  const cleanup = () => {
    for (const { signal, listener } of registrations) {
      signal.removeEventListener("abort", listener);
    }
  };
  const register = (signal: AbortSignal) => {
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    registrations.push({ signal, listener: abort });
  };

  controller.signal.addEventListener("abort", cleanup, { once: true });
  register(first);
  if (!controller.signal.aborted) {
    register(second);
  }
  return controller.signal;
}

function isAllowedHost(hostname: string, allowedHosts: string[]): boolean {
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1);
      return hostname.endsWith(suffix) && hostname !== suffix.slice(1);
    }
    return hostname === allowed;
  });
}
