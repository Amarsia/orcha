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
