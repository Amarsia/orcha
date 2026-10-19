#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TOOLING_PACKAGES = [
  "@orchajs/playground-ui@^0.2.3",
  "esbuild@^0.25",
  "chokidar@^4",
  "dotenv@^16",
] as const;
const BOOTSTRAP_ENV = "ORCHA_TOOLING_BOOTSTRAPPED";

void run();

async function run(): Promise<void> {
  try {
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
  const installation = installCommand(packageManager);
  console.log(
    `[orcha] Installing development-only playground tooling with ${packageManager}...`,
  );
  const installCode = await runProcess(
    installation.command,
    installation.arguments,
  );
  if (installCode !== 0) {
    process.exitCode = installCode;
    return;
  }

  const retryCode = await runProcess(
    process.execPath,
    [process.argv[1], ...process.argv.slice(2)],
    {
      ...process.env,
      [BOOTSTRAP_ENV]: "1",
    },
  );
  process.exitCode = retryCode;
}

function detectPackageManager(): "npm" | "yarn" | "pnpm" | "bun" {
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent?.startsWith("yarn/")) {
    return "yarn";
  }
  if (userAgent?.startsWith("pnpm/")) {
    return "pnpm";
  }
  if (userAgent?.startsWith("bun/")) {
    return "bun";
  }
  if (existsSync(resolve("yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(resolve("pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (
    existsSync(resolve("bun.lock")) ||
    existsSync(resolve("bun.lockb"))
  ) {
    return "bun";
  }
  return "npm";
}

function installCommand(
  packageManager: "npm" | "yarn" | "pnpm" | "bun",
): { command: string; arguments: string[] } {
  switch (packageManager) {
    case "yarn":
      return {
        command: executable("yarn"),
        arguments: ["add", "--dev", ...TOOLING_PACKAGES],
      };
    case "pnpm":
      return {
        command: executable("pnpm"),
        arguments: ["add", "--save-dev", ...TOOLING_PACKAGES],
      };
    case "bun":
      return {
        command: executable("bun"),
        arguments: ["add", "--dev", ...TOOLING_PACKAGES],
      };
    default:
      return {
        command: executable("npm"),
        arguments: ["install", "--save-dev", ...TOOLING_PACKAGES],
      };
  }
}

function executable(command: string): string {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

function runProcess(
  command: string,
  arguments_: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolveProcess(code ?? 1);
    });
  });
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
      `Orcha development tooling is missing. Run "orcha playground" to install the development-only playground dependencies automatically.`,
    );
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}
