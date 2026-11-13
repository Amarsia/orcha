import { chmod, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = resolve(root, "dist");

await chmod(resolve(distDirectory, "bin.js"), 0o755);
await verifyDeclarationCompatibility(distDirectory);

async function verifyDeclarationCompatibility(directory) {
  const declarationFiles = await collectDeclarationFiles(directory);
  const inlineTypePattern = /(?:import|export)\s*\{[^}]*\btype\s+[A-Za-z0-9_$]/s;

  for (const filePath of declarationFiles) {
    const contents = await readFile(filePath, "utf8");
    if (inlineTypePattern.test(contents)) {
      throw new Error(
        `Declaration file "${filePath}" contains an inline type import/export specifier, which breaks TypeScript < 4.5 consumers. Use statement-level "import type" or "export type" in src/.`,
      );
    }
  }
}

async function collectDeclarationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return collectDeclarationFiles(path);
      }
      return entry.name.endsWith(".d.ts") ? [path] : [];
    }),
  );
  return files.flat();
}
