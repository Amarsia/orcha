import { createRequire } from "node:module";

const runtimeRequire = createRequire(import.meta.url);
const runtimeImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<Record<string, unknown>>;

/**
 * Loads a Node-only package subpath without exposing it to consumer bundlers.
 * Callers pass path segments so no optional module specifier is statically
 * discoverable from the default package graph.
 */
export function requireRuntimeModule<T>(
  specifierSegments: string[],
): T {
  return runtimeRequire(specifierSegments.join("/")) as T;
}

/**
 * Loads an ESM package subpath without exposing the optional module specifier
 * to consumer bundlers.
 */
export async function importRuntimeModule<T>(
  specifierSegments: string[],
): Promise<T> {
  return await runtimeImport(specifierSegments.join("/")) as T;
}
