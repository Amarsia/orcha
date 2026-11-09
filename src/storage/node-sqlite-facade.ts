import { requireRuntimeModule } from "../runtime/node-module-loader.js";
import type { SessionEvent, SessionStore } from "../types.js";

/**
 * Backwards-compatible lazy facade for SQLite storage. The native-backed
 * implementation is resolved only when this class is instantiated.
 */
export class NodeSqliteSessionStore implements SessionStore {
  readonly #store: SessionStore;
  readonly databasePath: string;
  readonly agentName: string;

  constructor(
    directory = ".orcha/sessions",
    projectRoot = process.cwd(),
    agentName?: string,
  ) {
    const { NodeSqliteSessionStore: SqliteStore } = requireRuntimeModule<
      typeof import("./node-sqlite.js")
    >(["orchajs", "storage", "sqlite"]);
    const store = new SqliteStore(directory, projectRoot, agentName);
    this.#store = store;
    this.databasePath = store.databasePath;
    this.agentName = store.agentName;
  }

  read(sessionId: string): Promise<SessionEvent[]> {
    return this.#store.read(sessionId);
  }

  readAfterSequence(
    sessionId: string,
    afterSequence: number,
    limit: number,
  ): Promise<SessionEvent[]> {
    return this.#store.readAfterSequence?.(
      sessionId,
      afterSequence,
      limit,
    ) ?? Promise.resolve([]);
  }

  append(sessionId: string, events: SessionEvent[]): Promise<void> {
    return this.#store.append(sessionId, events);
  }

  listSessionIds(): Promise<string[]> {
    return this.#store.listSessionIds();
  }

  getCloudAcknowledgement(sessionId: string): Promise<number> {
    return this.#store.getCloudAcknowledgement?.(sessionId) ??
      Promise.resolve(0);
  }

  setCloudAcknowledgement(
    sessionId: string,
    sequence: number,
  ): Promise<void> {
    return this.#store.setCloudAcknowledgement?.(sessionId, sequence) ??
      Promise.resolve();
  }

  subscribe(
    sessionId: string,
    listener: (events: SessionEvent[]) => void,
  ): () => void {
    return this.#store.subscribe?.(sessionId, listener) ??
      (() => undefined);
  }

  subscribeAll(
    listener: (sessionId: string, events: SessionEvent[]) => void,
  ): () => void {
    return this.#store.subscribeAll?.(listener) ?? (() => undefined);
  }

  describeLocation(sessionId: string): Promise<string> {
    return this.#store.describeLocation?.(sessionId) ??
      Promise.resolve(this.databasePath);
  }
}
