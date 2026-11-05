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

const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 413, 422]);
const NON_RETRYABLE_ERROR_NAMES = new Set([
  "ValidationException",
  "AccessDeniedException",
  "ResourceNotFoundException",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "ExpiredTokenException",
]);

export async function createProviderHttpError(
  response: Response,
  providerLabel: string,
): Promise<Error> {
  const status = response.status;
  const requestId =
    response.headers.get("request-id") ??
    response.headers.get("x-request-id") ??
    response.headers.get("x-amzn-requestid") ??
    undefined;

  let rawText = "";
  try {
    rawText = (await response.text()).trim();
  } catch {
    rawText = "";
  }

  let parsedMessage: string | undefined;
  let errorCode: string | number | undefined;
  if (rawText) {
    try {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      const nestedError =
        typeof parsed.error === "object" && parsed.error !== null
          ? (parsed.error as Record<string, unknown>)
          : undefined;
      if (typeof nestedError?.message === "string" && nestedError.message.trim()) {
        parsedMessage = nestedError.message.trim();
      } else if (typeof parsed.message === "string" && parsed.message.trim()) {
        parsedMessage = parsed.message.trim();
      } else if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        parsedMessage = parsed.detail.trim();
      }
      errorCode =
        stringOrNumberField(nestedError, "code") ??
        stringOrNumberField(nestedError, "type") ??
        stringOrNumberField(parsed, "code");
    } catch {
      const compact = rawText.replace(/\s+/g, " ").trim();
      if (compact) {
        parsedMessage =
          compact.length > 300 ? `${compact.slice(0, 300)}...` : compact;
      }
    }
  }

  const message =
    parsedMessage ?? `${providerLabel} request failed with HTTP ${status}.`;
  const error = new Error(message) as Error & {
    statusCode?: number;
    requestId?: string;
    code?: string | number;
  };
  error.statusCode = status;
  if (requestId) {
    error.requestId = requestId;
  }
  if (errorCode !== undefined) {
    error.code = errorCode;
  }
  return error;
}

export function describeProviderError(error: unknown): {
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
} {
  const rootMessage = errorMessage(error);
  const statusCode = extractStatusCode(error);
  const requestId = extractRequestId(error);
  const errorName = extractErrorName(error);
  const errorCode =
    stringOrNumberField(error, "code") ??
    stringOrNumberField(error, "type");
  const retryable = isProviderErrorRetryable(statusCode, errorName);

  const cause = deepestUsefulCause(error);
  const causeMessage = cause ? errorMessage(cause) : undefined;
  const causeCode = cause ? stringOrNumberField(cause, "code") : undefined;
  const syscall = cause ? stringField(cause, "syscall") : undefined;
  const hostname = cause ? stringField(cause, "hostname") : undefined;
  const explanation =
    causeMessage && causeMessage !== rootMessage
      ? causeMessage
      : causeCode !== undefined
        ? String(causeCode)
        : undefined;

  const details: Record<string, unknown> = {
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(requestId ? { requestId } : {}),
    ...(errorName ? { errorName } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(causeCode !== undefined ? { causeCode } : {}),
    ...(syscall ? { syscall } : {}),
    ...(hostname ? { hostname } : {}),
    ...(explanation ? { causeMessage: explanation } : {}),
  };

  return {
    message: explanation ? `${rootMessage}: ${explanation}` : rootMessage,
    retryable,
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

function isProviderErrorRetryable(
  statusCode: number | undefined,
  errorName: string | undefined,
): boolean {
  if (errorName && NON_RETRYABLE_ERROR_NAMES.has(errorName)) {
    return false;
  }
  if (statusCode !== undefined && NON_RETRYABLE_STATUS_CODES.has(statusCode)) {
    return false;
  }
  return true;
}

function extractStatusCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.status === "number") return record.status;
  const metadata =
    typeof record.$metadata === "object" && record.$metadata !== null
      ? (record.$metadata as Record<string, unknown>)
      : undefined;
  if (typeof metadata?.httpStatusCode === "number") {
    return metadata.httpStatusCode;
  }
  return undefined;
}

function extractRequestId(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.requestId === "string" && record.requestId.trim()) {
    return record.requestId.trim();
  }
  const metadata =
    typeof record.$metadata === "object" && record.$metadata !== null
      ? (record.$metadata as Record<string, unknown>)
      : undefined;
  if (typeof metadata?.requestId === "string" && metadata.requestId.trim()) {
    return metadata.requestId.trim();
  }
  return undefined;
}

function extractErrorName(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.name && error.name !== "Error" && error.name !== "OrchaError") {
    return error.name;
  }
  return undefined;
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
