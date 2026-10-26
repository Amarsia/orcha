#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  detectPackageManager,
  installCommand,
  runPackageManager,
} from "./package-manager.js";

const TOOLING_PACKAGES = [
  "@orchajs/playground-ui@^0.2.5",
  "esbuild@^0.25",
  "chokidar@^4",
  "dotenv@^16",
] as const;
const BOOTSTRAP_ENV = "ORCHA_TOOLING_BOOTSTRAPPED";

void run();

async function run(): Promise<void> {
  try {
    if (process.argv[2] === "init") {
      if (process.argv.length > 3) {
        throw new Error("Usage: orchajs init");
      }
      await installProjectDependencies();
      const { initializeProject } = await import(
        "./initialize-project.js"
      );
      await initializeProject(process.cwd());
      return;
    }
    await import("./cli.js");
  } catch (error) {
    if (
      process.argv[2] === "playground" &&
      process.env[BOOTSTRAP_ENV] !== "1" &&
      isMissingToolingError(error)
    ) {
      await bootstrapPlayground();
      return;
    }
    reportError(error);
  }
}

async function bootstrapPlayground(): Promise<void> {
  const packageManager = detectPackageManager();
  const installation = installCommand(
    packageManager,
    TOOLING_PACKAGES,
    true,
  );
  console.log(
    `[orcha] Installing development-only playground tooling with ${packageManager}...`,
  );
  const installCode = await runPackageManager(
    installation.command,
    installation.arguments,
  );
  if (installCode !== 0) {
    process.exitCode = installCode;
    return;
  }

  const retryCode = await runPackageManager(
    process.execPath,
    [process.argv[1], ...process.argv.slice(2)],
    {
      env: {
        ...process.env,
        [BOOTSTRAP_ENV]: "1",
      },
    },
  );
  process.exitCode = retryCode;
}

async function installProjectDependencies(): Promise<void> {
  const packagePath = resolve("package.json");
  if (!existsSync(packagePath)) {
    throw new Error(
      'Missing "package.json". Run your package manager initialization command first, or use "npx create-orcha <project-directory>" to create a new project.',
    );
  }
  const packageManager = detectPackageManager();
  const ownPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof ownPackage.version !== "string") {
    throw new Error("Could not determine the installed orchajs version.");
  }

  console.log(
    `[orcha] Installing Orcha and development tooling with ${packageManager}...`,
  );
  const runtimeInstallation = installCommand(
    packageManager,
    [`orchajs@${ownPackage.version}`],
    false,
  );
  const runtimeCode = await runPackageManager(
    runtimeInstallation.command,
    runtimeInstallation.arguments,
  );
  if (runtimeCode !== 0) {
    throw new Error("Failed to install orchajs in the current project.");
  }

  const toolingInstallation = installCommand(
    packageManager,
    TOOLING_PACKAGES,
    true,
  );
  const toolingCode = await runPackageManager(
    toolingInstallation.command,
    toolingInstallation.arguments,
  );
  if (toolingCode !== 0) {
    throw new Error(
      "Failed to install Orcha development tooling in the current project.",
    );
  }
}

function isMissingToolingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return ["@orchajs/playground-ui", "esbuild", "chokidar", "dotenv"].some(
    (name) =>
    message.includes(`"${name}"`) || message.includes(`'${name}'`),
  );
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (isMissingToolingError(error)) {
    console.error(
      `Orcha development tooling is missing. Run "orchajs playground" to install the development-only playground dependencies automatically.`,
    );
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
