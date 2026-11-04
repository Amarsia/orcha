import { existsSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildProject } from "./compiler/build-project.js";
import { AGENTS_MD } from "./cli-agents-template.js";

export async function initializeProject(projectRoot: string): Promise<void> {
  const files = new Map<string, string>([
    [
      "orcha/exampleAgent/index.json",
      `${JSON.stringify(
        {
          name: "Example Agent",
          description: "Answer general questions clearly and concisely.",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          region: "provider_managed",
          maxTokens: 10240,
          outputType: "text",
        },
        null,
        2,
      )}\n`,
    ],
    [
      "orcha/exampleAgent/instructions.md",
      "You are a concise and helpful assistant.\n",
    ],
    [
      "orcha/index.ts",
      [
        'import { orcha } from "orchajs";',
        "",
        "orcha.init({",
        "  providers: {",
        "    anthropic: process.env.ANTHROPIC_API_KEY ?? \"\",",
        "  },",
        "  agents: {",
        "    exampleAgent: \"./exampleAgent\",",
        "  },",
        "});",
        "",
      ].join("\n"),
    ],
    ["AGENTS.md", AGENTS_MD],
  ]);

  for (const [relativePath, contents] of files) {
    const path = resolve(projectRoot, relativePath);
    if (existsSync(path)) {
      console.log(`Skipped existing ${relativePath}`);
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
    console.log(`Created ${relativePath}`);
  }

  await ensureGitignore(projectRoot);
  await ensurePackageScripts(projectRoot);
  await buildProject({ projectRoot }).catch(() => undefined);
  console.log(
    '\nRun "orchajs dev" to validate changes or "orchajs run exampleAgent --input \\"Hello\\"" to execute the agent.',
  );
}

async function ensurePackageScripts(projectRoot: string): Promise<void> {
  const packagePath = resolve(projectRoot, "package.json");
  if (!existsSync(packagePath)) {
    return;
  }
  try {
    const raw = await readFile(packagePath, "utf8");
    const parsed = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      [key: string]: unknown;
    };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    const scripts = { ...(parsed.scripts ?? {}) };
    let changed = false;

    if (!scripts.build) {
      scripts.build = "orchajs build";
      changed = true;
    } else if (!scripts.build.includes("orchajs build")) {
      if (!scripts.prebuild) {
        scripts.prebuild = "orchajs build";
        changed = true;
      } else if (!scripts.prebuild.includes("orchajs build")) {
        scripts.prebuild = `orchajs build && ${scripts.prebuild}`;
        changed = true;
      }
    }

    if (
      scripts.dev &&
      !scripts.dev.includes("orchajs") &&
      !scripts.predev?.includes("orchajs build")
    ) {
      scripts.predev = scripts.predev
        ? `orchajs build && ${scripts.predev}`
        : "orchajs build";
      changed = true;
    }

    if (changed) {
      parsed.scripts = scripts;
      await writeFile(
        packagePath,
        `${JSON.stringify(parsed, null, 2)}\n`,
        "utf8",
      );
      console.log("Updated package.json scripts");
    }
  } catch {
    // Best-effort package.json script update.
  }
}

async function ensureGitignore(projectRoot: string): Promise<void> {
  const path = resolve(projectRoot, ".gitignore");
  const entry = ".orcha/";
  const current = existsSync(path) ? await readFile(path, "utf8") : "";
  const entries = current.split(/\r?\n/).map((line) => line.trim());

  if (entries.includes(entry)) {
    return;
  }

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  await appendFile(path, `${prefix}${entry}\n`, "utf8");
  console.log("Updated .gitignore");
}
