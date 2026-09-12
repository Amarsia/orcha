import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as bundleEntry } from "esbuild";
import { orcha } from "../orcha.js";
import {
  builtInProviderCatalog,
  isBuiltInProvider,
} from "../providers/catalog.js";

export interface BuildProjectOptions {
  projectRoot?: string;
}

export async function buildProject(
  options: BuildProjectOptions = {},
): Promise<string> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const registryPath = resolve(projectRoot, "orcha/index.ts");
  if (!existsSync(registryPath)) {
    throw new Error('Missing "orcha/index.ts". Run "orcha init" first.');
  }

  const temporaryDirectory = resolve(projectRoot, ".orcha/.build");
  const registryBundlePath = resolve(temporaryDirectory, "registry.mjs");
  const productionEntryPath = resolve(
    temporaryDirectory,
    "production-entry.mjs",
  );
  const outputPath = resolve(projectRoot, ".orcha/dist/bundle.js");
  await mkdir(temporaryDirectory, { recursive: true });
  await mkdir(dirname(outputPath), { recursive: true });

  try {
    await bundleEntry({
      entryPoints: [registryPath],
      outfile: registryBundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      packages: "external",
      logLevel: "silent",
    });

    const previousCompiling = process.env.ORCHA_COMPILING;
    const previousProjectRoot = process.env.ORCHA_PROJECT_ROOT;
    process.env.ORCHA_COMPILING = "1";
    process.env.ORCHA_PROJECT_ROOT = projectRoot;
    try {
      await import(
        `${pathToFileURL(registryBundlePath).href}?time=${Date.now()}`
      );
    } finally {
      if (previousCompiling === undefined) {
        delete process.env.ORCHA_COMPILING;
      } else {
        process.env.ORCHA_COMPILING = previousCompiling;
      }
      if (previousProjectRoot === undefined) {
        delete process.env.ORCHA_PROJECT_ROOT;
      } else {
        process.env.ORCHA_PROJECT_ROOT = previousProjectRoot;
      }
    }
    const compiledBundle = orcha.getCompiledBundle();
    const runtimeFactoryPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../runtime/create-orcha.js",
    ).replaceAll("\\", "/");
    const providerDispatcherPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../providers/dispatcher.js",
    ).replaceAll("\\", "/");
    const includedProviders = [
      ...new Set(
        Object.values(compiledBundle.agents).map(
          (agent) => agent.provider,
        ),
      ),
    ];
    const providerRuntimeSource =
      createProviderRuntimeSource(includedProviders);

    await writeFile(
      productionEntryPath,
      [
        `import { createOrcha } from ${JSON.stringify(runtimeFactoryPath)};`,
        `import { createProviderResponseGenerator } from ${JSON.stringify(providerDispatcherPath)};`,
        providerRuntimeSource,
        `const compiledBundle = ${JSON.stringify(compiledBundle)};`,
        "const generateProviderResponse = createProviderResponseGenerator(includedProviders);",
        "export const orcha = createOrcha(() => compiledBundle, generateProviderResponse);",
        "export default orcha;",
        "",
      ].join("\n"),
      "utf8",
    );
    await bundleEntry({
      entryPoints: [productionEntryPath],
      outfile: outputPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      minify: true,
      legalComments: "none",
      define: {
        "process.env.ORCHA_INCLUDE_SANDBOX": JSON.stringify(
          compiledBundle.actionRuntime === "sandbox" ? "1" : "0",
        ),
      },
      ...(compiledBundle.actionRuntime === "sandbox"
        ? {
            banner: {
              js: [
                'import { createRequire as __orchaCreateRequire } from "node:module";',
                "const require = __orchaCreateRequire(import.meta.url);",
              ].join("\n"),
            },
          }
        : {}),
      logLevel: "silent",
    });

    return outputPath;
  } finally {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });
  }
}

function createProviderRuntimeSource(providerNames: string[]): string {
  const providersDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../providers",
  );
  const imports: string[] = [];
  const entries: string[] = [];

  for (const [index, name] of providerNames.entries()) {
    if (!isBuiltInProvider(name)) {
      throw new Error(`Provider "${name}" is not built in.`);
    }
    const descriptor = builtInProviderCatalog[name];
    const localName = `provider${index}`;
    imports.push(
      `import { ${descriptor.exportName} as ${localName} } from ${JSON.stringify(
        resolve(providersDirectory, descriptor.moduleFile),
      )};`,
    );
    entries.push(`${JSON.stringify(name)}: ${localName}`);
  }

  const contents = [
    ...imports,
    `const includedProviders = { ${entries.join(", ")} };`,
    "",
  ].join("\n");

  return contents;
}
