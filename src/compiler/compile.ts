import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { isBuiltInProvider } from "../providers/catalog.js";
import type {
  AgentConfiguration,
  AgentEvaluationRegistrations,
  AgentRegistration,
  AgentSkillRegistrations,
  ActionConfiguration,
  CompiledActionManifest,
  CompiledAgentManifest,
  CompiledBundle,
  CompiledEvaluationManifest,
  CompiledSkillManifest,
  EvaluationConfiguration,
  SkillConfiguration,
} from "../types.js";

export function compileRegistry(
  registrations: Record<string, AgentRegistration>,
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

  for (const [key, registration] of Object.entries(registrations)) {
    if (!key.trim()) {
      throw new Error("Registered agent names cannot be empty.");
    }
    const normalized = normalizeAgentRegistration(key, registration);
    const subagents: Record<string, CompiledAgentManifest> = {};
    for (const [subagentKey, registeredPath] of Object.entries(
      normalized.subagents,
    )) {
      if (!subagentKey.trim()) {
        throw new Error(`Agent "${key}" has an empty subagent name.`);
      }
      subagents[subagentKey] = compileAgent(
        subagentKey,
        registeredPath,
        registryRoot,
      );
    }
    const parent = compileAgent(key, normalized.path, registryRoot);
    agents[key] = Object.freeze({
      ...parent,
      subagentPolicy:
        Object.keys(subagents).length > 0
          ? Object.freeze({
              ...parent.subagentPolicy,
              maxPerRun: parent.subagentPolicy?.maxPerRun ?? 10,
            })
          : parent.subagentPolicy,
      subagents: Object.freeze(subagents),
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

function normalizeAgentRegistration(
  key: string,
  registration: AgentRegistration,
): { path: string; subagents: Record<string, string> } {
  if (typeof registration === "string") {
    if (!registration.trim()) {
      throw new Error(`Agent "${key}" must register a folder path.`);
    }
    return { path: registration, subagents: {} };
  }
  if (!registration || typeof registration !== "object") {
    throw new Error(`Agent "${key}" must register a folder path.`);
  }
  if (typeof registration.path !== "string" || !registration.path.trim()) {
    throw new Error(`Agent "${key}" must register a folder path.`);
  }
  if (
    registration.subagents !== undefined &&
    (!registration.subagents ||
      typeof registration.subagents !== "object" ||
      Array.isArray(registration.subagents))
  ) {
    throw new Error(`Agent "${key}" subagents must be an object of folder paths.`);
  }
  for (const [subagentKey, registeredPath] of Object.entries(
    registration.subagents ?? {},
  )) {
    if (typeof registeredPath !== "string" || !registeredPath.trim()) {
      throw new Error(
        `Subagent "${key}/${subagentKey}" must register a folder path.`,
      );
    }
  }
  return {
    path: registration.path,
    subagents: registration.subagents ?? {},
  };
}

function compileAgent(
  key: string,
  registeredPath: string,
  registryRoot: string,
): CompiledAgentManifest {
    const name = key;

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
    if (typeof configuration.name !== "string" || !configuration.name.trim()) {
      throw new Error(`Agent "${name}" requires a name.`);
    }
    if (
      configuration.description !== undefined &&
      (typeof configuration.description !== "string" ||
        !configuration.description.trim())
    ) {
      throw new Error(
        `Agent "${name}" description must be a non-empty string when provided.`,
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
      configuration.subagents !== undefined &&
      (!configuration.subagents ||
        typeof configuration.subagents !== "object" ||
        Array.isArray(configuration.subagents))
    ) {
      throw new Error(`Agent "${name}" subagents must be an object.`);
    }
    validateNumber(
      name,
      "subagents.maxPerRun",
      configuration.subagents?.maxPerRun,
      { integer: true, minimum: 1 },
    );
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

    return Object.freeze({
      key,
      name: configuration.name.trim(),
      description: configuration.description?.trim(),
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
      evaluations: compileEvaluations(name, sourceDirectory),
      subagentPolicy: configuration.subagents
        ? Object.freeze({ ...configuration.subagents })
        : undefined,
      subagents: Object.freeze({}),
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
    if (
      [
        "load_skill",
        "run_agent",
        "resume_agent",
        "inspect_agent",
      ].includes(configuration.name)
    ) {
      throw new Error(
        `Action "${agentName}/${entry.name}" uses reserved name "${configuration.name}".`,
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

function compileEvaluations(
  agentName: string,
  sourceDirectory: string,
): Record<string, CompiledEvaluationManifest> {
  const evaluationsDirectory = resolve(sourceDirectory, "evaluations");
  if (!existsSync(evaluationsDirectory)) {
    return {};
  }

  const registryPath = resolve(evaluationsDirectory, "index.js");
  if (!existsSync(registryPath)) {
    throw new Error(
      `Agent "${agentName}" has an evaluations directory but is missing evaluations/index.js.`,
    );
  }
  const registrations = loadEvaluationRegistrations(
    agentName,
    registryPath,
  );
  const evaluations: Record<string, CompiledEvaluationManifest> = {};

  for (const [registrationName, registeredPath] of Object.entries(
    registrations,
  )) {
    if (!registrationName.trim()) {
      throw new Error(
        `Agent "${agentName}" has an empty registered evaluation name.`,
      );
    }
    if (typeof registeredPath !== "string" || !registeredPath.trim()) {
      throw new Error(
        `Evaluation "${agentName}/${registrationName}" must register a folder path.`,
      );
    }

    const evaluationDirectory = resolve(
      evaluationsDirectory,
      registeredPath,
    );
    const relativePath = relative(
      evaluationsDirectory,
      evaluationDirectory,
    );
    if (
      !relativePath ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`)
    ) {
      throw new Error(
        `Evaluation "${agentName}/${registrationName}" must resolve inside the agent's evaluations directory.`,
      );
    }

    const configurationPath = resolve(evaluationDirectory, "index.json");
    let configuration: EvaluationConfiguration;
    try {
      configuration = JSON.parse(
        readFileSync(configurationPath, "utf8"),
      ) as EvaluationConfiguration;
    } catch (error) {
      throw new Error(
        `Evaluation "${agentName}/${registrationName}" is missing a valid index.json at ${configurationPath}.`,
        { cause: error },
      );
    }
    validateEvaluationConfiguration(
      agentName,
      registrationName,
      configuration,
    );
    if (evaluations[configuration.name]) {
      throw new Error(
        `Agent "${agentName}" has duplicate evaluation name "${configuration.name}".`,
      );
    }

    evaluations[configuration.name] = Object.freeze({
      ...configuration,
      enabled: configuration.enabled ?? true,
      provider: configuration.provider as CompiledEvaluationManifest["provider"],
      directoryName: relativePath.split(sep).join("/"),
      metrics: Object.freeze(
        configuration.metrics.map((metric) => Object.freeze({ ...metric })),
      ),
    });
  }

  return Object.freeze(evaluations);
}

function loadSkillRegistrations(
  agentName: string,
  registryPath: string,
): AgentSkillRegistrations {
  return loadFolderRegistrations(
    agentName,
    registryPath,
    "skills",
    "skill",
    "orchajs/skills",
    "../skills.js",
  ) as AgentSkillRegistrations;
}

function loadEvaluationRegistrations(
  agentName: string,
  registryPath: string,
): AgentEvaluationRegistrations {
  return loadFolderRegistrations(
    agentName,
    registryPath,
    "evaluations",
    "evaluation",
    "orchajs/evaluations",
    "../evaluations.js",
  ) as AgentEvaluationRegistrations;
}

function loadFolderRegistrations(
  agentName: string,
  registryPath: string,
  collectionName: string,
  itemName: string,
  moduleSpecifier: string,
  helperPath: string,
): Record<string, string> {
  let output: string;
  try {
    const result = buildSync({
      entryPoints: [registryPath],
      alias: {
        [moduleSpecifier]: resolve(
          dirname(fileURLToPath(import.meta.url)),
          helperPath,
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
      `Agent "${agentName}" ${collectionName}/index.js could not be bundled.`,
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
    return registrations as Record<string, string>;
  } catch (error) {
    throw new Error(
      `Agent "${agentName}" ${collectionName}/index.js must default-export ${itemName} registrations.`,
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

function validateEvaluationConfiguration(
  agentName: string,
  registrationName: string,
  configuration: EvaluationConfiguration,
): void {
  const label = `Evaluation "${agentName}/${registrationName}"`;
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration) ||
    typeof configuration.name !== "string" ||
    !configuration.name.trim()
  ) {
    throw new Error(`${label} requires a name.`);
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(configuration.name)) {
    throw new Error(`${label} has an invalid name.`);
  }
  if (
    configuration.description !== undefined &&
    (typeof configuration.description !== "string" ||
      !configuration.description.trim())
  ) {
    throw new Error(`${label} description must be a non-empty string.`);
  }
  if (
    configuration.instructions !== undefined &&
    (typeof configuration.instructions !== "string" ||
      !configuration.instructions.trim())
  ) {
    throw new Error(`${label} instructions must be a non-empty string.`);
  }
  if (!isBuiltInProvider(configuration.provider)) {
    throw new Error(
      `${label} uses unsupported provider "${configuration.provider}".`,
    );
  }
  if (typeof configuration.model !== "string" || !configuration.model.trim()) {
    throw new Error(`${label} requires a model.`);
  }
  if (
    configuration.enabled !== undefined &&
    typeof configuration.enabled !== "boolean"
  ) {
    throw new Error(`${label} enabled must be a boolean.`);
  }
  validateNumber(
    `${agentName}/${registrationName}`,
    "maxTokens",
    configuration.maxTokens,
    { integer: true, minimum: 1 },
  );
  if (
    configuration.reasoningLevel !== undefined &&
    (typeof configuration.reasoningLevel !== "string" ||
      !configuration.reasoningLevel.trim())
  ) {
    throw new Error(`${label} reasoningLevel must be a non-empty string.`);
  }
  if (
    !Array.isArray(configuration.metrics) ||
    configuration.metrics.length === 0
  ) {
    throw new Error(`${label} requires at least one metric.`);
  }
  const names = new Set<string>();
  for (const metric of configuration.metrics) {
    if (
      !metric ||
      typeof metric !== "object" ||
      typeof metric.name !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(metric.name) ||
      typeof metric.description !== "string" ||
      !metric.description.trim() ||
      typeof metric.threshold !== "number" ||
      !Number.isFinite(metric.threshold) ||
      metric.threshold < 0 ||
      metric.threshold > 1
    ) {
      throw new Error(
        `${label} metrics require a valid name, description, and threshold between 0 and 1.`,
      );
    }
    if (names.has(metric.name)) {
      throw new Error(`${label} has duplicate metric "${metric.name}".`);
    }
    names.add(metric.name);
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
