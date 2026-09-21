import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

export function loadProjectEnvironment(projectRoot: string): void {
  const path = resolve(projectRoot, ".env");
  if (existsSync(path)) {
    loadEnvFile(path);
  }
}
