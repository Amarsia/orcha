import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "esbuild";

const executeFile = promisify(execFile);
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const forbiddenGraphFragments = [
  "/compiler/compile.js",
  "/providers/bedrock.js",
  "/providers/google-genai.js",
  "/providers/vertex-ai.js",
  "/runtime/actions/sandbox.js",
  "/runtime/mcp/node-client.js",
  "/storage/node-sqlite.js",
  "/node_modules/esbuild/",
  "/node_modules/@esbuild/",
  "/node_modules/@aws-sdk/client-bedrock-runtime/",
  "/node_modules/@google/genai/",
  "/node_modules/quickjs-emscripten-core/",
  "/node_modules/@jitl/quickjs-singlefile-cjs-release-sync/",
  "/node_modules/@modelcontextprotocol/sdk/",
  "/node_modules/better-sqlite3/",
];

test("default ESM Node entry keeps optional features out of consumer bundles", async () => {
  await assertSafeDefaultGraph("dist/index.js", "esm");
});

test("default CommonJS Node entry keeps optional features out of consumer bundles", async () => {
  await assertSafeDefaultGraph("dist-cjs/index.js", "cjs");
});

test("emitted declaration files avoid inline type import/export specifiers for older TypeScript consumers", async () => {
  const declarationFiles = await collectDeclarationFiles(
    resolve(repositoryRoot, "dist"),
  );
  assert.ok(declarationFiles.length > 0, "Expected emitted .d.ts files in dist/");
  const inlineTypePattern = /(?:import|export)\s*\{[^}]*\btype\s+[A-Za-z0-9_$]/s;

  for (const filePath of declarationFiles) {
    const contents = await readFile(filePath, "utf8");
    assert.doesNotMatch(
      contents,
      inlineTypePattern,
      `Declaration file ${filePath} contains an inline type modifier in import/export`,
    );
  }
});

test("bundled default entry runs a zero-config agent without unused optional peers", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-bundled-runtime-"));
  try {
    const packageRoot = resolve(root, "node_modules/orchajs");
    await mkdir(packageRoot, { recursive: true });
    await cp(
      resolve(repositoryRoot, "package.json"),
      resolve(packageRoot, "package.json"),
    );
    await cp(resolve(repositoryRoot, "dist"), resolve(packageRoot, "dist"), {
      recursive: true,
    });
    await cp(
      resolve(repositoryRoot, "dist-cjs"),
      resolve(packageRoot, "dist-cjs"),
      { recursive: true },
    );
    await mkdir(resolve(root, "orcha/assistant"), { recursive: true });
    await writeFile(
      resolve(root, "orcha/assistant/index.json"),
      JSON.stringify({
        name: "Assistant",
        provider: "openai",
        model: "gpt-test",
        outputType: "text",
      }),
      "utf8",
    );
    await writeFile(
      resolve(root, "orcha/assistant/instructions.md"),
      "Answer briefly.",
      "utf8",
    );
    await writeFile(
      resolve(root, "entry.mjs"),
      [
        'import { orcha } from "orchajs";',
        "globalThis.fetch = async () => Response.json({",
        '  id: "resp_bundled",',
        '  status: "completed",',
        "  output: [{",
        '    type: "message",',
        '    role: "assistant",',
        '    status: "completed",',
        '    content: [{ type: "output_text", text: "Bundled runtime works.", annotations: [] }],',
        "  }],",
        "  usage: { input_tokens: 2, output_tokens: 3 },",
        "});",
        "orcha.init({",
        `  root: ${JSON.stringify(root)},`,
        '  providers: { openai: "test-key" },',
        '  agents: { assistant: "./assistant" },',
        "});",
        'const result = await orcha.assistant.run("Test the bundled runtime.").result;',
        "console.log(JSON.stringify(result));",
        "await orcha.close();",
        "",
      ].join("\n"),
      "utf8",
    );

    await build({
      absWorkingDir: root,
      entryPoints: ["entry.mjs"],
      outfile: "bundle.mjs",
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node18",
      logLevel: "silent",
    });
    const { stdout } = await executeFile(
      process.execPath,
      [resolve(root, "bundle.mjs")],
      { cwd: root },
    );
    const result = JSON.parse(stdout.trim());
    assert.equal(result.status, "completed");
    assert.equal(result.output, "Bundled runtime works.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function assertSafeDefaultGraph(entryPath, format) {
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-bundler-graph-"));
  try {
    const entry = resolve(root, "entry.mjs");
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(
      entry,
      [
        `import { orcha } from ${JSON.stringify(resolve(repositoryRoot, entryPath))};`,
        "export { orcha };",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format,
      platform: "node",
      target: "node18",
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile.inputs)
      .map((path) => path.replaceAll("\\", "/"))
      .join("\n");

    for (const fragment of forbiddenGraphFragments) {
      assert.doesNotMatch(
        inputs,
        new RegExp(escapeRegExp(fragment)),
        `Unexpected optional feature in default bundle graph: ${fragment}`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
