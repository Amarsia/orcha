import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { access, appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SessionEvent, SessionStore } from "../types.js";

export class NodeJsonlSessionStore implements SessionStore {
  readonly directory: string;
  readonly #legacyDirectory: string;
  readonly #queues = new Map<string, Promise<void>>();
  readonly #listeners = new Map<
    string,
    Set<(events: SessionEvent[]) => void>
  >();
  readonly #allListeners = new Set<
    (sessionId: string, events: SessionEvent[]) => void
  >();
  readonly #watchers: FSWatcher[] = [];
  readonly #watchTimers = new Map<string, NodeJS.Timeout>();
  readonly #observedSequences = new Map<string, number>();

  constructor(
    directory = ".orcha/sessions",
    projectRoot = process.cwd(),
    agent?: string,
  ) {
    this.#legacyDirectory = resolve(projectRoot, directory);
    this.directory = resolve(
      this.#legacyDirectory,
      agent ? sessionAgentDirectoryName(agent) : "",
    );
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    const path = await this.#readSessionPath(sessionId);
    if (!path) {
      return [];
    }

    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const lines = source.split("\n").filter(Boolean);
    return lines.map((line, index) => {
      try {
        return JSON.parse(line) as SessionEvent;
      } catch (error) {
        throw new Error(
          `Corrupt JSONL event in session "${sessionId}" at line ${index + 1}.`,
          { cause: error },
        );
      }
    });
  }

  async append(sessionId: string, events: SessionEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const write = previous.then(async () => {
      const path = await this.#writeSessionPath(sessionId);
      await mkdir(dirname(path), { recursive: true });
      const lines = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
      await appendFile(path, lines, "utf8");
      this.#notify(sessionId, events);
    });

    this.#queues.set(sessionId, write);

    try {
      await write;
    } finally {
      if (this.#queues.get(sessionId) === write) {
        this.#queues.delete(sessionId);
      }
    }
  }

  async listSessionIds(): Promise<string[]> {
    const directories = new Set([this.directory, this.#legacyDirectory]);
    const sessionIds = new Set<string>();
    for (const directory of directories) {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (isMissingFileError(error)) {
          continue;
        }
        throw error;
      }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          sessionIds.add(entry.name.slice(0, -".jsonl".length));
        }
      }
    }
    return [...sessionIds].sort();
  }

  subscribe(
    sessionId: string,
    listener: (events: SessionEvent[]) => void,
  ): () => void {
    this.#sessionPath(this.directory, sessionId);
    this.#ensureWatchers();
    const listeners = this.#listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#listeners.delete(sessionId);
      }
      this.#releaseWatchersIfUnused();
    };
  }

  subscribeAll(
    listener: (sessionId: string, events: SessionEvent[]) => void,
  ): () => void {
    this.#ensureWatchers();
    this.#allListeners.add(listener);
    return () => {
      this.#allListeners.delete(listener);
      this.#releaseWatchersIfUnused();
    };
  }

  #notify(sessionId: string, events: SessionEvent[]): void {
    if (events.length === 0) {
      return;
    }
    this.#observedSequences.set(
      sessionId,
      Math.max(...events.map((event) => event.sequence)),
    );
    for (const listener of this.#listeners.get(sessionId) ?? []) {
      safelyNotify(() => listener(events));
    }
    for (const listener of this.#allListeners) {
      safelyNotify(() => listener(sessionId, events));
    }
  }

  #ensureWatchers(): void {
    if (this.#watchers.length > 0) {
      return;
    }
    const directories = new Set([this.directory, this.#legacyDirectory]);
    for (const directory of directories) {
      mkdirSync(directory, { recursive: true });
      this.#watchers.push(
        watch(directory, (_eventType, filename) => {
          if (!filename) {
            void this.#refreshAllSessions();
            return;
          }
          const name = filename.toString();
          if (!name.endsWith(".jsonl")) {
            return;
          }
          const sessionId = name.slice(0, -".jsonl".length);
          if (!/^[A-Za-z0-9_:\-]+$/.test(sessionId)) {
            return;
          }
          const previous = this.#watchTimers.get(sessionId);
          clearTimeout(previous);
          this.#watchTimers.set(
            sessionId,
            setTimeout(() => {
              this.#watchTimers.delete(sessionId);
              void this.#refreshSession(sessionId);
            }, 25),
          );
        }),
      );
    }
  }

  async #refreshAllSessions(): Promise<void> {
    for (const sessionId of await this.listSessionIds()) {
      await this.#refreshSession(sessionId);
    }
  }

  async #refreshSession(sessionId: string, retries = 2): Promise<void> {
    try {
      const events = await this.read(sessionId);
      const observed = this.#observedSequences.get(sessionId) ?? 0;
      const appended = events.filter((event) => event.sequence > observed);
      if (appended.length > 0) {
        this.#notify(sessionId, appended);
      }
    } catch {
      if (retries === 0) {
        return;
      }
      const previous = this.#watchTimers.get(sessionId);
      clearTimeout(previous);
      this.#watchTimers.set(
        sessionId,
        setTimeout(() => {
          this.#watchTimers.delete(sessionId);
          void this.#refreshSession(sessionId, retries - 1);
        }, 75),
      );
    }
  }

  #releaseWatchersIfUnused(): void {
    if (this.#listeners.size > 0 || this.#allListeners.size > 0) {
      return;
    }
    for (const watcher of this.#watchers.splice(0)) {
      watcher.close();
    }
    for (const timer of this.#watchTimers.values()) {
      clearTimeout(timer);
    }
    this.#watchTimers.clear();
    this.#observedSequences.clear();
  }

  async #readSessionPath(sessionId: string): Promise<string | undefined> {
    const current = this.#sessionPath(this.directory, sessionId);
    if (await pathExists(current)) {
      return current;
    }
    const legacy = this.#sessionPath(this.#legacyDirectory, sessionId);
    return await pathExists(legacy) ? legacy : undefined;
  }

  async #writeSessionPath(sessionId: string): Promise<string> {
    return (
      (await this.#readSessionPath(sessionId)) ??
      this.#sessionPath(this.directory, sessionId)
    );
  }

  #sessionPath(directory: string, sessionId: string): string {
    if (!/^[A-Za-z0-9_:-]+$/.test(sessionId)) {
      throw new Error("Invalid session ID.");
    }
    return resolve(directory, `${sessionId}.jsonl`);
  }
}

function safelyNotify(notify: () => void): void {
  try {
    notify();
  } catch {
    // Observers cannot invalidate a durable write.
  }
}

export function sessionAgentDirectoryName(agent: string): string {
  if (!agent.trim()) {
    throw new Error("Agent name cannot be empty for session storage.");
  }
  return encodeURIComponent(agent).replaceAll(".", "%2E");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
