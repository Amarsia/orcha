import type {
  ProjectConfiguration,
  SessionStore,
} from "../types.js";
import { NodeJsonlSessionStore } from "./node-jsonl.js";
import { NodeSqliteSessionStore } from "./node-sqlite.js";

export type SessionStorageStrategy = NonNullable<
  NonNullable<ProjectConfiguration["storage"]>["strategy"]
>;

export interface CreateSessionStoreOptions {
  strategy?: SessionStorageStrategy;
  directory?: string;
  projectRoot: string;
  agentName: string;
}

export function createSessionStore(
  options: CreateSessionStoreOptions,
): SessionStore {
  const strategy = options.strategy ?? "node-jsonl";
  const directory = options.directory ?? ".orcha/sessions";
  if (strategy === "node-jsonl") {
    return new NodeJsonlSessionStore(
      directory,
      options.projectRoot,
      options.agentName,
    );
  }
  if (strategy === "sqlite") {
    return new NodeSqliteSessionStore(
      directory,
      options.projectRoot,
      options.agentName,
    );
  }
  throw new Error(`Storage strategy "${String(strategy)}" is not implemented.`);
}
