import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getOrchaRuntimeContext } from "../runtime/context.js";
import type { OrchaClient } from "../runtime/create-orcha.js";
import type {
  AgentRegistration,
  CompiledAgentManifest,
} from "../types.js";

export interface PlaygroundSourceItem {
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  configuration: Record<string, unknown>;
  rawConfiguration: string;
  instructions?: string;
  source?: string;
}

export interface PlaygroundAgentSource {
  key: string;
  name: string;
  description?: string;
  provider: string;
  model: string;
  actionCount: number;
  skillCount: number;
  evaluationCount: number;
  subagentCount: number;
  configuration: Record<string, unknown>;
  rawConfiguration: string;
  instructions: string;
  actions: PlaygroundSourceItem[];
  skills: PlaygroundSourceItem[];
  evaluations: PlaygroundSourceItem[];
  subagents: Array<{
    key: string;
    name: string;
    description?: string;
  }>;
}

export async function readPlaygroundAgentSource(
  orcha: OrchaClient,
  agentKey: string,
): Promise<PlaygroundAgentSource> {
  const context = getOrchaRuntimeContext(orcha);
  const manifest = context.bundle.agents[agentKey];
  const registration = context.registrations[agentKey];
  if (!manifest || !registration) {
    throw new Error(`Unknown agent "${agentKey}".`);
  }
  const directory = registeredAgentDirectory(
    context.projectRoot,
    registration,
  );
  const rawConfiguration = await readRequired(
    resolve(directory, "index.json"),
  );
  const configuration = parseObject(rawConfiguration, `${agentKey}/index.json`);
  const instructions = await readRequired(
    resolve(directory, "instructions.md"),
  );

  return {
    key: agentKey,
    name: manifest.name,
    description: manifest.description,
    provider: manifest.provider,
    model: manifest.model,
    actionCount: Object.keys(manifest.actions).length,
    skillCount: Object.keys(manifest.skills).length,
    evaluationCount: Object.keys(manifest.evaluations).length,
    subagentCount: Object.keys(manifest.subagents).length,
    configuration,
    rawConfiguration,
    instructions,
    actions: await readCollectionItems(
      directory,
      "actions",
      manifest.actions,
      true,
    ),
    skills: await readCollectionItems(
      directory,
      "skills",
      manifest.skills,
      false,
    ),
    evaluations: await readCollectionItems(
      directory,
      "evaluations",
      manifest.evaluations,
      false,
    ),
    subagents: Object.entries(manifest.subagents).map(([key, child]) => ({
      key,
      name: child.name,
      description: child.description,
    })),
  };
}

function registeredAgentDirectory(
  projectRoot: string,
  registration: AgentRegistration,
): string {
  const registeredPath =
    typeof registration === "string" ? registration : registration.path;
  return resolve(projectRoot, "orcha", registeredPath);
}

async function readCollectionItems(
  agentDirectory: string,
  collection: "actions" | "skills" | "evaluations",
  manifests:
    | CompiledAgentManifest["actions"]
    | CompiledAgentManifest["skills"]
    | CompiledAgentManifest["evaluations"],
  includeSource: boolean,
): Promise<PlaygroundSourceItem[]> {
  const root = resolve(agentDirectory, collection);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
  const byDirectory = new Map(
    Object.entries(manifests).map(([key, manifest]) => [
      manifest.directoryName,
      { key, manifest },
    ]),
  );
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const directory = resolve(root, entry.name);
        const rawConfiguration = await readRequired(
          resolve(directory, "index.json"),
        );
        const configuration = parseObject(
          rawConfiguration,
          `${collection}/${entry.name}/index.json`,
        );
        const compiled = byDirectory.get(entry.name);
        const instructions = includeSource
          ? undefined
          : await readOptional(resolve(directory, "instructions.md"));
        const source = includeSource
          ? await readOptional(resolve(directory, "index.js"))
          : undefined;
        return {
          key: compiled?.key ?? entry.name,
          name:
            typeof configuration.name === "string"
              ? configuration.name
              : entry.name,
          description:
            typeof configuration.description === "string"
              ? configuration.description
              : undefined,
          enabled: configuration.enabled !== false,
          configuration,
          rawConfiguration,
          ...(instructions !== undefined ? { instructions } : {}),
          ...(source !== undefined ? { source } : {}),
        };
      }),
  );
}

async function readRequired(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}

function parseObject(
  source: string,
  label: string,
): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object.`);
  }
  return value as Record<string, unknown>;
}
