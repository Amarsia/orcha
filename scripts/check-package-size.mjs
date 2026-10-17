import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const kilobyte = 1024;
const megabyte = 1024 * kilobyte;
const limits = {
  packageTarball: 600 * kilobyte,
  packageUnpacked: 2.5 * megabyte,
  cleanInstall: 4 * megabyte,
  browserRuntime: {
    raw: 300 * kilobyte,
    gzip: 75 * kilobyte,
  },
  reactNativeRuntime: {
    raw: 300 * kilobyte,
    gzip: 75 * kilobyte,
  },
};

const providerBundles = [
  {
    name: "anthropic",
    source: "src/providers/anthropic.ts",
    exportName: "anthropicProvider",
    raw: 120 * kilobyte,
    gzip: 30 * kilobyte,
    browser: true,
  },
  {
    name: "openai",
    source: "src/providers/openai.ts",
    exportName: "openAIProvider",
    raw: 120 * kilobyte,
    gzip: 30 * kilobyte,
    browser: true,
  },
  {
    name: "deepseek",
    source: "src/providers/deepseek.ts",
    exportName: "deepSeekProvider",
    raw: 120 * kilobyte,
    gzip: 30 * kilobyte,
    browser: true,
  },
  {
    name: "google-genai",
    source: "src/providers/google-genai.ts",
    exportName: "googleGenAIProvider",
    raw: 600 * kilobyte,
    gzip: 120 * kilobyte,
    browser: true,
  },
  {
    name: "bedrock",
    source: "src/providers/bedrock.ts",
    exportName: "bedrockProvider",
    raw: 900 * kilobyte,
    gzip: 225 * kilobyte,
  },
  {
    name: "vertex",
    source: "src/providers/vertex-ai.ts",
    exportName: "vertexAIProvider",
    raw: 1 * megabyte,
    gzip: 225 * kilobyte,
  },
];

const temporaryDirectory = await mkdtemp(join(tmpdir(), "orcha-size-"));

try {
  await checkPublishedPackage();
  await checkCleanInstall();
  await checkUniversalRuntimeBundles();
  await checkProviderBundles();
  await checkSandboxBundle();
  console.log("All package and bundle size checks passed.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function checkPublishedPackage() {
  const manifest = await inspectPublishedPackage([]);
  assertNoSourceMaps("orchajs", manifest);

  assertWithin("package tarball", manifest.size, limits.packageTarball);
  assertWithin(
    "package unpacked",
    manifest.unpackedSize,
    limits.packageUnpacked,
  );

  const playgroundManifest = await inspectPublishedPackage([
    "--workspace=@orchajs/playground-ui",
  ]);
  assertNoSourceMaps("@orchajs/playground-ui", playgroundManifest);
}

async function inspectPublishedPackage(arguments_) {
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts", ...arguments_],
    { cwd: root, maxBuffer: 10 * megabyte },
  );
  const [manifest] = JSON.parse(stdout);
  if (!manifest) {
    throw new Error("npm pack did not return package metadata.");
  }
  return manifest;
}

function assertNoSourceMaps(packageName, manifest) {
  const sourceMaps = manifest.files
    .map((file) => file.path)
    .filter((path) => path.endsWith(".map"));
  if (sourceMaps.length > 0) {
    throw new Error(
      `${packageName} contains published source maps:\n${sourceMaps.join("\n")}`,
    );
  }
}

