import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  CompiledActionManifest,
  CompiledAgentManifest,
  CompiledBundle,
} from "../types.js";

export interface AmarsiaProjectMetadata {
  schema_version: 1;
  content_hash: string;
  project: {
    external_id: string;
    name: string;
    description?: string;
    root_path: string;
    package_name?: string;
    repository_url?: string;
    metadata: Record<string, unknown>;
  };
  agents: AmarsiaAgentMetadata[];
}

export interface AmarsiaAgentMetadata {
  external_id: string;
  parent_external_id?: string;
  name: string;
  description?: string;
  provider?: string;
  model?: string;
  output_type?: string;
  actions: AmarsiaActionMetadata[];
  skills: AmarsiaSkillMetadata[];
  evaluations: AmarsiaEvaluationMetadata[];
  tests: AmarsiaTestMetadata[];
  metadata: Record<string, unknown>;
}

export interface AmarsiaActionMetadata {
  key: string;
  name: string;
  description: string;
  execution?: "client" | "local";
  parameters: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  permissions: Record<string, string[]>;
  timeout_ms?: number;
  side_effect?: boolean;
  source_hash?: string;
}

export interface AmarsiaSkillMetadata {
  key: string;
  name: string;
  description?: string;
  enabled?: boolean;
  triggers: string[];
}

export interface AmarsiaEvaluationMetadata {
  key: string;
  name: string;
  description?: string;
  enabled?: boolean;
  provider?: string;
  model?: string;
  metrics: Array<{
    name: string;
    description?: string;
    threshold?: number;
  }>;
}

export interface AmarsiaTestMetadata {
  key: string;
  name?: string;
  description?: string;
  enabled?: boolean;
}

export function createAmarsiaProjectMetadata(
  bundle: CompiledBundle,
  projectRoot: string,
): AmarsiaProjectMetadata {
  const packageInfo = readPackageInfo(projectRoot);
  const projectExternalId = hashStable({
    packageName: packageInfo.name,
    rootPath: projectRoot,
  }).slice(0, 32);
  const agents = flattenAgents(bundle.agents);
  const content = {
    project: {
      external_id: projectExternalId,
      name: packageInfo.name ?? "Orcha project",
      description: packageInfo.description,
      root_path: projectRoot,
      package_name: packageInfo.name,
      repository_url: packageInfo.repositoryUrl,
      metadata: {
        packageVersion: packageInfo.version,
        orchaSchemaVersion: bundle.schemaVersion,
        actionRuntime: bundle.actionRuntime,
      },
    },
    agents,
  };

  return {
    schema_version: 1,
    content_hash: hashStable(content),
    ...content,
  };
}

function flattenAgents(
  agents: Record<string, CompiledAgentManifest>,
): AmarsiaAgentMetadata[] {
  const result: AmarsiaAgentMetadata[] = [];
  const visit = (
    manifest: CompiledAgentManifest,
    parentExternalId?: string,
  ) => {
    result.push(agentMetadata(manifest, parentExternalId));
    for (const subagent of Object.values(manifest.subagents ?? {})) {
      visit(subagent, manifest.key);
    }
  };

  for (const manifest of Object.values(agents)) {
    visit(manifest);
  }
  return result;
}

function agentMetadata(
  manifest: CompiledAgentManifest,
  parentExternalId?: string,
): AmarsiaAgentMetadata {
  return {
    external_id: manifest.key,
    parent_external_id: parentExternalId,
    name: manifest.name,
    description: manifest.description,
    provider: manifest.provider,
    model: manifest.model,
    output_type: manifest.outputType,
    actions: Object.entries(manifest.actions ?? {}).map(([key, action]) =>
      actionMetadata(key, action),
    ),
    skills: Object.entries(manifest.skills ?? {}).map(([key, skill]) => ({
      key,
      name: skill.name,
      description: skill.description,
      enabled: skill.enabled,
      triggers: skill.triggers ?? [],
    })),
    evaluations: Object.entries(manifest.evaluations ?? {}).map(
      ([key, evaluation]) => ({
        key,
        name: evaluation.name,
        description: evaluation.description,
        enabled: evaluation.enabled,
        provider: evaluation.provider,
        model: evaluation.model,
        metrics: evaluation.metrics.map((metric) => ({
          name: metric.name,
          description: metric.description,
          threshold: metric.threshold,
        })),
      }),
    ),
    tests: [],
    metadata: {
      region: manifest.region,
      maxTokens: manifest.maxTokens,
      reasoningLevel: manifest.reasoningLevel,
      outputSchema: manifest.outputSchema,
      subagents: Object.keys(manifest.subagents ?? {}),
      subagentPolicy: manifest.subagentPolicy,
    },
  };
}

function actionMetadata(
  key: string,
  action: CompiledActionManifest,
): AmarsiaActionMetadata {
  return {
    key,
    name: action.name,
    description: action.description,
    execution: action.execution,
    parameters: action.parameters,
    output_schema: action.outputSchema,
    permissions: action.permissions ?? {},
    timeout_ms: action.timeoutMs,
    side_effect: action.sideEffect,
    source_hash: action.sourceHash,
  };
}

function readPackageInfo(projectRoot: string): {
  name?: string;
  description?: string;
  version?: string;
  repositoryUrl?: string;
} {
  const packagePath = join(projectRoot, "package.json");
  if (!existsSync(packagePath)) {
    return { repositoryUrl: readGitRemoteUrl(projectRoot) };
  }
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
      name?: unknown;
      description?: unknown;
      version?: unknown;
      repository?: unknown;
    };
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      description:
        typeof parsed.description === "string" ? parsed.description : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
      repositoryUrl:
        readPackageRepositoryUrl(parsed.repository) ?? readGitRemoteUrl(projectRoot),
    };
  } catch {
    return { repositoryUrl: readGitRemoteUrl(projectRoot) };
  }
}

function readPackageRepositoryUrl(repository: unknown): string | undefined {
  if (typeof repository === "string") {
    return repository;
  }
  if (
    repository &&
    typeof repository === "object" &&
    typeof (repository as { url?: unknown }).url === "string"
  ) {
    return (repository as { url: string }).url;
  }
  return undefined;
}

function readGitRemoteUrl(projectRoot: string): string | undefined {
  const configPath = resolveGitConfigPath(projectRoot);
  if (!configPath || !existsSync(configPath)) {
    return undefined;
  }
  const config = readFileSync(configPath, "utf8");
  const origin = config.match(/\[remote "origin"\][\s\S]*?\n\s*url = (.+)/);
  return origin?.[1]?.trim();
}

function resolveGitConfigPath(projectRoot: string): string | undefined {
  const gitPath = join(projectRoot, ".git");
  if (!existsSync(gitPath)) {
    return undefined;
  }
  try {
    const gitFile = readFileSync(gitPath, "utf8");
    const gitDir = gitFile.match(/^gitdir: (.+)$/m)?.[1]?.trim();
    if (gitDir) {
      return join(resolve(projectRoot, gitDir), "config");
    }
  } catch {
    return join(gitPath, "config");
  }
  return join(dirname(gitPath), ".git", "config");
}

function hashStable(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortStable(value)))
    .digest("hex");
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortStable);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortStable(entry)]),
    );
  }
  return value;
}
