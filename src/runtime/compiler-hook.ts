import type {
  CompiledBundle,
  OrchaInitConfiguration,
} from "../types.js";

export type RegistryCompiler = (
  configuration: OrchaInitConfiguration,
  projectRoot: string,
) => CompiledBundle;

interface CompilerHookGlobalState {
  registryCompiler: RegistryCompiler | undefined;
  registryCompilationActive: boolean;
}

const COMPILER_HOOK_STATE_KEY = Symbol.for("orchajs.compilerHookState");

function getCompilerHookState(): CompilerHookGlobalState {
  const globalRecord = globalThis as Record<
    symbol,
    CompilerHookGlobalState | undefined
  >;
  if (!globalRecord[COMPILER_HOOK_STATE_KEY]) {
    globalRecord[COMPILER_HOOK_STATE_KEY] = {
      registryCompiler: undefined,
      registryCompilationActive: false,
    };
  }
  return globalRecord[COMPILER_HOOK_STATE_KEY];
}

/** @internal Installed by Node development tooling, never by runtime bundles. */
export function setRegistryCompiler(compiler: RegistryCompiler): void {
  getCompilerHookState().registryCompiler = compiler;
}

export function getRegistryCompiler(): RegistryCompiler | undefined {
  return getCompilerHookState().registryCompiler;
}

/** @internal Prevents registry evaluation from starting runtime resources. */
export function setRegistryCompilationActive(active: boolean): void {
  getCompilerHookState().registryCompilationActive = active;
}

/** @internal True only while development tooling evaluates a registry. */
export function isRegistryCompilationActive(): boolean {
  return getCompilerHookState().registryCompilationActive;
}
