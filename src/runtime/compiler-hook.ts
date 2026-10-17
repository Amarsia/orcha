import type {
  CompiledBundle,
  OrchaInitConfiguration,
} from "../types.js";

export type RegistryCompiler = (
  configuration: OrchaInitConfiguration,
  projectRoot: string,
) => CompiledBundle;

let registryCompiler: RegistryCompiler | undefined;

/** @internal Installed by Node development tooling, never by runtime bundles. */
export function setRegistryCompiler(compiler: RegistryCompiler): void {
  registryCompiler = compiler;
}

export function getRegistryCompiler(): RegistryCompiler | undefined {
  return registryCompiler;
}
