import type { SessionEvent, SessionStore } from "../types.js";

/**
 * Future browser storage strategy.
 *
 * It will persist the same ordered SessionEvent records used by the JSONL
 * strategy in IndexedDB. Import and export will preserve the canonical JSONL
 * representation so a session can move between browser, Node, and remote
 * stores without changing the runtime or replay engine.
 *
 * Required before implementation:
 * - transactional sequence allocation;
 * - multi-tab writer coordination;
 * - quota and eviction handling;
 * - schema migrations and JSONL import/export.
 */
export class BrowserIndexedDbSessionStore implements SessionStore {
  async read(_sessionId: string): Promise<SessionEvent[]> {
    throw new Error("Browser IndexedDB session storage is not implemented yet.");
  }

  async append(_sessionId: string, _events: SessionEvent[]): Promise<void> {
    throw new Error("Browser IndexedDB session storage is not implemented yet.");
  }
}
