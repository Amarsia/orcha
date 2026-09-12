import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { isBuiltInProvider } from "../providers/catalog.js";
import type {
  AgentConfiguration,
  ActionConfiguration,
  CompiledActionManifest,
  CompiledAgentManifest,
  CompiledBundle,
} from "../types.js";

export function compileRegistry(
  registrations: Record<string, string>,
  registryRoot: string,
  actionRuntime?: "native" | "sandbox",
): CompiledBundle {
  if (
    !registrations ||
    typeof registrations !== "object" ||
    Array.isArray(registrations)
  ) {
    throw new TypeError(
      'orcha.init() requires an "agents" object of registered folder paths.',
    );
  }

  const agents: Record<string, CompiledAgentManifest> = {};

  for (const [name, registeredPath] of Object.entries(registrations)) {
    if (!name.trim()) {
      throw new Error("Registered agent names cannot be empty.");
    }
    if (typeof registeredPath !== "string" || !registeredPath.trim()) {
      throw new Error(`Agent "${name}" must register a folder path.`);
    }

    const sourceDirectory = resolve(registryRoot, registeredPath);
    const configPath = resolve(sourceDirectory, "index.json");
    let configuration: AgentConfiguration;
    try {
      configuration = JSON.parse(
        readFileSync(configPath, "utf8"),
      ) as AgentConfiguration;
    } catch (error) {
      throw new Error(
        `Agent "${name}" is missing a valid index.json at ${configPath}.`,
        { cause: error },
      );
    }
    if (!isBuiltInProvider(configuration.provider)) {
      throw new Error(
        `Agent "${name}" uses unsupported provider "${configuration.provider}".`,
      );
    }
    if (!configuration.model?.trim()) {
      throw new Error(`Agent "${name}" must configure a model.`);
    }
    validateNumber(name, "maxTokens", configuration.maxTokens, {
      integer: true,
      minimum: 1,
    });
    if (
      configuration.outputType &&
      !["text", "json", "image", "audio"].includes(configuration.outputType)
    ) {
      throw new Error(`Agent "${name}" has an invalid outputType.`);
    }
    if (
      configuration.reasoningLevel !== undefined &&
      (typeof configuration.reasoningLevel !== "string" ||
        !configuration.reasoningLevel.trim())
    ) {
      throw new Error(
        `Agent "${name}" reasoningLevel must be a non-empty string.`,
      );
    }
    if (!["text", "json"].includes(configuration.outputType ?? "text")) {
      throw new Error(
        `Agent "${name}" outputType "${configuration.outputType}" is not implemented yet.`,
      );
    }
    if (
      configuration.outputType === "json" &&
      (!configuration.outputSchema ||
        typeof configuration.outputSchema !== "object")
    ) {
      throw new Error(
        `Agent "${name}" must configure outputSchema when outputType is "json".`,
      );
    }

    const instructionsPath = resolve(sourceDirectory, "instructions.md");
    let systemPrompt: string;
    try {
      systemPrompt = readFileSync(instructionsPath, "utf8").trim();
    } catch (error) {
      throw new Error(
        `Agent "${name}" is missing required instructions.md at ${instructionsPath}.`,
        { cause: error },
      );
    }
    if (!systemPrompt) {
      throw new Error(`Agent "${name}" instructions.md cannot be empty.`);
    }

    agents[name] = Object.freeze({
      name,
      provider: configuration.provider,
      model: configuration.model,
      systemPrompt,
      region: configuration.region,
      maxTokens: configuration.maxTokens,
      reasoningLevel: configuration.reasoningLevel,
      outputType: configuration.outputType ?? "text",
      outputSchema: configuration.outputSchema,
      actions: compileActions(name, sourceDirectory),
    });
  }

  if (Object.keys(agents).length === 0) {
    throw new Error("At least one agent must be registered.");
  }

  return Object.freeze({
    schemaVersion: 1,
    actionRuntime,
    agents: Object.freeze(agents),
  });
}

