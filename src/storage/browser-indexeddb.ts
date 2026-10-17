import type { SessionEvent, SessionStore } from "../types.js";

const DATABASE_VERSION = 1;
const EVENT_STORE = "events";

interface StoredEvent {
  id: string;
  namespace: string;
  sessionId: string;
  sequence: number;
  event: SessionEvent;
}

export class BrowserIndexedDbSessionStore implements SessionStore {
  readonly #databaseName: string;
  readonly #namespace: string;
  readonly #listeners = new Map<
    string,
    Set<(events: SessionEvent[]) => void>
  >();
  readonly #allListeners = new Set<
    (sessionId: string, events: SessionEvent[]) => void
  >();

  constructor(namespace: string, databaseName = "orchajs") {
    this.#namespace = namespace;
    this.#databaseName = databaseName;
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    const database = await this.#open();
    const transaction = database.transaction(EVENT_STORE, "readonly");
    const index = transaction.objectStore(EVENT_STORE).index("session");
    const records = await request<StoredEvent[]>(
      index.getAll(IDBKeyRange.only([this.#namespace, sessionId])),
    );
    await transactionComplete(transaction);
    return records
      .sort((left, right) => left.sequence - right.sequence)
      .map((record) => record.event);
  }

  async append(sessionId: string, events: SessionEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const database = await this.#open();
    const transaction = database.transaction(EVENT_STORE, "readwrite");
    const store = transaction.objectStore(EVENT_STORE);
    for (const event of events) {
      store.add({
        id: eventId(this.#namespace, sessionId, event.sequence),
        namespace: this.#namespace,
        sessionId,
        sequence: event.sequence,
        event,
      } satisfies StoredEvent);
    }
    await transactionComplete(transaction);
    this.#listeners.get(sessionId)?.forEach((listener) => listener(events));
    this.#allListeners.forEach((listener) => listener(sessionId, events));
  }

  async listSessionIds(): Promise<string[]> {
    const database = await this.#open();
    const transaction = database.transaction(EVENT_STORE, "readonly");
    const index = transaction.objectStore(EVENT_STORE).index("namespace");
    const records = await request<StoredEvent[]>(
      index.getAll(IDBKeyRange.only(this.#namespace)),
    );
    await transactionComplete(transaction);
    return [...new Set(records.map((record) => record.sessionId))].sort();
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
    return `indexeddb://${this.#databaseName}/${this.#namespace}/${sessionId}`;
  }

  #open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      throw new Error("IndexedDB is unavailable in this runtime.");
    }
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(this.#databaseName, DATABASE_VERSION);
      openRequest.onupgradeneeded = () => {
        const database = openRequest.result;
        if (database.objectStoreNames.contains(EVENT_STORE)) {
          return;
        }
        const store = database.createObjectStore(EVENT_STORE, {
          keyPath: "id",
        });
        store.createIndex("session", ["namespace", "sessionId"]);
        store.createIndex("namespace", "namespace");
      };
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onblocked = () =>
        reject(new Error("Opening the Orcha IndexedDB database was blocked."));
    });
  }
}

function eventId(
  namespace: string,
  sessionId: string,
  sequence: number,
): string {
  return `${namespace}\u0000${sessionId}\u0000${sequence
    .toString()
    .padStart(12, "0")}`;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}
