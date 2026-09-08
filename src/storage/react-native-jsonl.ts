import type { SessionEvent, SessionStore } from "../types.js";

/**
 * Future React Native storage strategy.
 *
 * It will store one JSONL event stream per session inside the application's
 * private documents directory. The implementation must not assume Node's
 * `fs` module: Expo FileSystem and bare React Native filesystem bindings need
 * a small host adapter while retaining the exact SessionStore contract.
 *
 * Required before implementation:
 * - Expo and bare React Native filesystem adapters;
 * - atomic append/recovery behavior on iOS and Android;
 * - app lifecycle interruption handling;
 * - JSONL import/export conformance tests.
 */
export class ReactNativeJsonlSessionStore implements SessionStore {
  async read(_sessionId: string): Promise<SessionEvent[]> {
    throw new Error("React Native JSONL session storage is not implemented yet.");
  }

  async append(_sessionId: string, _events: SessionEvent[]): Promise<void> {
    throw new Error("React Native JSONL session storage is not implemented yet.");
  }
}
