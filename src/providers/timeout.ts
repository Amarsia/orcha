import { OrchaError } from "../errors.js";

/** Default idle/request timeout for all provider inference calls (10 minutes). */
export const PROVIDER_REQUEST_TIMEOUT_MS = 600_000;

export type ProviderRequestPhase = "request" | "stream";

export interface ProviderTimeoutController {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  didTimeout(): boolean;
  elapsedMs(): number;
  reset(phase?: ProviderRequestPhase): void;
  createTimeoutError(phase?: ProviderRequestPhase): OrchaError;
  rethrowIfTimedOut(error: unknown, phase?: ProviderRequestPhase): never;
  iterateStream<T>(stream: AsyncIterable<T>): AsyncIterable<T>;
  cleanup(): void;
}

export function createProviderTimeout(options: {
  provider: string;
  model: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): ProviderTimeoutController {
  const timeoutMs = options.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const startedAt = Date.now();
  let timedOut = false;
  let currentPhase: ProviderRequestPhase = "request";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onUserAbort = (): void => {
    clearTimer();
    controller.abort(options.signal?.reason);
  };

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function scheduleTimer(): void {
    clearTimer();
    if (controller.signal.aborted) {
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(createTimeoutError(currentPhase));
    }, timeoutMs);
  }

  function createTimeoutError(
    phase: ProviderRequestPhase = currentPhase,
  ): OrchaError {
    const elapsedMs = Date.now() - startedAt;
    const elapsedSeconds = Math.max(1, Math.round(elapsedMs / 1_000));
    const timeoutSeconds = Math.round(timeoutMs / 1_000);
    return new OrchaError(
      "provider_error",
      `${options.provider} model "${options.model}" timed out after ${elapsedSeconds}s while waiting for ${phase} data (idle timeout ${timeoutSeconds}s).`,
      {
        retryable: true,
        details: {
          reason: "provider_timeout",
          provider: options.provider,
          model: options.model,
          phase,
          timeoutMs,
          elapsedMs,
        },
      },
    );
  }

  if (options.signal?.aborted) {
    controller.abort(options.signal.reason);
  } else {
    options.signal?.addEventListener("abort", onUserAbort, { once: true });
    scheduleTimer();
  }

  return {
    signal: controller.signal,
    timeoutMs,
    didTimeout: () => timedOut,
    elapsedMs: () => Date.now() - startedAt,
    reset(phase?: ProviderRequestPhase): void {
      if (phase) {
        currentPhase = phase;
      }
      if (!controller.signal.aborted) {
        scheduleTimer();
      }
    },
    createTimeoutError,
    rethrowIfTimedOut(
      error: unknown,
      phase: ProviderRequestPhase = currentPhase,
    ): never {
      if (timedOut) {
        throw createTimeoutError(phase);
      }
      throw error;
    },
    async *iterateStream<T>(stream: AsyncIterable<T>): AsyncIterable<T> {
      const iterator = stream[Symbol.asyncIterator]();
      currentPhase = "stream";
      scheduleTimer();
      try {
        while (true) {
          const next = await raceNextWithAbort(
            iterator.next(),
            controller.signal,
            () =>
              timedOut
                ? createTimeoutError("stream")
                : toAbortError(options.signal?.reason),
          );
          if (next.done) {
            return;
          }
          scheduleTimer();
          yield next.value;
        }
      } finally {
        clearTimer();
        if (typeof iterator.return === "function") {
          void Promise.resolve(iterator.return()).catch(() => undefined);
        }
      }
    },
    cleanup(): void {
      clearTimer();
      options.signal?.removeEventListener("abort", onUserAbort);
    },
  };
}

function raceNextWithAbort<T>(
  promise: Promise<IteratorResult<T>>,
  signal: AbortSignal,
  createError: () => unknown,
): Promise<IteratorResult<T>> {
  if (signal.aborted) {
    return Promise.reject(createError());
  }
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = (): void => {
      reject(createError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function toAbortError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error(
    typeof reason === "string" && reason.trim()
      ? reason
      : "The provider request was aborted.",
  );
  error.name = "AbortError";
  return error;
}
