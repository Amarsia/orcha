#!/usr/bin/env node

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildProject } from "./compiler/build-project.js";

const command = process.argv[2];

try {
  if (command === "init") {
    await initializeProject(process.cwd());
  } else if (command === "build") {
    const outputPath = await buildProject({ projectRoot: process.cwd() });
    console.log(`Built ${outputPath}`);
  } else {
    printUsage();
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function initializeProject(projectRoot: string): Promise<void> {
  const files = new Map<string, string>([
    [
      "orcha/exampleAgent/index.json",
      `${JSON.stringify(
        {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          region: "provider_managed",
          maxTokens: 1024,
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
    '\nImport "./orcha/index.js" once from your application entrypoint, then run your existing development command.',
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

function printUsage(): void {
  console.log(["Usage: orcha <command>", "", "Commands:", "  init", "  build"].join("\n"));
}
