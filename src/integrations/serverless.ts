import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Plugin } from "esbuild";
import { orchaPlugin } from "./esbuild.js";

type ServerlessEsbuildOptions = {
  config?: string;
  exclude?: string[];
  external?: string[];
  plugins?: Plugin[] | string;
  [key: string]: unknown;
};

type ServerlessLike = {
  config?: {
    servicePath?: string;
  };
  service: {
    custom?: {
      esbuild?: ServerlessEsbuildOptions;
      [key: string]: unknown;
    };
    plugins?: string[];
  };
};

type ServerlessPluginModule =
  | Plugin[]
  | ((serverless: ServerlessLike) => Plugin[])
  | {
      default: Plugin[] | ((serverless: ServerlessLike) => Plugin[]);
    };

type ServerlessConfigModule =
  | ((serverless: ServerlessLike) => ServerlessEsbuildOptions)
  | {
      default: (serverless: ServerlessLike) => ServerlessEsbuildOptions;
    };

export class OrchaServerlessPlugin {
  readonly hooks: Record<string, () => void>;

  constructor(private readonly serverless: ServerlessLike) {
    this.hooks = {
      initialize: () => this.configureEsbuild(),
    };
  }

  private configureEsbuild(): void {
    const servicePath = resolve(
      this.serverless.config?.servicePath ?? process.cwd(),
    );
    const configuredPlugins = this.serverless.service.plugins ?? [];
    if (!configuredPlugins.includes("serverless-esbuild")) {
      throw new Error(
        'The "orchajs/serverless" plugin requires "serverless-esbuild". Add "serverless-esbuild" before "orchajs/serverless" in the Serverless plugins list.',
      );
    }

    const custom = this.serverless.service.custom ?? {};
    const configuredEsbuild = custom.esbuild ?? {};
    const esbuild = configuredEsbuild.config
      ? loadEsbuildConfig(
          configuredEsbuild.config,
          servicePath,
          this.serverless,
        )
      : { ...configuredEsbuild };

    assertOrchaIsBundled(esbuild);
    const existingPlugins = loadEsbuildPlugins(
      esbuild.plugins,
      servicePath,
      this.serverless,
    );
    if (!existingPlugins.some((plugin) => plugin.name === "orchajs")) {
      existingPlugins.push(orchaPlugin({ projectRoot: servicePath }));
    }

    delete esbuild.config;
    esbuild.plugins = existingPlugins;
    custom.esbuild = esbuild;
    this.serverless.service.custom = custom;
  }
}

function loadEsbuildConfig(
  configPath: string,
  servicePath: string,
  serverless: ServerlessLike,
): ServerlessEsbuildOptions {
  const loaded = loadProjectModule<ServerlessConfigModule>(
    configPath,
    servicePath,
  );
  const config = unwrapDefault(loaded);
  if (typeof config !== "function") {
    throw new Error(
      `Serverless esbuild config "${configPath}" must export a function.`,
    );
  }
  return config(serverless);
}

function loadEsbuildPlugins(
  plugins: Plugin[] | string | undefined,
  servicePath: string,
  serverless: ServerlessLike,
): Plugin[] {
  if (!plugins) {
    return [];
  }
  if (Array.isArray(plugins)) {
    return [...plugins];
  }

  const loaded = unwrapDefault(
    loadProjectModule<ServerlessPluginModule>(plugins, servicePath),
  );
  const resolved = typeof loaded === "function"
    ? loaded(serverless)
    : loaded;
  if (!Array.isArray(resolved)) {
    throw new Error(
      `Serverless esbuild plugins file "${plugins}" must export an array or a function that returns one.`,
    );
  }
  return [...resolved];
}

function loadProjectModule<T>(path: string, servicePath: string): T {
  const requireFromProject = createRequire(
    resolve(servicePath, "package.json"),
  );
  return requireFromProject(resolve(servicePath, path)) as T;
}

function unwrapDefault<T>(
  value: T | { default: T },
): T {
  if (
    typeof value === "object" &&
    value !== null &&
    "default" in value
  ) {
    return value.default;
  }
  return value;
}

function assertOrchaIsBundled(options: ServerlessEsbuildOptions): void {
  for (const key of ["exclude", "external"] as const) {
    if (options[key]?.includes("orchajs")) {
      throw new Error(
        `Remove "orchajs" from custom.esbuild.${key}. Orcha must be replaced during bundling, not copied into the Lambda package.`,
      );
    }
  }
}

export default OrchaServerlessPlugin;
