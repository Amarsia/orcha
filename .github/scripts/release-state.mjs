import { appendFileSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageName = packageJson.name;
const packageVersion = packageJson.version;
const registryName = encodeURIComponent(packageName);
const response = await fetch(
  `https://registry.npmjs.org/${registryName}/${packageVersion}`,
);

if (!response.ok && response.status !== 404) {
  throw new Error(`Unable to check npm release state: HTTP ${response.status}.`);
}

if (!process.env.GITHUB_OUTPUT) {
  throw new Error("GITHUB_OUTPUT is unavailable.");
}

appendFileSync(
  process.env.GITHUB_OUTPUT,
  [
    `unpublished=${response.status === 404}`,
    `tag=${packageName}@${packageVersion}`,
    "",
  ].join("\n"),
);
