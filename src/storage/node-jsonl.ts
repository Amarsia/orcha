import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SessionEvent, SessionStore } from "../types.js";

export class NodeJsonlSessionStore implements SessionStore {
  readonly directory: string;
  readonly #queues = new Map<string, Promise<void>>();

  constructor(directory = ".orcha/sessions", projectRoot = process.cwd()) {
    this.directory = resolve(projectRoot, directory);
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    const path = this.#sessionPath(sessionId);

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
      const path = this.#sessionPath(sessionId);
      await mkdir(dirname(path), { recursive: true });
      const lines = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
      await appendFile(path, lines, "utf8");
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
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name.slice(0, -".jsonl".length))
      .sort();
  }

  #sessionPath(sessionId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      throw new Error("Invalid session ID.");
    }
    return resolve(this.directory, `${sessionId}.jsonl`);
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
