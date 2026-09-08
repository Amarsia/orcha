import { appendFileSync, existsSync, readFileSync } from "node:fs";

const prereleasePath = ".changeset/pre.json";
let channel = "latest";

if (existsSync(prereleasePath)) {
  const prerelease = JSON.parse(readFileSync(prereleasePath, "utf8"));
  if (prerelease.mode === "pre") {
    channel = prerelease.tag;
  }
}

if (!process.env.GITHUB_OUTPUT) {
  throw new Error("GITHUB_OUTPUT is unavailable.");
}

appendFileSync(process.env.GITHUB_OUTPUT, `name=${channel}\n`);
