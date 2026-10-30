import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SessionEvent, SessionStore } from "../types.js";

const writes = new Map<string, Promise<void>>();
const tailIndexes = new Map<string, TailIndex>();
const TAIL_CHUNK_SIZE = 100;
let tailChunkGeneration = 0;

interface TailChunk {
  key: string;
  firstSequence: number;
  lastSequence: number;
  count: number;
}

interface TailIndex {
  version: 1;
  eventCount: number;
  chunks: TailChunk[];
}

export class ReactNativeJsonlSessionStore implements SessionStore {
  readonly #namespace: string;
  readonly #listeners = new Map<
    string,
    Set<(events: SessionEvent[]) => void>
  >();
  readonly #allListeners = new Set<
    (sessionId: string, events: SessionEvent[]) => void
  >();

  constructor(namespace: string) {
    this.#namespace = namespace;
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    const contents = await AsyncStorage.getItem(this.#key(sessionId));
    if (!contents) {
      return [];
    }
    return contents
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SessionEvent);
  }

  async readAfterSequence(
    sessionId: string,
    afterSequence: number,
    limit: number,
  ): Promise<SessionEvent[]> {
    if (
      !Number.isInteger(afterSequence) ||
      afterSequence < 0 ||
      !Number.isInteger(limit) ||
      limit <= 0
    ) {
      throw new Error("Invalid session event tail range.");
    }
    await writes.get(this.#key(sessionId))?.catch(() => undefined);
    const index = await this.#ensureTailIndex(sessionId);
    const relevant = index.chunks.filter(
      (chunk) => chunk.lastSequence > afterSequence,
    );
    const events: SessionEvent[] = [];
    for (const chunk of relevant) {
      const contents = await AsyncStorage.getItem(chunk.key);
      if (contents === null) {
        tailIndexes.delete(this.#tailIndexKey(sessionId));
        return this.#readTailFromCanonical(
          sessionId,
          afterSequence,
          limit,
        );
      }
      const parsed = parseEvents(contents).slice(0, chunk.count);
      for (const event of parsed) {
        if (event.sequence > afterSequence) events.push(event);
        if (events.length === limit) return events;
      }
    }
    return events;
  }

  async append(sessionId: string, events: SessionEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const key = this.#key(sessionId);
    const previous = writes.get(key) ?? Promise.resolve();
    const write = previous.then(async () => {
      const index = await this.#ensureTailIndex(sessionId);
      await AsyncStorage.setItem(this.#tailPendingKey(sessionId), "1");
      const existing = await AsyncStorage.getItem(key);
      const appended = events.map((event) => JSON.stringify(event)).join("\n");
      await AsyncStorage.setItem(
        key,
        `${existing ? `${existing.replace(/\n*$/, "")}\n` : ""}${appended}\n`,
      );
      try {
        await this.#appendTailIndex(sessionId, index, events);
        await AsyncStorage.removeItem(this.#tailPendingKey(sessionId));
      } catch {
        tailIndexes.delete(this.#tailIndexKey(sessionId));
        // Canonical JSONL is already durable. A pending marker makes the
        // auxiliary index rebuild on the next tail read.
      }
    });
    writes.set(key, write);
    try {
      await write;
    } finally {
      if (writes.get(key) === write) {
        writes.delete(key);
      }
    }
    this.#listeners.get(sessionId)?.forEach((listener) => listener(events));
    this.#allListeners.forEach((listener) => listener(sessionId, events));
  }

  async listSessionIds(): Promise<string[]> {
    const prefix = `@orchajs:${this.#namespace}:`;
    return (await AsyncStorage.getAllKeys())
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  async getCloudAcknowledgement(sessionId: string): Promise<number> {
    const value = Number(
      await AsyncStorage.getItem(this.#acknowledgementKey(sessionId)),
    );
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }

  async setCloudAcknowledgement(
    sessionId: string,
    sequence: number,
  ): Promise<void> {
    if (!Number.isInteger(sequence) || sequence < 0) {
      throw new Error("Invalid cloud acknowledgement sequence.");
    }
    const key = this.#acknowledgementKey(sessionId);
    const previous = writes.get(key) ?? Promise.resolve();
    const write = previous.then(async () => {
      const current = Number(await AsyncStorage.getItem(key));
      if (!Number.isInteger(current) || current < sequence) {
        await AsyncStorage.setItem(key, String(sequence));
      }
    });
    writes.set(key, write);
    try {
      await write;
    } finally {
      if (writes.get(key) === write) writes.delete(key);
    }
  }

  subscribe(
    sessionId: string,
    listener: (events: SessionEvent[]) => void,
  ): () => void {
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
    return () => this.#allListeners.delete(listener);
  }

  async describeLocation(sessionId: string): Promise<string> {
    return `async-storage://${this.#key(sessionId)}`;
  }

  #key(sessionId: string): string {
    return `@orchajs:${this.#namespace}:${sessionId}`;
  }

  #acknowledgementKey(sessionId: string): string {
    return `@orchajs-cloud-ack:${this.#namespace}:${sessionId}`;
  }

  #tailIndexKey(sessionId: string): string {
    return `@orchajs-tail-index:${this.#namespace}:${sessionId}`;
  }

  #tailPendingKey(sessionId: string): string {
    return `@orchajs-tail-pending:${this.#namespace}:${sessionId}`;
  }

  #tailChunkKey(sessionId: string): string {
    tailChunkGeneration += 1;
    return `@orchajs-tail-chunk:${this.#namespace}:${sessionId}:${Date.now()}:${tailChunkGeneration}`;
  }

  async #ensureTailIndex(sessionId: string): Promise<TailIndex> {
    const indexKey = this.#tailIndexKey(sessionId);
    const pending = await AsyncStorage.getItem(
      this.#tailPendingKey(sessionId),
    );
    if (!pending) {
      const cached = tailIndexes.get(indexKey);
      if (cached) return cached;
      const stored = await AsyncStorage.getItem(indexKey);
      if (stored) {
        try {
          const parsed = parseTailIndex(stored);
          tailIndexes.set(indexKey, parsed);
          return parsed;
        } catch {
          // Rebuild invalid auxiliary data from canonical JSONL.
        }
      }
    }
    return this.#rebuildTailIndex(sessionId);
  }

