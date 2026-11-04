import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

async function createZeroConfigFixture(root) {
  const files = {
    "package.json": JSON.stringify({
      private: true,
      type: "module",
      scripts: {
        dev: "next dev",
        build: "next build",
      },
      dependencies: {
        next: "15.0.0",
        react: "19.0.0",
        "react-dom": "19.0.0",
      },
    }),
    "orcha/assistant/index.json": JSON.stringify({
      name: "Assistant",
      description: "Test zero-config and dual-package compilation.",
      provider: "openai",
      model: "gpt-test",
      maxTokens: 32,
      outputType: "text",
    }),
    "orcha/assistant/instructions.md": "You are a helpful assistant.\n",
    "orcha/index.ts": [
      'import { orcha } from "orchajs";',
      "orcha.init({",
      '  providers: { openai: "test-key" },',
      '  agents: { assistant: "./assistant" },',
      "});",
      "",
    ].join("\n"),
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = resolve(root, relativePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
}

async function copyPackageToConsumerNodeModules(root) {
  const consumerPackageRoot = resolve(root, "node_modules/orchajs");
  await mkdir(consumerPackageRoot, { recursive: true });
  await cp(resolve(repositoryRoot, "package.json"), resolve(consumerPackageRoot, "package.json"));
  await cp(resolve(repositoryRoot, "dist"), resolve(consumerPackageRoot, "dist"), {
    recursive: true,
  });
  await cp(resolve(repositoryRoot, "dist-cjs"), resolve(consumerPackageRoot, "dist-cjs"), {
    recursive: true,
  });
  return consumerPackageRoot;
}

test("CommonJS buildProject, withOrcha, withOrchaMetro, and OrchaWebpackPlugin share state with ESM orcha/index.ts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-cjs-esm-hazard-"));
  try {
    await createZeroConfigFixture(root);
    await mkdir(resolve(root, "node_modules"), { recursive: true });
    await symlink(repositoryRoot, resolve(root, "node_modules/orchajs"), "dir");

    const cjsBuildProject = require(
      resolve(repositoryRoot, "dist-cjs/compiler/build-project.js"),
    );
    const outputPath = await cjsBuildProject.buildProject({
      projectRoot: root,
      target: "browser",
    });
    assert.equal(existsSync(outputPath), true);
    assert.equal(existsSync(resolve(root, ".orcha/dist/manifest.json")), true);

    const { withOrcha } = require("orchajs/next");
    const nextConfig = await withOrcha(
      { reactStrictMode: true },
      { projectRoot: root, watch: false },
    );
    assert.equal(typeof nextConfig.webpack, "function");
    const webpackConfig = nextConfig.webpack(
      { resolve: {}, plugins: [] },
      { isServer: false },
    );
    const nextPlugin = webpackConfig.plugins.find(
      (plugin) => plugin?.constructor?.name === "OrchaWebpackPlugin",
    );
    assert.ok(nextPlugin, "Expected OrchaWebpackPlugin to be registered by withOrcha");

    const { withOrchaMetro } = require("orchajs/metro");
    const metroConfig = await withOrchaMetro(
      { resolver: {} },
      { projectRoot: root, watch: false },
    );
    assert.equal(typeof metroConfig.resolver?.resolveRequest, "function");
    assert.equal(
      existsSync(resolve(root, ".orcha/dist/bundle.react-native.js")),
      true,
    );

    const { OrchaWebpackPlugin } = require("orchajs/webpack");
    const webpackPlugin = new OrchaWebpackPlugin({
      projectRoot: root,
      target: "browser",
    });
    let webpackHook;
    webpackPlugin.apply({
      hooks: {
        beforeCompile: {
          tapPromise(_name, callback) {
            webpackHook = callback;
          },
        },
        afterCompile: {
          tap() {},
        },
      },
    });
    await webpackHook();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zero-config Node orcha.init() compiles orcha/ on the fly without pre-running orchajs build", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-zero-config-node-"));
  try {
    await createZeroConfigFixture(root);
    await mkdir(resolve(root, "node_modules"), { recursive: true });
    await symlink(repositoryRoot, resolve(root, "node_modules/orchajs"), "dir");

    const scriptPath = resolve(root, "run-zero-config.mjs");
    await writeFile(
      scriptPath,
      [
        `import { orcha } from ${JSON.stringify(pathToFileURL(resolve(repositoryRoot, "dist/index.js")).href)};`,
        `orcha.init({`,
        `  root: ${JSON.stringify(root)},`,
        `  providers: { openai: "test-key" },`,
        `  agents: { assistant: "./assistant" },`,
        `});`,
        `process.stdout.write(JSON.stringify({`,
        `  initialized: orcha.isInitialized(),`,
        `  hasAgent: typeof orcha.assistant?.run === "function",`,
        `}));`,
        "",
      ].join("\n"),
      "utf8",
    );

    assert.equal(existsSync(resolve(root, ".orcha/dist/manifest.json")), false);

    const { stdout } = await executeFile(process.execPath, [scriptPath], {
      cwd: root,
    });
    assert.deepEqual(JSON.parse(stdout), {
      initialized: true,
      hasAgent: true,
    });
    assert.equal(existsSync(resolve(root, ".orcha/dist/manifest.json")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zero-config browser and react-native entry points initialize without bundler plugins after build", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "orchajs-zero-config-browser-"));
  try {
    await createZeroConfigFixture(root);
    const consumerPackageRoot = await copyPackageToConsumerNodeModules(root);

    const { buildProject } = await import("../dist/compiler/build-project.js");
    await buildProject({ projectRoot: root, target: "browser" });

    const syncedEsmManifest = await readFile(
      resolve(consumerPackageRoot, "dist/runtime/compiled-manifest.js"),
      "utf8",
    );
    assert.match(syncedEsmManifest, /"assistant"/);

    // Ensure repository's own dist/runtime/compiled-manifest.js was not mutated
    const repoManifest = await readFile(
      resolve(repositoryRoot, "dist/runtime/compiled-manifest.js"),
      "utf8",
    );
    assert.match(repoManifest, /compiledManifest = undefined/);

    const verifyBrowserScript = resolve(root, "verify-browser.mjs");
    await writeFile(
      verifyBrowserScript,
      [
        `import { orcha as browserOrcha } from ${JSON.stringify(pathToFileURL(resolve(consumerPackageRoot, "dist/browser.js")).href)};`,
        `import { orcha as rnOrcha } from ${JSON.stringify(pathToFileURL(resolve(consumerPackageRoot, "dist/react-native.js")).href)};`,
        `browserOrcha.init({`,
        `  providers: { openai: "test-key" },`,
        `  agents: { assistant: "./assistant" },`,
        `});`,
        `rnOrcha.init({`,
        `  providers: { openai: "test-key" },`,
        `  agents: { assistant: "./assistant" },`,
        `});`,
        `process.stdout.write(JSON.stringify({`,
        `  browserInitialized: browserOrcha.isInitialized(),`,
        `  browserHasAgent: typeof browserOrcha.assistant?.run === "function",`,
        `  rnInitialized: rnOrcha.isInitialized(),`,
        `  rnHasAgent: typeof rnOrcha.assistant?.run === "function",`,
        `}));`,
        "",
      ].join("\n"),
      "utf8",
    );

    const { stdout } = await executeFile(
      process.execPath,
      [verifyBrowserScript],
      { cwd: root },
    );
    assert.deepEqual(JSON.parse(stdout), {
      browserInitialized: true,
      browserHasAgent: true,
      rnInitialized: true,
      rnHasAgent: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
