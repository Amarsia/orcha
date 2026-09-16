import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const packageDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryDirectory = resolve(packageDirectory, "../..");
const executable = join(packageDirectory, "bin", "create-orcha.js");
const packageMetadata = JSON.parse(
  await readFile(join(packageDirectory, "package.json"), "utf8"),
);

function invoke(arguments_, cwd) {
  return spawnSync(process.execPath, [executable, ...arguments_], {
    cwd,
    encoding: "utf8",
  });
}

test("creates a complete standalone project without installing dependencies", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "create-orcha-"));
  const targetDirectory = join(temporaryDirectory, "My Agent App");

  try {
    const result = invoke(["My Agent App", "--no-git"], temporaryDirectory);
    assert.equal(result.status, 0, result.stderr);

    const packageJson = JSON.parse(
      await readFile(join(targetDirectory, "package.json"), "utf8"),
    );
    assert.equal(packageJson.name, "my-agent-app");
    assert.equal(packageJson.dependencies.orchajs, packageMetadata.orchaVersion);
    await assert.rejects(access(join(targetDirectory, "node_modules")));

    await Promise.all([
      readFile(join(targetDirectory, "src", "server.ts"), "utf8"),
      readFile(join(targetDirectory, "public", "index.html"), "utf8"),
      readFile(join(targetDirectory, "orcha", "index.ts"), "utf8"),
      readFile(join(targetDirectory, "orcha", "AGENTS.md"), "utf8"),
      readFile(join(targetDirectory, "orcha", "assistant", "index.json"), "utf8"),
      readFile(join(targetDirectory, "orcha", "orderSupport", "index.json"), "utf8"),
      readFile(join(targetDirectory, "orcha", "approvalAgent", "index.json"), "utf8"),
    ]);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("refuses to overwrite a non-empty directory", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "create-orcha-"));
  const targetDirectory = join(temporaryDirectory, "existing");

  try {
    await mkdir(targetDirectory);
    await writeFile(join(targetDirectory, "keep.txt"), "keep");

    const result = invoke(["existing", "--no-git"], temporaryDirectory);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Target directory is not empty/);
    assert.equal(await readFile(join(targetDirectory, "keep.txt"), "utf8"), "keep");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("prints help without creating files", () => {
  const result = invoke(["--help"], packageDirectory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm create orcha@latest/);
  assert.doesNotMatch(result.stdout, /installing dependencies/i);
});

test("ships the complete canonical Orcha project guide", async () => {
  const source = await readFile(
    join(repositoryDirectory, "src", "cli-agents-template.ts"),
    "utf8",
  );
  const match = source.match(/^export const AGENTS_MD = `([\s\S]*)`;\s*$/);
  assert.ok(match, "Expected to find AGENTS_MD in cli-agents-template.ts");

  const canonicalGuide = match[1].replaceAll("\\`", "`");
  const shippedGuide = await readFile(
    join(packageDirectory, "template", "orcha", "AGENTS.md"),
    "utf8",
  );
  assert.equal(shippedGuide, canonicalGuide);
});
