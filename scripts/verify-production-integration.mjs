import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(process.argv[2] ?? ".playground");
const applicationBundle = resolve(
  process.argv[3] ?? ".playground/dist/index.js",
);
const generatedRuntime = resolve(projectRoot, ".orcha/dist/bundle.js");

await access(generatedRuntime).catch(() => {
  throw new Error(
    `Orcha production runtime was not generated at ${generatedRuntime}.`,
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
  `Verified generated Orcha runtime and bundled application at ${applicationBundle}.`,
);
