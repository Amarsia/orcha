import type {
  ProviderRequest,
  ProviderResponse,
} from "../providers/types.js";

export type StructuredOutputFailureKind =
  | "missing_json"
  | "invalid_json"
  | "schema_mismatch";

export class StructuredOutputError extends Error {
  readonly kind: StructuredOutputFailureKind;
  readonly rawText: string;
  readonly responsePreview?: string;
  readonly schemaErrors?: string[];
  response?: ProviderResponse;

  constructor(
    message: string,
    options: {
      kind: StructuredOutputFailureKind;
      rawText: string;
      responsePreview?: string;
      schemaErrors?: string[];
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "StructuredOutputError";
    this.kind = options.kind;
    this.rawText = options.rawText;
    this.responsePreview = options.responsePreview;
    this.schemaErrors = options.schemaErrors;
  }
}

export function resolveProviderStructuredOutput(
  request: ProviderRequest,
  baseResponse: ProviderResponse,
  textOutput: string,
): ProviderResponse {
  if (
    request.outputType !== "json" ||
    baseResponse.toolCalls.length > 0 ||
    baseResponse.stopReason === "max_tokens" ||
    baseResponse.stopReason === "content_filter"
  ) {
    return baseResponse;
  }

  try {
    return {
      ...baseResponse,
      output: parseStructuredOutput(
        textOutput,
        request.outputSchema ?? {},
      ),
    };
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      error.response = baseResponse;
    }
    throw error;
  }
}

export function parseStructuredOutput(
  text: string,
  schema: Record<string, unknown>,
): unknown {
  const preview = previewText(text);
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    const suffix = preview
      ? ` Model returned plain text: ${JSON.stringify(preview)}`
      : " Model returned an empty response.";
    throw new StructuredOutputError(
      `Model response did not contain a JSON object or array.${suffix}`,
      {
        kind: "missing_json",
        rawText: text,
        responsePreview: preview,
      },
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Invalid JSON";
    const suffix = preview
      ? ` Model returned: ${JSON.stringify(preview)}`
      : "";
    throw new StructuredOutputError(
      `Model response contained invalid JSON (${detail}).${suffix}`,
      {
        kind: "invalid_json",
        rawText: text,
        responsePreview: preview,
        cause: error,
      },
    );
  }

  const errors: string[] = [];
  validateSchemaValue(value, schema, "$", errors);
  if (errors.length > 0) {
    throw new StructuredOutputError(
      `Value failed outputSchema: ${errors.join("; ")}`,
      {
        kind: "schema_mismatch",
        rawText: text,
        responsePreview: preview,
        schemaErrors: errors,
      },
    );
  }

  return value;
}

export function validateStructuredValue(
  value: unknown,
  schema: Record<string, unknown>,
  label = "outputSchema",
): void {
  const errors: string[] = [];
  validateSchemaValue(value, schema, "$", errors);
  if (errors.length > 0) {
    throw new Error(`Value failed ${label}: ${errors.join("; ")}`);
  }
}

function previewText(text: string, maxLength = 240): string | undefined {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength)}...`
    : compact;
}

function extractJsonCandidate(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue with fenced/balanced extraction.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) {
    return fenced.trim();
  }

  const starts = [trimmed.indexOf("{"), trimmed.indexOf("[")].filter(
    (index) => index >= 0,
  );
  if (starts.length === 0) {
    return undefined;
  }

  const start = Math.min(...starts);
  const opening = trimmed[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === opening) {
      depth += 1;
    } else if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function validateSchemaValue(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    errors.push(`${path} is not an allowed enum value`);
    return;
  }

  const type = schema.type;
  if (typeof type === "string" && !matchesType(value, type)) {
    errors.push(`${path} must be ${type}`);
    return;
  }

  if (type === "object" && isObject(value)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [];

    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    }
    for (const [key, childValue] of Object.entries(value)) {
      const childSchema = properties[key];
      if (isObject(childSchema)) {
        validateSchemaValue(childValue, childSchema, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key} is not allowed`);
      }
    }
  }

  if (type === "array" && Array.isArray(value) && isObject(schema.items)) {
    value.forEach((item, index) =>
      validateSchemaValue(item, schema.items as Record<string, unknown>, `${path}[${index}]`, errors),
    );
  }
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isObject(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
