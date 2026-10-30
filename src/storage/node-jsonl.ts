import {
  createReadStream,
  mkdirSync,
  watch,
  type FSWatcher,
} from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { SessionEvent, SessionStore } from "../types.js";

const acknowledgementWrites = new Map<string, Promise<void>>();
const TAIL_INDEX_STRIDE = 100;

interface TailCheckpoint {
  sequence: number;
  offset: number;
}

interface TailIndex {
  checkpoints: TailCheckpoint[];
  indexedSize: number;
}

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
  readonly #tailIndexes = new Map<string, TailIndex>();
  readonly #tailIndexLoads = new Map<string, Promise<TailIndex>>();

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

  async readAfterSequence(
    sessionId: string,
    afterSequence: number,
    limit: number,
  ): Promise<SessionEvent[]> {
    validateTailArguments(afterSequence, limit);
    const path = await this.#readSessionPath(sessionId);
    if (!path) return [];
    const index = await this.#getTailIndex(path, sessionId);
    const start = checkpointOffset(index.checkpoints, afterSequence + 1);
    const events: SessionEvent[] = [];
    const lines = createInterface({
      input: createReadStream(path, { encoding: "utf8", start }),
      crlfDelay: Infinity,
    });
    let lineNumber = 0;
    try {
      for await (const line of lines) {
        lineNumber += 1;
        if (!line) continue;
        let event: SessionEvent;
        try {
          event = JSON.parse(line) as SessionEvent;
        } catch (error) {
          throw new Error(
            `Corrupt JSONL event in session "${sessionId}" at line ${lineNumber}.`,
            { cause: error },
          );
        }
        if (event.sequence > afterSequence) events.push(event);
        if (events.length >= limit) break;
      }
      return events;
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    } finally {
      lines.close();
    }
  }

  async append(sessionId: string, events: SessionEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const previous = this.#queues.get(sessionId) ?? Promise.resolve();
    const write = previous.then(async () => {
      const path = await this.#writeSessionPath(sessionId);
      await mkdir(dirname(path), { recursive: true });
      const startOffset = await fileSize(path);
      const serialized = events.map((event) => `${JSON.stringify(event)}\n`);
      await appendFile(path, serialized.join(""), "utf8");
      const checkpoints: TailCheckpoint[] = [];
      let offset = startOffset;
      for (const [index, event] of events.entries()) {
        if ((event.sequence - 1) % TAIL_INDEX_STRIDE === 0) {
          checkpoints.push({ sequence: event.sequence, offset });
        }
        offset += Buffer.byteLength(serialized[index], "utf8");
      }
      await this.#recordTailIndex(path, startOffset, offset, checkpoints);
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

  async getCloudAcknowledgement(sessionId: string): Promise<number> {
    const path = await this.#cloudAcknowledgementPath(sessionId);
    if (!path) return 0;
    try {
      const value = Number(await readFile(path, "utf8"));
      return Number.isInteger(value) && value >= 0 ? value : 0;
    } catch (error) {
      if (isMissingFileError(error)) return 0;
      throw error;
    }
  }

  async setCloudAcknowledgement(
    sessionId: string,
    sequence: number,
  ): Promise<void> {
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new Error("Invalid cloud acknowledgement sequence.");
    }
    const sessionPath = await this.#writeSessionPath(sessionId);
    const path = `${sessionPath}.cloud-ack`;
    const previous = acknowledgementWrites.get(path) ?? Promise.resolve();
    const write = previous.then(async () => {
      const current = await this.getCloudAcknowledgement(sessionId);
      if (sequence <= current) return;
      const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporary, String(sequence), "utf8");
      await rename(temporary, path);
    });
    acknowledgementWrites.set(path, write);
    try {
      await write;
    } finally {
      if (acknowledgementWrites.get(path) === write) {
        acknowledgementWrites.delete(path);
      }
    }
  }

  async describeLocation(sessionId: string): Promise<string> {
    return (
      (await this.#readSessionPath(sessionId)) ??
      this.#sessionPath(this.directory, sessionId)
    );
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

  async #cloudAcknowledgementPath(
    sessionId: string,
  ): Promise<string | undefined> {
    const current = `${this.#sessionPath(this.directory, sessionId)}.cloud-ack`;
    if (await pathExists(current)) return current;
    const legacy = `${this.#sessionPath(this.#legacyDirectory, sessionId)}.cloud-ack`;
    return await pathExists(legacy) ? legacy : undefined;
  }

  async #getTailIndex(
    path: string,
    sessionId: string,
  ): Promise<TailIndex> {
    const size = await fileSize(path);
    const cached = this.#tailIndexes.get(path);
    if (cached?.indexedSize === size) return cached;
    const loading = this.#tailIndexLoads.get(path);
    if (loading) return loading;
    const load = this.#loadTailIndex(path, sessionId, size);
    this.#tailIndexLoads.set(path, load);
    try {
      const index = await load;
      this.#tailIndexes.set(path, index);
      return index;
    } finally {
      if (this.#tailIndexLoads.get(path) === load) {
        this.#tailIndexLoads.delete(path);
      }
    }
  }

  async #loadTailIndex(
    path: string,
    sessionId: string,
    size: number,
  ): Promise<TailIndex> {
    try {
      const source = await readFile(tailIndexPath(path), "utf8");
      const parsed = parseTailIndex(source);
      if (
        parsed.indexedSize === size &&
        (size === 0 || parsed.checkpoints[0]?.sequence === 1)
      ) {
        return parsed;
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.#tailIndexes.delete(path);
      }
    }
    return this.#rebuildTailIndex(path, sessionId);
  }

  async #rebuildTailIndex(
    path: string,
    sessionId: string,
  ): Promise<TailIndex> {
    const source = await readFile(path);
    const checkpoints: TailCheckpoint[] = [];
    let lineStart = 0;
    let lineNumber = 0;
    for (let cursor = 0; cursor <= source.length; cursor += 1) {
      if (cursor < source.length && source[cursor] !== 0x0a) continue;
      const end =
        cursor > lineStart && source[cursor - 1] === 0x0d
          ? cursor - 1
          : cursor;
      if (end > lineStart) {
        lineNumber += 1;
        let event: SessionEvent;
        try {
          event = JSON.parse(
            source.subarray(lineStart, end).toString("utf8"),
          ) as SessionEvent;
        } catch (error) {
          throw new Error(
            `Corrupt JSONL event in session "${sessionId}" at line ${lineNumber}.`,
            { cause: error },
          );
        }
        if ((event.sequence - 1) % TAIL_INDEX_STRIDE === 0) {
          checkpoints.push({ sequence: event.sequence, offset: lineStart });
        }
      }
      lineStart = cursor + 1;
    }
    const index = { checkpoints, indexedSize: source.length };
    await persistTailIndex(path, index);
    return index;
  }

  async #recordTailIndex(
    path: string,
    previousSize: number,
    indexedSize: number,
    checkpoints: TailCheckpoint[],
  ): Promise<void> {
    const cached = this.#tailIndexes.get(path);
    if (cached?.indexedSize === previousSize) {
      cached.checkpoints.push(...checkpoints);
      cached.indexedSize = indexedSize;
    } else {
      this.#tailIndexes.delete(path);
    }
    try {
      await appendFile(
        tailIndexPath(path),
        `${checkpoints
          .map(({ sequence, offset }) => `${sequence}\t${offset}\n`)
          .join("")}size\t${indexedSize}\n`,
        "utf8",
      );
    } catch {
      this.#tailIndexes.delete(path);
    }
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

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissingFileError(error)) return 0;
    throw error;
  }
}

