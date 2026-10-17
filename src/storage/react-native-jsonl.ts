import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SessionEvent, SessionStore } from "../types.js";

const writes = new Map<string, Promise<void>>();

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

  async append(sessionId: string, events: SessionEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const key = this.#key(sessionId);
    const previous = writes.get(key) ?? Promise.resolve();
    const write = previous.then(async () => {
      const existing = await AsyncStorage.getItem(key);
      const appended = events.map((event) => JSON.stringify(event)).join("\n");
      await AsyncStorage.setItem(
        key,
        `${existing ? `${existing.replace(/\n*$/, "")}\n` : ""}${appended}\n`,
      );
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
}
