#!/usr/bin/env node

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const templateDirectory = join(packageDirectory, "template");

const HELP = `Create a complete OrchaJS project.

Usage:
  create-orcha <project-directory> [options]

Options:
  --no-git      Do not initialize a Git repository
  -h, --help    Show this help

Examples:
  npm create orcha@latest my-agent-app
  npx create-orcha my-agent-app
  create-orcha .
`;

function parseArguments(arguments_) {
  const options = { git: true };
  const positional = [];

  for (const argument of arguments_) {
    if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else if (argument === "--no-git") {
      options.git = false;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  if (positional.length > 1) {
    throw new Error("Provide exactly one project directory.");
  }

  return { ...options, projectDirectory: positional[0] };
}

function packageNameFromDirectory(directory) {
  const name = parse(directory).base
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

  if (!name) {
    throw new Error("The project directory must produce a valid npm package name.");
  }

  return name;
}

async function assertWritableTarget(targetDirectory) {
  if (!existsSync(targetDirectory)) {
    return false;
  }

  const entries = await readdir(targetDirectory);
  if (entries.length > 0) {
    throw new Error(`Target directory is not empty: ${targetDirectory}`);
  }

  return true;
}

function run(command, arguments_, cwd, quiet = false) {
  return spawnSync(command, arguments_, {
    cwd,
    encoding: "utf8",
    stdio: quiet ? "pipe" : "inherit",
  });
}

function isInsideGitRepository(directory) {
  const result = run("git", ["-C", directory, "rev-parse", "--is-inside-work-tree"], directory, true);
  return result.status === 0 && result.stdout.trim() === "true";
}

function initializeGit(targetDirectory) {
  if (isInsideGitRepository(dirname(targetDirectory))) {
    return false;
  }

  const result = run("git", ["init"], targetDirectory, true);
  return result.status === 0;
}

async function configureProject(targetDirectory, projectName, orchaVersion) {
  const packagePath = join(targetDirectory, "package.json");
  const readmePath = join(targetDirectory, "README.md");
  const packageTemplate = await readFile(packagePath, "utf8");
  const readmeTemplate = await readFile(readmePath, "utf8");

  await Promise.all([
    writeFile(
      packagePath,
      `${packageTemplate
        .replaceAll("__PROJECT_NAME__", projectName)
        .replaceAll("__ORCHA_VERSION__", orchaVersion)
        .trim()}\n`,
    ),
    writeFile(readmePath, readmeTemplate.replaceAll("__PROJECT_NAME__", projectName)),
  ]);
}

async function createProject(options) {
  if (!options.projectDirectory) {
    throw new Error(`Missing project directory.\n\n${HELP}`);
  }

  const targetDirectory = resolve(options.projectDirectory);
  if (targetDirectory === parse(targetDirectory).root) {
    throw new Error("Refusing to create a project at the filesystem root.");
  }

  const targetExisted = await assertWritableTarget(targetDirectory);
  const projectName = packageNameFromDirectory(targetDirectory);
  const packageMetadata = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8"),
  );

  await mkdir(targetDirectory, { recursive: true });

  try {
    await cp(templateDirectory, targetDirectory, { recursive: true });
    await configureProject(targetDirectory, projectName, packageMetadata.orchaVersion);
  } catch (error) {
    if (!targetExisted) {
      await rm(targetDirectory, { recursive: true, force: true });
    }
    throw error;
  }

  const initializedGit = options.git && initializeGit(targetDirectory);
  const relativeTarget = resolve(".") === targetDirectory ? "." : options.projectDirectory;

  console.log(`\nCreated ${projectName} at ${targetDirectory}`);
  if (initializedGit) {
    console.log("Initialized an empty Git repository.");
  }
  console.log("\nNext steps:");
  if (relativeTarget !== ".") {
    console.log(`  cd ${relativeTarget}`);
  }
  console.log("  npm install");
  console.log("  cp .env.example .env");
  console.log("  # Add OPENAI_API_KEY to .env");
  console.log("  npm run dev");
  console.log("\nThen open http://localhost:4310");
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(HELP);
      return;
    }
    await createProject(options);
  } catch (error) {
    console.error(`\ncreate-orcha: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

await main();