  async #rebuildTailIndex(sessionId: string): Promise<TailIndex> {
    const events = await this.read(sessionId);
    const chunks: TailChunk[] = [];
    const writes: Array<[string, string]> = [];
    for (let start = 0; start < events.length; start += TAIL_CHUNK_SIZE) {
      const chunkEvents = events.slice(start, start + TAIL_CHUNK_SIZE);
      const key = this.#tailChunkKey(sessionId);
      writes.push([key, serializeEvents(chunkEvents)]);
      chunks.push(tailChunk(key, chunkEvents));
    }
    const index: TailIndex = {
      version: 1,
      eventCount: events.length,
      chunks,
    };
    writes.push([this.#tailIndexKey(sessionId), JSON.stringify(index)]);
    if (writes.length > 0) await AsyncStorage.multiSet(writes);
    await AsyncStorage.removeItem(this.#tailPendingKey(sessionId));
    tailIndexes.set(this.#tailIndexKey(sessionId), index);
    return index;
  }

  async #appendTailIndex(
    sessionId: string,
    current: TailIndex,
    events: SessionEvent[],
  ): Promise<void> {
    const chunks = [...current.chunks];
    const replacements: Array<[string, string]> = [];
    const obsolete: string[] = [];
    let remaining = [...events];
    const last = chunks.at(-1);
    if (last && last.count < TAIL_CHUNK_SIZE) {
      const stored = await AsyncStorage.getItem(last.key);
      if (stored === null) throw new Error("Missing tail index chunk.");
      const retained = parseEvents(stored).slice(0, last.count);
      const added = remaining.splice(
        0,
        TAIL_CHUNK_SIZE - retained.length,
      );
      const combined = [...retained, ...added];
      const key = this.#tailChunkKey(sessionId);
      replacements.push([key, serializeEvents(combined)]);
      chunks[chunks.length - 1] = tailChunk(key, combined);
      obsolete.push(last.key);
    }
    while (remaining.length > 0) {
      const chunkEvents = remaining.splice(0, TAIL_CHUNK_SIZE);
      const key = this.#tailChunkKey(sessionId);
      replacements.push([key, serializeEvents(chunkEvents)]);
      chunks.push(tailChunk(key, chunkEvents));
    }
    const index: TailIndex = {
      version: 1,
      eventCount: current.eventCount + events.length,
      chunks,
    };
    replacements.push([
      this.#tailIndexKey(sessionId),
      JSON.stringify(index),
    ]);
    await AsyncStorage.multiSet(replacements);
    tailIndexes.set(this.#tailIndexKey(sessionId), index);
    await Promise.all(
      obsolete.map((key) => AsyncStorage.removeItem(key)),
    );
  }

  async #readTailFromCanonical(
    sessionId: string,
    afterSequence: number,
    limit: number,
  ): Promise<SessionEvent[]> {
    const index = await this.#rebuildTailIndex(sessionId);
    const events: SessionEvent[] = [];
    for (const chunk of index.chunks) {
      if (chunk.lastSequence <= afterSequence) continue;
      const contents = await AsyncStorage.getItem(chunk.key);
      if (!contents) continue;
      for (const event of parseEvents(contents).slice(0, chunk.count)) {
        if (event.sequence > afterSequence) events.push(event);
        if (events.length === limit) return events;
      }
    }
    return events;
  }
}

function tailChunk(key: string, events: SessionEvent[]): TailChunk {
  return {
    key,
    firstSequence: events[0].sequence,
    lastSequence: events.at(-1)!.sequence,
    count: events.length,
  };
}

function serializeEvents(events: SessionEvent[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function parseEvents(contents: string): SessionEvent[] {
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SessionEvent);
}

function parseTailIndex(contents: string): TailIndex {
  const value = JSON.parse(contents) as Partial<TailIndex>;
  if (
    value.version !== 1 ||
    !Number.isInteger(value.eventCount) ||
    (value.eventCount ?? -1) < 0 ||
    !Array.isArray(value.chunks)
  ) {
    throw new Error("Invalid React Native tail index.");
  }
  let count = 0;
  let previousSequence = 0;
  for (const chunk of value.chunks) {
    if (
      typeof chunk?.key !== "string" ||
      !Number.isInteger(chunk.firstSequence) ||
      !Number.isInteger(chunk.lastSequence) ||
      !Number.isInteger(chunk.count) ||
      chunk.count <= 0 ||
      chunk.count > TAIL_CHUNK_SIZE ||
      chunk.firstSequence <= previousSequence ||
      chunk.lastSequence < chunk.firstSequence
    ) {
      throw new Error("Invalid React Native tail index.");
    }
    count += chunk.count;
    previousSequence = chunk.lastSequence;
  }
  if (count !== value.eventCount) {
    throw new Error("Invalid React Native tail index.");
  }
  return value as TailIndex;
}
