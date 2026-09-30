import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { SessionEvent, SessionStore } from "../types.js";

const DEFAULT_DATABASE_FILE = "orcha-sqlite.db";
const databases = new Map<string, SqliteDatabase>();

interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(source: string): void;
  pragma(source: string): unknown;
  prepare(source: string): SqliteStatement;
  transaction<Arguments extends unknown[], Result>(
    operation: (...arguments_: Arguments) => Result,
  ): (...arguments_: Arguments) => Result;
}

interface SqliteDatabaseConstructor {
  new(path: string): SqliteDatabase;
}

interface SessionEventRow {
  sequence: number;
  run: number | null;
  type: SessionEvent["type"];
  timestamp: string;
  data: string;
}

export class NodeSqliteSessionStore implements SessionStore {
  readonly databasePath: string;
  readonly agentName: string;
  readonly #database: SqliteDatabase;
  readonly #listeners = new Map<
    string,
    Set<(events: SessionEvent[]) => void>
  >();
  readonly #allListeners = new Set<
    (sessionId: string, events: SessionEvent[]) => void
  >();

  constructor(
    directory = ".orcha/sessions",
    projectRoot = process.cwd(),
    agentName?: string,
  ) {
    if (!agentName?.trim()) {
      throw new Error("Agent name is required for SQLite session storage.");
    }
    this.agentName = agentName;
    this.databasePath = resolve(projectRoot, directory, DEFAULT_DATABASE_FILE);
    this.#database = openDatabase(this.databasePath);
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    validateSessionId(sessionId);
    const rows = this.#database.prepare(`
      select sequence, run, type, timestamp, data
      from session_events
      where agent_name = ? and session_id = ?
      order by sequence asc
    `).all(this.agentName, sessionId) as SessionEventRow[];

    return rows.map((row) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.data) as Record<string, unknown>;
      } catch (error) {
        throw new Error(
          `Corrupt SQLite event in session "${sessionId}" at sequence ${row.sequence}.`,
          { cause: error },
        );
      }
      return {
        sequence: row.sequence,
        type: row.type,
        timestamp: row.timestamp,
        ...(row.run === null ? {} : { run: row.run }),
        data,
      };
    });
  }

  async append(sessionId: string, events: SessionEvent[]): Promise<void> {
    validateSessionId(sessionId);
    if (events.length === 0) {
      return;
    }

    const insert = this.#database.prepare(`
      insert into session_events (
        agent_name,
        session_id,
        sequence,
        run,
        type,
        timestamp,
        data
      ) values (?, ?, ?, ?, ?, ?, ?)
    `);
    const appendEvents = this.#database.transaction(
      (items: SessionEvent[]) => {
        for (const event of items) {
          insert.run(
            this.agentName,
            sessionId,
            event.sequence,
            event.run ?? null,
            event.type,
            event.timestamp,
            JSON.stringify(event.data),
          );
        }
      },
    );
    appendEvents(events);
    this.#notify(sessionId, events);
  }

  async listSessionIds(): Promise<string[]> {
    const rows = this.#database.prepare(`
      select distinct session_id
      from session_events
      where agent_name = ?
      order by session_id asc
    `).all(this.agentName) as Array<{ session_id: string }>;
    return rows.map((row) => row.session_id);
  }

  subscribe(
    sessionId: string,
    listener: (events: SessionEvent[]) => void,
  ): () => void {
    validateSessionId(sessionId);
    const listeners = this.#listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(sessionId);
      }
    };
  }

  subscribeAll(
    listener: (sessionId: string, events: SessionEvent[]) => void,
  ): () => void {
    this.#allListeners.add(listener);
    return () => {
      this.#allListeners.delete(listener);
    };
  }

  async describeLocation(_sessionId: string): Promise<string> {
    return this.databasePath;
  }

  #notify(sessionId: string, events: SessionEvent[]): void {
    for (const listener of this.#listeners.get(sessionId) ?? []) {
      safelyNotify(() => listener(events));
    }
    for (const listener of this.#allListeners) {
      safelyNotify(() => listener(sessionId, events));
    }
  }
}

function openDatabase(path: string): SqliteDatabase {
  const existing = databases.get(path);
  if (existing) {
    return existing;
  }

  mkdirSync(dirname(path), { recursive: true });
  const Database = loadDatabaseConstructor();
  const database = new Database(path);
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("busy_timeout = 5000");
  database.exec(`
    create table if not exists session_events (
      agent_name text not null,
      session_id text not null,
      sequence integer not null,
      run integer,
      type text not null,
      timestamp text not null,
      data text not null,
      primary key (agent_name, session_id, sequence)
    );

    pragma user_version = 1;
  `);
  databases.set(path, database);
  return database;
}

function loadDatabaseConstructor(): SqliteDatabaseConstructor {
  try {
    const loaded = createRequire(import.meta.url)("better-sqlite3") as
      | SqliteDatabaseConstructor
      | { default: SqliteDatabaseConstructor };
    return "default" in loaded ? loaded.default : loaded;
  } catch (error) {
    throw new Error(
      'Orcha\'s optional SQLite dependency is unavailable. Reinstall "orchajs" with optional dependencies enabled or use the "node-jsonl" strategy.',
      { cause: error },
    );
  }
}

function validateSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9_:-]+$/.test(sessionId)) {
    throw new Error("Invalid session ID.");
  }
}

function safelyNotify(notify: () => void): void {
  try {
    notify();
  } catch {
    // Observers cannot invalidate a durable write.
  }
}
