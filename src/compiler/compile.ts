import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";
import { isBuiltInProvider } from "../providers/catalog.js";
import type {
  AgentConfiguration,
  AgentRegistration,
  ActionConfiguration,
  CompiledActionManifest,
  CompiledAgentManifest,
  CompiledBundle,
  CompiledEvaluationManifest,
  CompiledMcpServerManifest,
  CompiledSkillManifest,
  EvaluationConfiguration,
  McpRegistration,
  McpServerConfiguration,
  SkillConfiguration,
  SubagentRegistration,
} from "../types.js";

export function compileRegistry(
  registrations: Record<string, AgentRegistration>,
  registryRoot: string,
  actionRuntime: "native" | "sandbox" = "native",
  target: "node" | "browser" | "react-native" = "node",
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
    for (const [subagentKey, registration] of Object.entries(
      normalized.subagents,
    )) {
      if (!subagentKey.trim()) {
        throw new Error(`Agent "${key}" has an empty subagent name.`);
      }
      const subagent = normalizeSubagentRegistration(
        key,
        subagentKey,
        registration,
      );
      subagents[subagentKey] = compileAgent(
        subagentKey,
        subagent.path,
        subagent.mcp,
        registryRoot,
        actionRuntime,
        target,
      );
    }
    const parent = compileAgent(
      key,
      normalized.path,
      normalized.mcp,
      registryRoot,
      actionRuntime,
      target,
    );
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
): {
  path: string;
  mcp: McpRegistration;
  subagents: Record<string, SubagentRegistration>;
} {
  if (typeof registration === "string") {
    if (!registration.trim()) {
      throw new Error(`Agent "${key}" must register a folder path.`);
    }
    return { path: registration, mcp: {}, subagents: {} };
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
    throw new Error(
      `Agent "${key}" subagents must be an object of named registrations.`,
    );
  }
  validateMcpRegistration(`Agent "${key}"`, registration.mcp);
  return {
    path: registration.path,
    mcp: registration.mcp ?? {},
    subagents: registration.subagents ?? {},
  };
}

function normalizeSubagentRegistration(
  parentKey: string,
  key: string,
  registration: SubagentRegistration,
): { path: string; mcp: McpRegistration } {
  if (typeof registration === "string") {
    if (!registration.trim()) {
      throw new Error(
        `Subagent "${parentKey}/${key}" must register a folder path.`,
      );
    }
    return { path: registration, mcp: {} };
  }
  if (
    !registration ||
    typeof registration !== "object" ||
    typeof registration.path !== "string" ||
    !registration.path.trim()
  ) {
    throw new Error(
      `Subagent "${parentKey}/${key}" must register a folder path.`,
    );
  }
  validateMcpRegistration(
    `Subagent "${parentKey}/${key}"`,
    registration.mcp,
  );
  return {
    path: registration.path,
    mcp: registration.mcp ?? {},
  };
}

function validateMcpRegistration(
  owner: string,
  registration: McpRegistration | undefined,
): void {
  if (
    registration !== undefined &&
    (!registration ||
      typeof registration !== "object" ||
      Array.isArray(registration))
  ) {
    throw new Error(`${owner} mcp must be an object of named folder paths.`);
  }
  for (const [key, path] of Object.entries(registration ?? {})) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(key)) {
      throw new Error(`${owner} has invalid MCP name "${key}".`);
    }
    if (typeof path !== "string" || !path.trim()) {
      throw new Error(
        `${owner} MCP "${key}" must register a folder path.`,
      );
    }
  }
}

function compileAgent(
  key: string,
  registeredPath: string,
  mcpRegistration: McpRegistration,
  registryRoot: string,
  actionRuntime: "native" | "sandbox",
  target: "node" | "browser" | "react-native",
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
      actions: compileActions(
        name,
        sourceDirectory,
        actionRuntime,
        target,
      ),
      skills: compileSkills(name, sourceDirectory),
      evaluations: compileEvaluations(name, sourceDirectory),
      mcpServers: compileMcpServers(
        name,
        mcpRegistration,
        registryRoot,
        target,
      ),
      subagentPolicy: configuration.subagents
        ? Object.freeze({ ...configuration.subagents })
        : undefined,
      subagents: Object.freeze({}),
    });
}