function compileActions(
  agentName: string,
  sourceDirectory: string,
): Record<string, CompiledActionManifest> {
  const actionsDirectory = resolve(sourceDirectory, "actions");
  if (!existsSync(actionsDirectory)) {
    return {};
  }

  const actions: Record<string, CompiledActionManifest> = {};
  for (const entry of readdirSync(actionsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const configurationPath = resolve(
      actionsDirectory,
      entry.name,
      "index.json",
    );
    let configuration: ActionConfiguration;
    try {
      configuration = JSON.parse(
        readFileSync(configurationPath, "utf8"),
      ) as ActionConfiguration;
    } catch (error) {
      throw new Error(
        `Action "${agentName}/${entry.name}" is missing a valid index.json.`,
        { cause: error },
      );
    }

    if (!configuration.name?.trim() || !configuration.description?.trim()) {
      throw new Error(
        `Action "${agentName}/${entry.name}" requires name and description.`,
      );
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(configuration.name)) {
      throw new Error(
        `Action "${agentName}/${entry.name}" has an invalid model-facing name.`,
      );
    }
    if (!["client", "local"].includes(configuration.execution)) {
      throw new Error(
        `Action "${agentName}/${entry.name}" has invalid execution "${configuration.execution}".`,
      );
    }
    if (
      !configuration.parameters ||
      typeof configuration.parameters !== "object" ||
      Array.isArray(configuration.parameters)
    ) {
      throw new Error(
        `Action "${agentName}/${entry.name}" requires a parameters JSON Schema.`,
      );
    }
    if (
      configuration.outputSchema !== undefined &&
      (typeof configuration.outputSchema !== "object" ||
        configuration.outputSchema === null ||
        Array.isArray(configuration.outputSchema))
    ) {
      throw new Error(
        `Action "${agentName}/${entry.name}" has an invalid outputSchema.`,
      );
    }
    validateNumber(
      `${agentName}/${entry.name}`,
      "timeoutMs",
      configuration.timeoutMs,
      { integer: true, minimum: 1, maximum: 120_000 },
    );
    if (
      configuration.permissions?.env !== undefined &&
      !Array.isArray(configuration.permissions.env)
    ) {
      throw new Error(
        `Action "${agentName}/${entry.name}" permissions.env must be an array.`,
      );
    }
    if (
      configuration.permissions?.network !== undefined &&
      !Array.isArray(configuration.permissions.network)
    ) {
      throw new Error(
        `Action "${agentName}/${entry.name}" permissions.network must be an array.`,
      );
    }
    for (const permission of [
      ...(configuration.permissions?.env ?? []),
      ...(configuration.permissions?.network ?? []),
    ]) {
      if (typeof permission !== "string" || !permission.trim()) {
        throw new Error(
          `Action "${agentName}/${entry.name}" has an invalid permission.`,
        );
      }
    }
    if (actions[configuration.name]) {
      throw new Error(
        `Agent "${agentName}" has duplicate action name "${configuration.name}".`,
      );
    }

    const compiledSource =
      configuration.execution === "local"
        ? compileLocalAction(agentName, entry.name, actionsDirectory)
        : undefined;
    actions[configuration.name] = Object.freeze({
      ...configuration,
      directoryName: entry.name,
      ...compiledSource,
    });
  }

  return Object.freeze(actions);
}

function compileLocalAction(
  agentName: string,
  directoryName: string,
  actionsDirectory: string,
): { source: string; sourceHash: string } {
  const entryPath = resolve(actionsDirectory, directoryName, "index.js");
  if (!existsSync(entryPath)) {
    throw new Error(
      `Local action "${agentName}/${directoryName}" requires index.js.`,
    );
  }

  let output: string;
  try {
    const result = buildSync({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      format: "iife",
      globalName: "__orchaActionModule",
      platform: "neutral",
      target: "es2022",
      logLevel: "silent",
    });
    output = result.outputFiles[0]?.text ?? "";
  } catch (error) {
    throw new Error(
      `Local action "${agentName}/${directoryName}" could not be bundled.`,
      { cause: error },
    );
  }
  if (!output.includes("__orchaActionModule")) {
    throw new Error(
      `Local action "${agentName}/${directoryName}" must export a default function.`,
    );
  }

  return {
    source: output,
    sourceHash: createHash("sha256").update(output).digest("hex"),
  };
}

export function serializeBundle(bundle: CompiledBundle): string {
  return [
    "// Generated by OrchaJS. Do not edit manually.",
    `export const bundle = ${JSON.stringify(bundle, null, 2)};`,
    "export default bundle;",
    "",
  ].join("\n");
}

function validateNumber(
  agentName: string,
  field: string,
  value: number | undefined,
  constraints: {
    integer?: boolean;
    minimum?: number;
    maximum?: number;
  },
): void {
  if (value === undefined) {
    return;
  }
  if (
    !Number.isFinite(value) ||
    (constraints.integer && !Number.isInteger(value)) ||
    (constraints.minimum !== undefined && value < constraints.minimum) ||
    (constraints.maximum !== undefined && value > constraints.maximum)
  ) {
    throw new Error(`Agent "${agentName}" has an invalid ${field}.`);
  }
}