function tailIndexPath(path: string): string {
  return `${path}.tail-index`;
}

function parseTailIndex(source: string): TailIndex {
  const checkpoints: TailCheckpoint[] = [];
  let indexedSize = -1;
  for (const line of source.split("\n")) {
    if (!line) continue;
    const [left, right] = line.split("\t");
    const value = Number(right);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Invalid JSONL tail index.");
    }
    if (left === "size") {
      indexedSize = value;
      continue;
    }
    const sequence = Number(left);
    const previous = checkpoints.at(-1);
    if (
      !Number.isSafeInteger(sequence) ||
      sequence <= 0 ||
      (previous !== undefined &&
        (sequence <= previous.sequence || value <= previous.offset))
    ) {
      throw new Error("Invalid JSONL tail index.");
    }
    checkpoints.push({ sequence, offset: value });
  }
  if (indexedSize < 0) throw new Error("Incomplete JSONL tail index.");
  return { checkpoints, indexedSize };
}

async function persistTailIndex(
  path: string,
  index: TailIndex,
): Promise<void> {
  const destination = tailIndexPath(path);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const source = `${index.checkpoints
    .map(({ sequence, offset }) => `${sequence}\t${offset}\n`)
    .join("")}size\t${index.indexedSize}\n`;
  try {
    await writeFile(temporary, source, "utf8");
    await rename(temporary, destination);
  } catch {
    // The index is an optimization and is rebuilt from the canonical JSONL.
  }
}

function checkpointOffset(
  checkpoints: TailCheckpoint[],
  targetSequence: number,
): number {
  let low = 0;
  let high = checkpoints.length - 1;
  let offset = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const checkpoint = checkpoints[middle];
    if (checkpoint.sequence <= targetSequence) {
      offset = checkpoint.offset;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return offset;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function validateTailArguments(afterSequence: number, limit: number): void {
  if (
    !Number.isInteger(afterSequence) ||
    afterSequence < 0 ||
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    throw new Error("Invalid session event tail range.");
  }
}