function compileMcpServers(
  agentName: string,
  registration: McpRegistration,
  registryRoot: string,
  target: "node" | "browser" | "react-native",
): Record<string, CompiledMcpServerManifest> {
  const servers: Record<string, CompiledMcpServerManifest> = {};
  for (const [key, registeredPath] of Object.entries(registration)) {
    const directory = resolve(registryRoot, registeredPath);
    const configurationPath = resolve(directory, "index.json");
    let configuration: McpServerConfiguration;
    try {
      configuration = JSON.parse(
        readFileSync(configurationPath, "utf8"),
      ) as McpServerConfiguration;
    } catch (error) {
      throw new Error(
        `MCP server "${agentName}/${key}" is missing a valid index.json at ${configurationPath}.`,
        { cause: error },
      );
    }
    validateMcpServerConfiguration(agentName, key, configuration, target);
    servers[key] = Object.freeze({
      ...configuration,
      key,
      directoryName: registeredPath,
    });
  }
  return Object.freeze(servers);
}

function validateMcpServerConfiguration(
  agentName: string,
  key: string,
  configuration: McpServerConfiguration,
  target: "node" | "browser" | "react-native",
): void {
  const label = `MCP server "${agentName}/${key}"`;
  if (
    !configuration ||
    typeof configuration !== "object" ||
    !["streamable-http", "stdio"].includes(configuration.transport)
  ) {
    throw new Error(
      `${label} transport must be "streamable-http" or "stdio".`,
    );
  }
  if (configuration.transport === "streamable-http") {
    let url: URL;
    try {
      url = new URL(configuration.url);
    } catch {
      throw new Error(`${label} requires a valid URL.`);
    }
    if (!["https:", "http:"].includes(url.protocol)) {
      throw new Error(`${label} URL must use HTTP or HTTPS.`);
    }
    if (
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      throw new Error(
        `${label} must use HTTPS unless it connects to localhost.`,
      );
    }
    if (
      configuration.headers !== undefined &&
      (!configuration.headers ||
        typeof configuration.headers !== "object" ||
        Array.isArray(configuration.headers) ||
        Object.values(configuration.headers).some(
          (value) => typeof value !== "string",
        ))
    ) {
      throw new Error(`${label} headers must contain string values.`);
    }
    if (
      configuration.credentials !== undefined &&
      !["omit", "same-origin", "include"].includes(
        configuration.credentials,
      )
    ) {
      throw new Error(`${label} has invalid credentials.`);
    }
  } else {
    if (target !== "node") {
      throw new Error(
        `${label} uses stdio, which is only available for the node target.`,
      );
    }
    if (
      typeof configuration.command !== "string" ||
      !configuration.command.trim()
    ) {
      throw new Error(`${label} requires a command.`);
    }
    if (
      configuration.args !== undefined &&
      (!Array.isArray(configuration.args) ||
        configuration.args.some((value) => typeof value !== "string"))
    ) {
      throw new Error(`${label} args must be an array of strings.`);
    }
    if (
      configuration.env !== undefined &&
      (!configuration.env ||
        typeof configuration.env !== "object" ||
        Array.isArray(configuration.env) ||
        Object.values(configuration.env).some(
          (value) => typeof value !== "string",
        ))
    ) {
      throw new Error(`${label} env must contain string values.`);
    }
  }
  validateNumber(label, "timeoutMs", configuration.timeoutMs, {
    integer: true,
    minimum: 1,
    maximum: 300_000,
  });
  validateNumber(
    label,
    "maxOutputBytes",
    configuration.maxOutputBytes,
    {
      integer: true,
      minimum: 1,
      maximum: 10_000_000,
    },
  );
}

