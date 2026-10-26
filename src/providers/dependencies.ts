import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
  detectPackageManager,
  installCommand,
  runPackageManager,
} from "../package-manager.js";
import type {
  CompiledAgentManifest,
  CompiledBundle,
} from "../types.js";

const providerDependencies = {
  bedrock: {
    packageName: "@aws-sdk/client-bedrock-runtime",
    installSpec: "@aws-sdk/client-bedrock-runtime@3.967.0",
  },
  googlegenai: {
    packageName: "@google/genai",
    installSpec: "@google/genai@2.22.0",
  },
  vertexai: {
    packageName: "@google/genai",
    installSpec: "@google/genai@2.22.0",
  },
} as const;

const mcpDependencies = [
  {
    packageName: "@modelcontextprotocol/sdk",
    installSpec: "@modelcontextprotocol/sdk@1.32.1",
  },
  {
    packageName: "zod",
    installSpec: "zod@3.25.76",
  },
] as const;

const installations = new Map<string, Promise<void>>();

export function ensureCompiledProviderDependencies(
  bundle: CompiledBundle,
  projectRoot: string,
): Promise<void> {
  const providers = allCompiledAgents(bundle.agents).flatMap(
    (agent) => [
      agent.provider,
      ...Object.values(agent.evaluations ?? {})
        .filter((evaluation) => evaluation.enabled !== false)
        .map((evaluation) => evaluation.provider),
    ],
  );
  return ensureProviderDependencies(providers, projectRoot);
}

export async function ensureProviderDependencies(
  providerNames: readonly string[],
  projectRoot: string,
): Promise<void> {
  const declaredPackages = await readDeclaredPackages(projectRoot);
  const dependencies = [
    ...new Map(
      providerNames.flatMap((providerName) => {
        const dependency =
          providerDependencies[
            providerName as keyof typeof providerDependencies
          ];
        return dependency
          ? [[dependency.packageName, dependency] as const]
          : [];
      }),
    ).values(),
  ].filter(
    (dependency) =>
      !declaredPackages.has(dependency.packageName) ||
      !isInstalled(dependency.packageName, projectRoot),
  );
  if (dependencies.length === 0) {
    return;
  }
  return ensureDependencies(dependencies, projectRoot, "provider");
}

export async function ensureCompiledMcpDependencies(
  bundle: CompiledBundle,
  projectRoot: string,
): Promise<void> {
  const hasMcp = allCompiledAgents(bundle.agents).some(
    (agent) => Object.keys(agent.mcpServers ?? {}).length > 0,
  );
  if (!hasMcp) {
    return;
  }
  const declaredPackages = await readDeclaredPackages(projectRoot);
  const missing = mcpDependencies.filter(
    (dependency) =>
      !declaredPackages.has(dependency.packageName) ||
      !isInstalled(dependency.packageName, projectRoot),
  );
  if (missing.length === 0) {
    return;
  }
  return ensureDependencies(missing, projectRoot, "MCP");
}

async function ensureDependencies(
  dependencies: ReadonlyArray<{
    packageName: string;
    installSpec: string;
  }>,
  projectRoot: string,
  kind: "provider" | "MCP",
): Promise<void> {
  const key = `${projectRoot}:${dependencies
    .map((dependency) => dependency.packageName)
    .sort()
    .join(",")}`;
  const existing = installations.get(key);
  if (existing) {
    return existing;
  }

  const installation = installDependencies(
    dependencies,
    projectRoot,
    kind,
  ).finally(() => installations.delete(key));
  installations.set(key, installation);
  return installation;
}

async function readDeclaredPackages(
  projectRoot: string,
): Promise<Set<string>> {
  const packageJson = JSON.parse(
    await readFile(resolve(projectRoot, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  const declared = new Set<string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const dependencies = packageJson[field];
    if (
      typeof dependencies !== "object" ||
      dependencies === null ||
      Array.isArray(dependencies)
    ) {
      continue;
    }
    for (const packageName of Object.keys(dependencies)) {
      declared.add(packageName);
    }
  }
  return declared;
}

function allCompiledAgents(
  agents: CompiledBundle["agents"],
): CompiledAgentManifest[] {
  return Object.values(agents).flatMap((agent) => [
    agent,
    ...Object.values(agent.subagents ?? {}),
  ]);
}

function isInstalled(
  packageName: string,
  projectRoot: string,
): boolean {
  try {
    createRequire(resolve(projectRoot, "package.json")).resolve(
      packageName,
    );
    return true;
  } catch {
    return false;
  }
}

async function installDependencies(
  dependencies: ReadonlyArray<{
    packageName: string;
    installSpec: string;
  }>,
  projectRoot: string,
  kind: "provider" | "MCP",
): Promise<void> {
  const packageManager = detectPackageManager(projectRoot);
  const packageNames = dependencies.map(
    (dependency) => dependency.packageName,
  );
  const command = installCommand(
    packageManager,
    dependencies.map((dependency) => dependency.installSpec),
    false,
  );
  console.log(
    `[orcha] Installing required ${kind} ${packageNames.length === 1 ? "dependency" : "dependencies"} with ${packageManager}: ${packageNames.join(", ")}`,
  );
  const exitCode = await runPackageManager(
    command.command,
    command.arguments,
    { cwd: projectRoot },
  );
  if (exitCode !== 0) {
    throw new Error(
      `Failed to install required ${kind} ${packageNames.length === 1 ? "dependency" : "dependencies"}: ${packageNames.join(", ")}`,
    );
  }
}
