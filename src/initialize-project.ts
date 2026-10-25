import { existsSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  console.log(
    '\nRun "orcha dev" to validate changes or "orcha run exampleAgent --input \\"Hello\\"" to execute the agent.',
  );
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
