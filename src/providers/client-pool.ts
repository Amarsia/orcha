export class ClientPool<T> {
  readonly #maxEntries: number;
  readonly #onEvict?: (client: T) => void;
  readonly #entries = new Map<string, T>();

  constructor(options?: {
    maxEntries?: number;
    onEvict?: (client: T) => void;
  }) {
    this.#maxEntries = options?.maxEntries ?? 16;
    this.#onEvict = options?.onEvict;
  }

  getOrCreate(key: string, create: () => T): T {
    const existing = this.#entries.get(key);
    if (existing !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, existing);
      return existing;
    }

    const created = create();
    if (this.#entries.size >= this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value;
      if (oldestKey !== undefined) {
        const oldestClient = this.#entries.get(oldestKey);
        this.#entries.delete(oldestKey);
        if (oldestClient !== undefined) {
          this.#onEvict?.(oldestClient);
        }
      }
    }
    this.#entries.set(key, created);
    return created;
  }
}
