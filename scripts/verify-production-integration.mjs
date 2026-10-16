import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(process.argv[2] ?? ".playground");
const applicationBundle = resolve(
  process.argv[3] ?? ".playground/dist/index.js",
);
const generatedRuntime = resolve(projectRoot, ".orcha/dist/bundle.js");
const generatedManifest = resolve(
  projectRoot,
  ".orcha/dist/manifest.json",
);

await access(generatedRuntime).catch(() => {
  throw new Error(
    `Orcha production runtime was not generated at ${generatedRuntime}.`,
  );
});
await access(generatedManifest).catch(() => {
  throw new Error(
    `Orcha compiled manifest was not generated at ${generatedManifest}.`,
  );
});

const source = await readFile(applicationBundle, "utf8");
const unresolvedImport =
  /\bfrom\s*["']orchajs["']|\brequire\s*\(\s*["']orchajs["']\s*\)|\bimport\s*\(\s*["']orchajs["']\s*\)/;

if (unresolvedImport.test(source)) {
  throw new Error(
    `Production bundle ${applicationBundle} still contains a bare "orchajs" import.`,
  );
}

console.log(
  `Verified generated Orcha runtime, manifest, and bundled application at ${applicationBundle}.`,
);
