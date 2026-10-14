import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

export function loadProjectEnvironment(projectRoot: string): void {
  const path = resolve(projectRoot, ".env");
  if (existsSync(path)) {
    const result = config({ path, override: false, quiet: true });
    if (result.error) {
      throw result.error;
    }
  }
}
