import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

export function detectPackageManager(
  projectRoot: string = process.cwd(),
): PackageManager {
  if (existsSync(resolve(projectRoot, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(resolve(projectRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (
    existsSync(resolve(projectRoot, "bun.lock")) ||
    existsSync(resolve(projectRoot, "bun.lockb"))
  ) {
    return "bun";
  }
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
  return "npm";
}

export function installCommand(
  packageManager: PackageManager,
  packages: readonly string[],
  development: boolean,
): { command: string; arguments: string[] } {
  switch (packageManager) {
    case "yarn":
      return {
        command: executable("yarn"),
        arguments: ["add", ...(development ? ["--dev"] : []), ...packages],
      };
    case "pnpm":
      return {
        command: executable("pnpm"),
        arguments: [
          "add",
          ...(development ? ["--save-dev"] : []),
          ...packages,
        ],
      };
    case "bun":
      return {
        command: executable("bun"),
        arguments: ["add", ...(development ? ["--dev"] : []), ...packages],
      };
    default:
      return {
        command: executable("npm"),
        arguments: [
          "install",
          ...(development ? ["--save-dev"] : []),
          ...packages,
        ],
      };
  }
}

export function runPackageManager(
  command: string,
  arguments_: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<number> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
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

function executable(command: string): string {
  return process.platform === "win32" ? `${command}.cmd` : command;
}
