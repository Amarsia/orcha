import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import OrchaServerlessPlugin from "../dist/integrations/serverless.js";

test("adds Orcha to the serverless-esbuild plugin pipeline", () => {
  const serverless = createServerless();
  const integration = new OrchaServerlessPlugin(serverless);

  integration.hooks.initialize();

  assert.deepEqual(
    serverless.service.custom.esbuild.plugins.map((plugin) => plugin.name),
    ["existing", "orchajs"],
  );
});

test("composes a serverless-esbuild config file", async () => {
  const servicePath = await mkdtemp(
    resolve(tmpdir(), "orcha-serverless-config-"),
  );
  try {
    await writeFile(
      resolve(servicePath, "esbuild.config.cjs"),
      'module.exports = () => ({ minify: true, plugins: [{ name: "configured", setup() {} }] });\n',
      "utf8",
    );
    const serverless = createServerless(servicePath);
    serverless.service.custom.esbuild = {
      config: "./esbuild.config.cjs",
    };

    new OrchaServerlessPlugin(serverless).hooks.initialize();

    assert.equal(serverless.service.custom.esbuild.config, undefined);
    assert.equal(serverless.service.custom.esbuild.minify, true);
    assert.deepEqual(
      serverless.service.custom.esbuild.plugins.map((plugin) => plugin.name),
      ["configured", "orchajs"],
    );
  } finally {
    await rm(servicePath, { recursive: true, force: true });
  }
});

test("rejects deployments that externalize the Orcha package", () => {
  const serverless = createServerless();
  serverless.service.custom.esbuild.external = ["orchajs"];

  assert.throws(
    () => new OrchaServerlessPlugin(serverless).hooks.initialize(),
    /must be replaced during bundling/,
  );
});

test("requires serverless-esbuild ahead of the Orcha plugin", () => {
  const serverless = createServerless();
  serverless.service.plugins = ["orchajs/serverless"];

  assert.throws(
    () => new OrchaServerlessPlugin(serverless).hooks.initialize(),
    /requires "serverless-esbuild"/,
  );
});

function createServerless(servicePath = process.cwd()) {
  return {
    config: {
      servicePath,
    },
    service: {
      plugins: ["serverless-esbuild", "orchajs/serverless"],
      custom: {
        esbuild: {
          plugins: [
            {
              name: "existing",
              setup() {},
            },
          ],
        },
      },
    },
  };
}