async function checkCleanInstall() {
  const packageDirectory = join(temporaryDirectory, "package");
  const installDirectory = join(temporaryDirectory, "install");
  await mkdir(packageDirectory, { recursive: true });
  await execFileAsync(
    "npm",
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packageDirectory,
    ],
    { cwd: root, maxBuffer: 10 * megabyte },
  );

  const [tarballName] = await readdir(packageDirectory);
  if (!tarballName) {
    throw new Error("npm pack did not create a tarball.");
  }
  await mkdir(installDirectory, { recursive: true });
  await writeFile(
    join(installDirectory, "package.json"),
    '{"private":true}\n',
    "utf8",
  );
  await execFileAsync(
    "npm",
    [
      "install",
      join(packageDirectory, tarballName),
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: installDirectory, maxBuffer: 10 * megabyte },
  );

  const nodeModules = join(installDirectory, "node_modules");
  const installedSize = await directorySize(nodeModules);
  assertWithin("clean production install", installedSize, limits.cleanInstall);

  const unexpectedPackages = [
    "@orchajs/playground-ui",
    "@aws-sdk/client-bedrock-runtime",
    "@google/genai",
    "@jitl/quickjs-singlefile-cjs-release-sync",
    "better-sqlite3",
    "chokidar",
    "dotenv",
    "esbuild",
    "quickjs-emscripten-core",
  ];
  for (const packageName of unexpectedPackages) {
    try {
      await stat(join(nodeModules, packageName));
      throw new Error(
        `Clean production install unexpectedly contains optional package "${packageName}".`,
      );
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

async function checkUniversalRuntimeBundles() {
  await checkUniversalRuntimeBundle(
    "browser runtime",
    "src/runtime/platform-browser.ts",
    "browserRuntimePlatform",
    limits.browserRuntime,
    [],
    [
      "src/runtime/platform-react-native.ts",
      "src/storage/react-native-jsonl.ts",
      "node_modules/@react-native-async-storage/",
    ],
  );
  await checkUniversalRuntimeBundle(
    "React Native runtime",
    "src/runtime/platform-react-native.ts",
    "reactNativeRuntimePlatform",
    limits.reactNativeRuntime,
    ["@react-native-async-storage/async-storage"],
    [
      "src/runtime/platform-browser.ts",
      "src/storage/browser-indexeddb.ts",
    ],
  );
}

async function checkUniversalRuntimeBundle(
  name,
  platformPath,
  platformExport,
  budget,
  external = [],
  targetExclusions = [],
) {
  const result = await build({
    stdin: {
      contents: [
        'import { createOrcha } from "./src/runtime/create-orcha.ts";',
        'import { createProviderResponseGenerator } from "./src/providers/dispatcher.ts";',
        `import { ${platformExport} as platform } from "./${platformPath}";`,
        "const providers = createProviderResponseGenerator({});",
        "export const orcha = createOrcha(() => ({ schemaVersion: 1, agents: {} }), providers, platform);",
      ].join("\n"),
      resolveDir: root,
      sourcefile: `${name.replaceAll(" ", "-")}.ts`,
      loader: "ts",
    },
    bundle: true,
    minify: true,
    platform: "browser",
    target: ["chrome110", "firefox110", "safari16"],
    format: "esm",
    external,
    metafile: true,
    write: false,
    legalComments: "none",
  });
  assertExcludedInputs(name, result.metafile, [
    "src/compiler/",
    "src/integrations/",
    "src/playground/",
    "src/runtime/actions/native.ts",
    "src/runtime/platform-node.ts",
    "src/storage/node-jsonl.ts",
    "src/storage/node-sqlite.ts",
    "node_modules/@orchajs/playground-ui/",
    "node_modules/chokidar/",
    "node_modules/dotenv/",
    "node_modules/esbuild/",
    ...providerBundles.map((provider) => provider.source),
    ...targetExclusions,
  ]);
  checkBundle(name, result.outputFiles, budget);
}

async function checkProviderBundles() {
  for (const provider of providerBundles) {
    const entry = `export { ${provider.exportName} } from "./${provider.source}";`;
    const result = await build({
      stdin: {
        contents: entry,
        resolveDir: root,
        sourcefile: `${provider.name}-size-entry.ts`,
        loader: "ts",
      },
      bundle: true,
      minify: true,
      platform: "node",
      target: "node18",
      format: "esm",
      metafile: true,
      write: false,
      legalComments: "none",
    });
    assertExcludedInputs(
      `Lambda ${provider.name}`,
      result.metafile,
      providerBundles
        .filter((candidate) => candidate.source !== provider.source)
        .map((candidate) => candidate.source),
    );
    checkBundle(`Lambda ${provider.name}`, result.outputFiles, provider);

    if (provider.browser) {
      const browserResult = await build({
        stdin: {
          contents: entry,
          resolveDir: root,
          sourcefile: `${provider.name}-browser-size-entry.ts`,
          loader: "ts",
        },
        bundle: true,
        minify: true,
        platform: "browser",
        target: ["chrome110", "firefox110", "safari16"],
        format: "esm",
        external: ["node:*"],
        metafile: true,
        write: false,
        legalComments: "none",
      });
      assertExcludedInputs(
        `browser ${provider.name}`,
        browserResult.metafile,
        providerBundles
          .filter((candidate) => candidate.source !== provider.source)
          .map((candidate) => candidate.source),
      );
      checkBundle(
        `browser ${provider.name}`,
        browserResult.outputFiles,
        provider,
      );
    }
  }
}

function assertExcludedInputs(name, metafile, exclusions) {
  const inputs = Object.keys(metafile?.inputs ?? {});
  const unexpected = inputs.filter((input) =>
    exclusions.some((excluded) => input.includes(excluded)),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `${name} includes unused or platform-incompatible modules:\n${unexpected.join("\n")}`,
    );
  }
}

async function checkSandboxBundle() {
  const result = await build({
    entryPoints: [resolve(root, "src/runtime/actions/sandbox.ts")],
    bundle: true,
    minify: true,
    platform: "node",
    target: "node18",
    format: "esm",
    write: false,
    legalComments: "none",
  });
  checkBundle("Lambda sandbox", result.outputFiles, {
    raw: 1.3 * megabyte,
    gzip: 350 * kilobyte,
  });
}

function checkBundle(name, outputFiles, budget) {
  const bytes = Buffer.concat(
    outputFiles.map((file) => Buffer.from(file.contents)),
  );
  assertWithin(`${name} bundle`, bytes.byteLength, budget.raw);
  assertWithin(`${name} bundle gzip`, gzipSync(bytes).byteLength, budget.gzip);
}

async function directorySize(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return directorySize(path);
      }
      if (entry.isFile()) {
        return (await stat(path)).size;
      }
      return 0;
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
}

function assertWithin(name, actual, maximum) {
  console.log(`${name}: ${formatBytes(actual)} / ${formatBytes(maximum)}`);
  if (actual > maximum) {
    throw new Error(
      `${name} exceeds its size budget: ${formatBytes(actual)} > ${formatBytes(maximum)}.`,
    );
  }
}

function formatBytes(bytes) {
  if (bytes >= megabyte) {
    return `${(bytes / megabyte).toFixed(2)} MiB`;
  }
  return `${(bytes / kilobyte).toFixed(1)} KiB`;
}
