import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { isBuiltInProvider } from "../providers/catalog.js";
import type {
  AgentConfiguration,
  AgentSkillRegistrations,
  ActionConfiguration,
  CompiledActionManifest,
  CompiledAgentManifest,
  CompiledBundle,
  CompiledSkillManifest,
  SkillConfiguration,
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
      skills: compileSkills(name, sourceDirectory),
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
    if (configuration.name === "load_skill") {
      throw new Error(
        `Action "${agentName}/${entry.name}" uses reserved name "load_skill".`,
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

function compileSkills(
  agentName: string,
  sourceDirectory: string,
): Record<string, CompiledSkillManifest> {
  const skillsDirectory = resolve(sourceDirectory, "skills");
  if (!existsSync(skillsDirectory)) {
    return {};
  }

  const registryPath = resolve(skillsDirectory, "index.js");
  if (!existsSync(registryPath)) {
    throw new Error(
      `Agent "${agentName}" has a skills directory but is missing skills/index.js.`,
    );
  }
  const registrations = loadSkillRegistrations(agentName, registryPath);
  const skills: Record<string, CompiledSkillManifest> = {};

  for (const [registrationName, registeredPath] of Object.entries(
    registrations,
  )) {
    if (!registrationName.trim()) {
      throw new Error(
        `Agent "${agentName}" has an empty registered skill name.`,
      );
    }
    if (typeof registeredPath !== "string" || !registeredPath.trim()) {
      throw new Error(
        `Skill "${agentName}/${registrationName}" must register a folder path.`,
      );
    }

    const skillDirectory = resolve(skillsDirectory, registeredPath);
    const relativePath = relative(skillsDirectory, skillDirectory);
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`)
    ) {
      throw new Error(
        `Skill "${agentName}/${registrationName}" must resolve inside the agent's skills directory.`,
      );
    }

    const configurationPath = resolve(skillDirectory, "index.json");
    let configuration: SkillConfiguration;
    try {
      configuration = JSON.parse(
        readFileSync(configurationPath, "utf8"),
      ) as SkillConfiguration;
    } catch (error) {
      throw new Error(
        `Skill "${agentName}/${registrationName}" is missing a valid index.json at ${configurationPath}.`,
        { cause: error },
      );
    }
    validateSkillConfiguration(
      agentName,
      registrationName,
      configuration,
    );

    const instructionsPath = resolve(skillDirectory, "instructions.md");
    let instructions: string;
    try {
      instructions = readFileSync(instructionsPath, "utf8").trim();
    } catch (error) {
      throw new Error(
        `Skill "${agentName}/${registrationName}" is missing instructions.md at ${instructionsPath}.`,
        { cause: error },
      );
    }
    if (!instructions) {
      throw new Error(
        `Skill "${agentName}/${registrationName}" instructions.md cannot be empty.`,
      );
    }
    if (skills[configuration.name]) {
      throw new Error(
        `Agent "${agentName}" has duplicate skill name "${configuration.name}".`,
      );
    }

    skills[configuration.name] = Object.freeze({
      ...configuration,
      directoryName: relativePath.split(sep).join("/"),
      instructions,
    });
  }

  return Object.freeze(skills);
}

function loadSkillRegistrations(
  agentName: string,
  registryPath: string,
): AgentSkillRegistrations {
  let output: string;
  try {
    const result = buildSync({
      entryPoints: [registryPath],
      alias: {
        "orchajs/skills": resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../skills.js",
        ),
      },
      bundle: true,
      write: false,
      format: "cjs",
      platform: "node",
      target: "node20",
      logLevel: "silent",
    });
    output = result.outputFiles[0]?.text ?? "";
  } catch (error) {
    throw new Error(
      `Agent "${agentName}" skills/index.js could not be bundled.`,
      { cause: error },
    );
  }

  try {
    const module: { exports: unknown } = { exports: {} };
    const execute = new Function(
      "module",
      "exports",
      "require",
      output,
    ) as (
      module: { exports: unknown },
      exports: unknown,
      require: NodeJS.Require,
    ) => void;
    execute(module, module.exports, createRequire(registryPath));
    const exported = module.exports as { default?: unknown };
    const registrations = exported.default ?? module.exports;
    if (
      !registrations ||
      typeof registrations !== "object" ||
      Array.isArray(registrations)
    ) {
      throw new TypeError("default export must be a registrations object");
    }
    return registrations as AgentSkillRegistrations;
  } catch (error) {
    throw new Error(
      `Agent "${agentName}" skills/index.js must default-export skill registrations.`,
      { cause: error },
    );
  }
}

function validateSkillConfiguration(
  agentName: string,
  registrationName: string,
  configuration: SkillConfiguration,
): void {
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration) ||
    typeof configuration.name !== "string" ||
    !configuration.name.trim() ||
    typeof configuration.description !== "string" ||
    !configuration.description.trim()
  ) {
    throw new Error(
      `Skill "${agentName}/${registrationName}" requires name and description.`,
    );
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(configuration.name)) {
    throw new Error(
      `Skill "${agentName}/${registrationName}" has an invalid model-facing name.`,
    );
  }
  if (
    configuration.triggers !== undefined &&
    (!Array.isArray(configuration.triggers) ||
      configuration.triggers.length === 0 ||
      configuration.triggers.some(
        (trigger) => typeof trigger !== "string" || !trigger.trim(),
      ))
  ) {
    throw new Error(
      `Skill "${agentName}/${registrationName}" triggers must be non-empty strings.`,
    );
  }
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
