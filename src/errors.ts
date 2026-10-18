import type { OrchaErrorCode } from "./types.js";

export class OrchaError extends Error {
  readonly code: OrchaErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: OrchaErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "OrchaError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function describeProviderError(error: unknown): {
  message: string;
  details?: Record<string, unknown>;
} {
  const rootMessage = errorMessage(error);
  const cause = deepestUsefulCause(error);
  if (!cause) {
    return { message: rootMessage };
  }

  const causeMessage = errorMessage(cause);
  const causeCode = stringOrNumberField(cause, "code");
  const syscall = stringField(cause, "syscall");
  const hostname = stringField(cause, "hostname");
  const explanation =
    causeMessage !== rootMessage
      ? causeMessage
      : causeCode
        ? String(causeCode)
        : undefined;
  const details = {
    ...(causeCode !== undefined ? { causeCode } : {}),
    ...(syscall ? { syscall } : {}),
    ...(hostname ? { hostname } : {}),
    ...(explanation ? { causeMessage: explanation } : {}),
  };

  return {
    message: explanation ? `${rootMessage}: ${explanation}` : rootMessage,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

export function isRetryableProviderConnectionError(error: unknown): boolean {
  const retryableCodes = new Set([
    "UND_ERR_CONNECT_TIMEOUT",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "ECONNREFUSED",
  ]);
  const pending = [error];
  const visited = new Set<unknown>();
  while (pending.length > 0 && visited.size < 8) {
    const current = pending.shift();
    if (
      typeof current !== "object" ||
      current === null ||
      visited.has(current)
    ) {
      continue;
    }
    visited.add(current);
    const record = current as Record<string, unknown>;
    if (
      typeof record.code === "string" &&
      retryableCodes.has(record.code)
    ) {
      return true;
    }
    if (record.cause !== undefined) pending.push(record.cause);
    if (Array.isArray(record.errors)) pending.push(...record.errors);
  }
  return false;
}

function deepestUsefulCause(error: unknown): unknown {
  let current = error;
  let useful: unknown;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 5; depth += 1) {
    if (
      (typeof current !== "object" || current === null) ||
      visited.has(current)
    ) {
      break;
    }
    visited.add(current);
    const record = current as Record<string, unknown>;
    const next =
      record.cause ??
      (Array.isArray(record.errors) ? record.errors[0] : undefined);
    if (next === undefined) break;
    useful = next;
    current = next;
  }
  return useful;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return String(error);
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : undefined;
}

function stringOrNumberField(
  value: unknown,
  key: string,
): string | number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" || typeof field === "number"
    ? field
    : undefined;
}
