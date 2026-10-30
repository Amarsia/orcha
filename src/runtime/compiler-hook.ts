import type {
  CompiledBundle,
  OrchaInitConfiguration,
} from "../types.js";

export type RegistryCompiler = (
  configuration: OrchaInitConfiguration,
  projectRoot: string,
) => CompiledBundle;

let registryCompiler: RegistryCompiler | undefined;
let registryCompilationActive = false;

/** @internal Installed by Node development tooling, never by runtime bundles. */
export function setRegistryCompiler(compiler: RegistryCompiler): void {
  registryCompiler = compiler;
}

export function getRegistryCompiler(): RegistryCompiler | undefined {
  return registryCompiler;
}

/** @internal Prevents registry evaluation from starting runtime resources. */
export function setRegistryCompilationActive(active: boolean): void {
  registryCompilationActive = active;
}

/** @internal True only while development tooling evaluates a registry. */
export function isRegistryCompilationActive(): boolean {
  return registryCompilationActive;
}