function compileActions(
  agentName: string,
  sourceDirectory: string,
  actionRuntime: "native" | "sandbox",
  target: "node" | "browser" | "react-native",
): Record<string, CompiledActionManifest> {
  const actionsDirectory = resolve(sourceDirectory, "actions");
  if (!existsSync(actionsDirectory)) {
    return {};
  }

  const actions: Record<string, CompiledActionManifest> = {};
  for (const entry of discoverDirectories(actionsDirectory)) {
    const configurationPath = resolve(
      actionsDirectory,
      entry,
      "index.json",
    );
    let configuration: ActionConfiguration;
    try {
      configuration = JSON.parse(
        readFileSync(configurationPath, "utf8"),
      ) as ActionConfiguration;
    } catch (error) {
      throw new Error(
        `Action "${agentName}/${entry}" is missing a valid index.json.`,
        { cause: error },
      );
    }
    validateEnabled(
      `Action "${agentName}/${entry}"`,
      configuration?.enabled,
    );
    if (configuration?.enabled === false) {
      continue;
    }

    if (!configuration.name?.trim() || !configuration.description?.trim()) {
      throw new Error(
        `Action "${agentName}/${entry}" requires name and description.`,
      );
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(configuration.name)) {
      throw new Error(
        `Action "${agentName}/${entry}" has an invalid model-facing name.`,
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
        `Action "${agentName}/${entry}" uses reserved name "${configuration.name}".`,
      );
    }
    const execution = configuration.execution ?? "local";
    if (!["client", "local"].includes(execution)) {
      throw new Error(
        `Action "${agentName}/${entry}" has invalid execution "${configuration.execution}".`,
      );
    }
    if (
      !configuration.parameters ||
      typeof configuration.parameters !== "object" ||
      Array.isArray(configuration.parameters)
    ) {
      throw new Error(
        `Action "${agentName}/${entry}" requires a parameters JSON Schema.`,
      );
    }
    if (
      configuration.outputSchema !== undefined &&
      (typeof configuration.outputSchema !== "object" ||
        configuration.outputSchema === null ||
        Array.isArray(configuration.outputSchema))
    ) {
      throw new Error(
        `Action "${agentName}/${entry}" has an invalid outputSchema.`,
      );
    }
    validateNumber(
      `${agentName}/${entry}`,
      "timeoutMs",
      configuration.timeoutMs,
      { integer: true, minimum: 1, maximum: 120_000 },
    );
    if (
      configuration.permissions?.env !== undefined &&
      !Array.isArray(configuration.permissions.env)
    ) {
      throw new Error(
        `Action "${agentName}/${entry}" permissions.env must be an array.`,
      );
    }
    if (
      configuration.permissions?.network !== undefined &&
      !Array.isArray(configuration.permissions.network)
    ) {
      throw new Error(
        `Action "${agentName}/${entry}" permissions.network must be an array.`,
      );
    }
    for (const permission of [
      ...(configuration.permissions?.env ?? []),
      ...(configuration.permissions?.network ?? []),
    ]) {
      if (typeof permission !== "string" || !permission.trim()) {
        throw new Error(
          `Action "${agentName}/${entry}" has an invalid permission.`,
        );
      }
    }
    if (actions[configuration.name]) {
      throw new Error(
        `Agent "${agentName}" has duplicate action name "${configuration.name}".`,
      );
    }

    const compiledSource =
      execution === "local"
        ? compileLocalAction(
            agentName,
            entry,
            actionsDirectory,
            actionRuntime,
            target,
          )
        : undefined;
    actions[configuration.name] = Object.freeze({
      ...configuration,
      execution,
      directoryName: entry,
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
  rejectLegacyRegistry(agentName, skillsDirectory, "skills");

  const skills: Record<string, CompiledSkillManifest> = {};

  for (const entry of discoverDirectories(skillsDirectory)) {
    const skillDirectory = resolve(skillsDirectory, entry);
    const configurationPath = resolve(skillDirectory, "index.json");
    let configuration: SkillConfiguration;
    try {
      configuration = JSON.parse(
        readFileSync(configurationPath, "utf8"),
      ) as SkillConfiguration;
    } catch (error) {
      throw new Error(
        `Skill "${agentName}/${entry}" is missing a valid index.json at ${configurationPath}.`,
        { cause: error },
      );
    }
    validateEnabled(`Skill "${agentName}/${entry}"`, configuration?.enabled);
    if (configuration?.enabled === false) {
      continue;
    }
    validateSkillConfiguration(agentName, entry, configuration);

    const instructionsPath = resolve(skillDirectory, "instructions.md");
    let instructions: string;
    try {
      instructions = readFileSync(instructionsPath, "utf8").trim();
    } catch (error) {
      throw new Error(
        `Skill "${agentName}/${entry}" is missing instructions.md at ${instructionsPath}.`,
        { cause: error },
      );
    }
    if (!instructions) {
      throw new Error(
        `Skill "${agentName}/${entry}" instructions.md cannot be empty.`,
      );
    }
    if (skills[configuration.name]) {
      throw new Error(
        `Agent "${agentName}" has duplicate skill name "${configuration.name}".`,
      );
    }

    skills[configuration.name] = Object.freeze({
      ...configuration,
      directoryName: entry,
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
  rejectLegacyRegistry(agentName, evaluationsDirectory, "evaluations");

  const evaluations: Record<string, CompiledEvaluationManifest> = {};

  for (const entry of discoverDirectories(evaluationsDirectory)) {
    const evaluationDirectory = resolve(evaluationsDirectory, entry);
    const configurationPath = resolve(evaluationDirectory, "index.json");
    let configuration: EvaluationConfiguration;
    try {
      configuration = JSON.parse(
        readFileSync(configurationPath, "utf8"),
      ) as EvaluationConfiguration;
    } catch (error) {
      throw new Error(
        `Evaluation "${agentName}/${entry}" is missing a valid index.json at ${configurationPath}.`,
        { cause: error },
      );
    }
    validateEnabled(
      `Evaluation "${agentName}/${entry}"`,
      configuration?.enabled,
    );
    if (configuration?.enabled === false) {
      continue;
    }
    validateEvaluationConfiguration(agentName, entry, configuration);
    if (evaluations[configuration.name]) {
      throw new Error(
        `Agent "${agentName}" has duplicate evaluation name "${configuration.name}".`,
      );
    }

    evaluations[configuration.name] = Object.freeze({
      ...configuration,
      enabled: true,
      provider: configuration.provider as CompiledEvaluationManifest["provider"],
      directoryName: entry,
      metrics: Object.freeze(
        configuration.metrics.map((metric) => Object.freeze({ ...metric })),
      ),
    });
  }

  return Object.freeze(evaluations);
}

function discoverDirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        !entry.name.startsWith(".") &&
        (entry.isDirectory() ||
          (entry.isSymbolicLink() &&
            statSync(resolve(directory, entry.name)).isDirectory())),
    )
    .map((entry) => entry.name)
    .sort();
}

function rejectLegacyRegistry(
  agentName: string,
  directory: string,
  collection: "skills" | "evaluations",
): void {
  if (existsSync(resolve(directory, "index.js"))) {
    throw new Error(
      `Agent "${agentName}" ${collection}/index.js is no longer supported. Remove the registry; folders are discovered automatically and can be disabled with "enabled": false.`,
    );
  }
}

function validateEnabled(label: string, enabled: unknown): void {
  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error(`${label} enabled must be a boolean.`);
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
  actionRuntime: "native" | "sandbox",
  target: "node" | "browser" | "react-native",
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
      platform:
        actionRuntime === "native" && target === "node"
          ? "node"
          : "browser",
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
