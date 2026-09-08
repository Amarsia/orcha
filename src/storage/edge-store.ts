import type { SessionEvent, SessionStore } from "../types.js";

/**
 * Future edge/serverless storage strategy.
 *
 * Edge runtimes generally do not provide a durable local filesystem. This
 * strategy will adapt an injected durable backend (for example object storage,
 * Durable Objects, KV with compare-and-swap, or Amarsia) to SessionStore.
 *
 * Required before implementation:
 * - optimistic revision and conflict semantics;
 * - atomic sequence allocation across workers;
 * - retry and partial-write behavior;
 * - conformance tests against representative edge backends.
 */
export class EdgeSessionStore implements SessionStore {
  async read(_sessionId: string): Promise<SessionEvent[]> {
    throw new Error("Edge session storage is not implemented yet.");
  }

  async append(_sessionId: string, _events: SessionEvent[]): Promise<void> {
    throw new Error("Edge session storage is not implemented yet.");
  }
}
