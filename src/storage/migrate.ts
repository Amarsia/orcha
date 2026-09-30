import type { SessionEvent, SessionStore } from "../types.js";

export interface SessionStoreMigrationResult {
  sessions: number;
  events: number;
}

export async function migrateSessionStore(
  source: SessionStore,
  destination: SessionStore,
): Promise<SessionStoreMigrationResult> {
  let sessions = 0;
  let events = 0;

  for (const sessionId of await source.listSessionIds()) {
    const sourceEvents = await source.read(sessionId);
    const destinationEvents = await destination.read(sessionId);
    assertCompatibleHistory(sessionId, sourceEvents, destinationEvents);
    const pending = sourceEvents.slice(destinationEvents.length);
    await destination.append(sessionId, pending);
    sessions += 1;
    events += pending.length;
  }

  return { sessions, events };
}

export async function exportSessionJsonl(
  store: SessionStore,
  sessionId: string,
): Promise<string> {
  const events = await store.read(sessionId);
  if (events.length === 0) {
    throw new Error(`Session "${sessionId}" was not found.`);
  }
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function assertCompatibleHistory(
  sessionId: string,
  source: SessionEvent[],
  destination: SessionEvent[],
): void {
  if (destination.length > source.length) {
    throw incompatibleHistory(sessionId);
  }
  for (let index = 0; index < destination.length; index += 1) {
    if (
      JSON.stringify(source[index]) !== JSON.stringify(destination[index])
    ) {
      throw incompatibleHistory(sessionId);
    }
  }
}

function incompatibleHistory(sessionId: string): Error {
  return new Error(
    `Cannot migrate session "${sessionId}" because the destination contains conflicting history.`,
  );
}
