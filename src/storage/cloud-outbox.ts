import { resolveAmarsiaEndpoint } from "../amarsia/endpoint.js";
import { OrchaError } from "../errors.js";
import type { SessionEvent, SessionStore } from "../types.js";

export interface CloudSessionStoreOptions {
  local: SessionStore;
  key: string;
  endpoint?: string;
  agentName: string;
}

interface RemoteEventPage {
  events: SessionEvent[];
  latestSequence: number;
}

const MAX_CONCURRENT_SESSIONS = 4;
const MAX_BATCH_EVENTS = 100;
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 30_000;
const RECOVERY_ATTEMPTS = 4;

class RemoteUnavailableError extends Error {}
class RemoteConflictError extends Error {}

/**
 * A durable local-first outbox. Local appends never wait for cloud I/O; the
 * persisted acknowledgement lets a new process recover unsent session tails.
 */
export class CloudSessionStore implements SessionStore {
  readonly #local: SessionStore;
  readonly #key: string;
  readonly #endpoint: string;
  readonly #agentName: string;
  readonly #targets = new Map<string, number>();
  readonly #running = new Set<string>();
  readonly #tasks = new Map<string, Promise<void>>();
  readonly #parked = new Set<string>();
  readonly #attempts = new Map<string, number>();
  readonly #retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #memoryAcknowledgements = new Map<string, number>();
  readonly #stateWaiters = new Set<() => void>();
  readonly #fetchControllers = new Set<AbortController>();
  readonly #localMutations = new Map<string, Promise<void>>();
  readonly #recoveryFailures = new Set<string>();
  #lastError: Error | undefined;
  #recoveryDiscoveryFailed = false;
  #closing = false;
  #closed = false;
  #closePromise: Promise<void> | undefined;
  readonly #recovery: Promise<void>;

  constructor(options: CloudSessionStoreOptions) {
    if (!options.key.trim()) {
      throw storageError(
        'Storage strategy "cloud" requires a non-empty amarsia.key.',
      );
    }
    this.#local = options.local;
    this.#key = options.key;
    this.#endpoint = resolveAmarsiaEndpoint(options.endpoint);
    this.#agentName = options.agentName;
    this.#recovery = Promise.resolve()
      .then(() => this.#retryRecovery(() => this.#recover()))
      .catch((error: unknown) => {
        this.#recoveryDiscoveryFailed = true;
        this.#recordError(error);
      });
  }

  get cloudStoragePendingCount(): number {
    return this.#targets.size;
  }

  get cloudStorageLastError(): Error | undefined {
    return this.#lastError;
  }

  async read(sessionId: string): Promise<SessionEvent[]> {
    return this.#local.read(sessionId);
  }

  async append(sessionId: string, events: SessionEvent[]): Promise<void> {
    if (events.length === 0) return;
    if (this.#closing || this.#closed) {
      throw storageError("Cloud session storage is closing or closed.");
    }
    await this.#mutateLocal(sessionId, () =>
      this.#local.append(sessionId, events),
    );
    this.#queue(sessionId, lastSequence(events));
  }

  async refreshCloudSession(sessionId: string): Promise<void> {
    if (this.#closing || this.#closed) {
      throw storageError("Cloud session storage is closing or closed.");
    }
    const local = await this.#local.read(sessionId);
    if (local.length === 0) {
      const remote = await this.#readRemoteTail(sessionId, 0);
      if (this.#closing || this.#closed || remote.events.length === 0) return;
      await this.#mutateLocal(sessionId, async () => {
        if ((await this.#local.read(sessionId)).length > 0) return;
        await this.#local.append(sessionId, remote.events);
        await this.#setAcknowledgement(sessionId, remote.latestSequence);
      });
      return;
    }
    await this.#refreshWarmSession(sessionId, lastSequence(local));
  }

  async listSessionIds(): Promise<string[]> {
    return this.#local.listSessionIds();
  }

  subscribe(
    sessionId: string,
    listener: (events: SessionEvent[]) => void,
  ): () => void {
    return this.#local.subscribe?.(sessionId, listener) ?? (() => {});
  }

  subscribeAll(
    listener: (sessionId: string, events: SessionEvent[]) => void,
  ): () => void {
    return this.#local.subscribeAll?.(listener) ?? (() => {});
  }

  async describeLocation(sessionId: string): Promise<string> {
    return (
      (await this.#local.describeLocation?.(sessionId)) ??
      `amarsia://${encodeURIComponent(this.#agentName)}/${sessionId}`
    );
  }

  async flushCloudStorage(
    options: { timeoutMs?: number } = {},
  ): Promise<void> {
    if (this.#closed) throw storageError("Cloud session storage is closed.");
    const timeoutMs = Math.max(0, options.timeoutMs ?? 2_000);
    const deadline = Date.now() + timeoutMs;
    if (!(await this.#waitWithin(this.#recovery, deadline))) {
      throw incompleteFlushError(this.#targets.size, this.#lastError);
    }
    if (
      this.#recoveryDiscoveryFailed ||
      this.#recoveryFailures.size > 0
    ) {
      let recovered = false;
      try {
        recovered = await this.#waitWithin(
          this.#retryRecovery(() => this.#recover()),
          deadline,
        );
      } catch (error) {
        this.#recoveryDiscoveryFailed = true;
        this.#recordError(error);
      }
      if (
        !recovered ||
        this.#recoveryDiscoveryFailed ||
        this.#recoveryFailures.size > 0
      ) {
        throw incompleteFlushError(
          this.#targets.size + this.#recoveryFailures.size,
          this.#lastError,
        );
      }
    }
    this.#retryTimers.forEach((timer, sessionId) => {
      clearTimeout(timer);
      this.#retryTimers.delete(sessionId);
    });
    this.#parked.clear();
    this.#schedule();
    while (this.#targets.size > 0 || this.#running.size > 0) {
      if (
        this.#running.size === 0 &&
        this.#retryTimers.size === 0 &&
        [...this.#targets.keys()].every((sessionId) =>
          this.#parked.has(sessionId),
        )
      ) {
        throw incompleteFlushError(this.#targets.size, this.#lastError);
      }
      if (Date.now() >= deadline) {
        throw incompleteFlushError(this.#targets.size, this.#lastError);
      }
      await this.#waitForState(deadline);
      this.#schedule();
    }
  }

  async closeCloudStorage(
    options: { timeoutMs?: number } = {},
  ): Promise<void> {
    if (this.#closed) return;
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    const close = this.#performClose(options);
    this.#closePromise = close;
    return close;
  }

  async #performClose(options: { timeoutMs?: number }): Promise<void> {
    let flushError: unknown;
    try {
      await this.#awaitLocalMutations();
      try {
        await this.#recover();
      } catch (error) {
        this.#recoveryDiscoveryFailed = true;
        this.#recordError(error);
      }
      await this.flushCloudStorage(options);
    } catch (error) {
      flushError = error;
    } finally {
      this.#closed = true;
      for (const timer of this.#retryTimers.values()) clearTimeout(timer);
      this.#retryTimers.clear();
      for (const controller of this.#fetchControllers) controller.abort();
      this.#signalState();
      await Promise.allSettled([
        ...this.#tasks.values(),
      ]);
    }
    if (flushError !== undefined) throw flushError;
  }

  async #awaitLocalMutations(): Promise<void> {
    while (this.#localMutations.size > 0) {
      await Promise.allSettled([...this.#localMutations.values()]);
    }
  }

  async #recover(): Promise<void> {
    const sessionIds = await this.#local.listSessionIds();
    this.#recoveryDiscoveryFailed = false;
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(MAX_CONCURRENT_SESSIONS, sessionIds.length) },
      async () => {
        while (cursor < sessionIds.length) {
          const sessionId = sessionIds[cursor++];
          try {
            await this.#retryRecovery(async () => {
              const acknowledged = await this.#getAcknowledgement(sessionId);
              let localSequence = acknowledged;
              for (;;) {
                const events = await this.#readLocalTail(
                  sessionId,
                  localSequence,
                  MAX_BATCH_EVENTS,
                );
                if (events.length === 0) break;
                localSequence = lastSequence(events);
              }
              if (localSequence > acknowledged) {
                this.#queue(sessionId, localSequence);
              }
            });
            this.#recoveryFailures.delete(sessionId);
          } catch (error) {
            this.#recoveryFailures.add(sessionId);
            this.#recordError(error);
          }
        }
      },
    );
    await Promise.all(workers);
  }

  #queue(sessionId: string, target: number): void {
    if (target <= 0 || this.#closed) return;
    this.#recoveryFailures.delete(sessionId);
    this.#parked.delete(sessionId);
    this.#attempts.delete(sessionId);
    this.#targets.set(
      sessionId,
      Math.max(target, this.#targets.get(sessionId) ?? 0),
    );
    this.#signalState();
    this.#schedule();
  }

  #schedule(): void {
    if (this.#closed) return;
    for (const sessionId of this.#targets.keys()) {
      if (this.#running.size >= MAX_CONCURRENT_SESSIONS) break;
      if (
        this.#running.has(sessionId) ||
        this.#parked.has(sessionId) ||
        this.#retryTimers.has(sessionId)
      ) {
        continue;
      }
      this.#running.add(sessionId);
      const task = this.#deliver(sessionId).finally(() => {
        this.#running.delete(sessionId);
        this.#tasks.delete(sessionId);
        this.#signalState();
        this.#schedule();
      });
      this.#tasks.set(sessionId, task);
    }
  }

  async #deliver(sessionId: string): Promise<void> {
    let attemptedTarget = 0;
    try {
      while (!this.#closed) {
        const target = this.#targets.get(sessionId);
        if (target === undefined) return;
        attemptedTarget = target;
        const acknowledged = await this.#getAcknowledgement(sessionId);
        const events = await this.#readLocalTail(
          sessionId,
          acknowledged,
          MAX_BATCH_EVENTS,
        );
        if (events.length === 0) {
          if ((this.#targets.get(sessionId) ?? 0) <= acknowledged) {
            this.#targets.delete(sessionId);
          } else {
            throw storageError(
              `Local session "${sessionId}" is missing events after sequence ${acknowledged}.`,
            );
          }
          return;
        }
        assertContiguous(events, acknowledged, sessionId);
        try {
          await this.#appendRemote(sessionId, acknowledged, events);
          await this.#setAcknowledgement(sessionId, lastSequence(events));
        } catch (error) {
          if (!(error instanceof RemoteConflictError)) throw error;
          await this.#reconcileConflict(sessionId, acknowledged);
        }
        this.#attempts.delete(sessionId);
        this.#lastError = undefined;
        const delivered = await this.#getAcknowledgement(sessionId);
        if ((this.#targets.get(sessionId) ?? 0) <= delivered) {
          this.#targets.delete(sessionId);
          this.#signalState();
          return;
        }
      }
    } catch (error) {
      this.#recordError(error);
      if (error instanceof RemoteUnavailableError) {
        this.#scheduleRetry(sessionId);
      } else if ((this.#targets.get(sessionId) ?? 0) <= attemptedTarget) {
        this.#parked.add(sessionId);
      }
      this.#signalState();
    }
  }

  async #reconcileConflict(
    sessionId: string,
    acknowledged: number,
  ): Promise<void> {
    const remote = await this.#readRemoteTail(sessionId, acknowledged);
    if (remote.latestSequence < acknowledged) {
      throw divergenceError(sessionId, remote.latestSequence + 1);
    }
    if (remote.events.length === 0) {
      throw storageError(
        `Cloud session "${sessionId}" returned no events for a conflicting append.`,
      );
    }

    await this.#mutateLocal(sessionId, async () => {
      const local = await this.#readLocalTail(
        sessionId,
        acknowledged,
        remote.events.length + 1,
      );
      const sharedLength = Math.min(local.length, remote.events.length);
      for (let index = 0; index < sharedLength; index += 1) {
        const localEvent = local[index];
        const remoteEvent = remote.events[index];
        if (!localEvent || !remoteEvent || !eventsEqual(localEvent, remoteEvent)) {
          throw divergenceError(
            sessionId,
            remoteEvent?.sequence ?? localEvent?.sequence ?? acknowledged + index + 1,
          );
        }
      }

      if (remote.events.length > local.length) {
        await this.#local.append(sessionId, remote.events.slice(local.length));
      }
      await this.#setAcknowledgement(sessionId, remote.latestSequence);
    });
  }

  #scheduleRetry(sessionId: string): void {
    if (
      this.#closed ||
      this.#parked.has(sessionId) ||
      this.#retryTimers.has(sessionId)
    ) {
      return;
    }
    const attempt = (this.#attempts.get(sessionId) ?? 0) + 1;
    this.#attempts.set(sessionId, attempt);
    const ceiling = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
    const delay = Math.floor(Math.random() * ceiling);
    const timer = setTimeout(() => {
      this.#retryTimers.delete(sessionId);
      this.#signalState();
      this.#schedule();
    }, delay);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    this.#retryTimers.set(sessionId, timer);
  }

  async #refreshWarmSession(
    sessionId: string,
    localSequence: number,
  ): Promise<void> {
    const acknowledged = await this.#getAcknowledgement(sessionId);
    if (
      acknowledged !== localSequence ||
      this.#closing ||
      this.#closed
    ) {
      return;
    }
    const remote = await this.#readRemoteTail(sessionId, localSequence);
    if (
      remote.events.length === 0 ||
      this.#closing ||
      this.#closed
    ) {
      return;
    }
    await this.#mutateLocal(sessionId, async () => {
      const appended = await this.#readLocalTail(sessionId, localSequence, 1);
      const currentAcknowledgement = await this.#getAcknowledgement(sessionId);
      if (appended.length > 0 || currentAcknowledgement !== localSequence) {
        return;
      }
      await this.#local.append(sessionId, remote.events);
      await this.#setAcknowledgement(sessionId, remote.latestSequence);
    });
  }

  async #readLocalTail(
    sessionId: string,
    afterSequence: number,
    limit: number,
  ): Promise<SessionEvent[]> {
    if (this.#local.readAfterSequence) {
      return this.#local.readAfterSequence(sessionId, afterSequence, limit);
    }
    return (await this.#local.read(sessionId))
      .filter((event) => event.sequence > afterSequence)
      .slice(0, limit);
  }

  async #mutateLocal(
    sessionId: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    const previous = this.#localMutations.get(sessionId) ?? Promise.resolve();
    const mutation = previous.then(operation);
    this.#localMutations.set(sessionId, mutation);
    try {
      await mutation;
    } finally {
      if (this.#localMutations.get(sessionId) === mutation) {
        this.#localMutations.delete(sessionId);
      }
    }
  }

  async #retryRecovery(operation: () => Promise<void>): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt += 1) {
      try {
        await operation();
        return;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < RECOVERY_ATTEMPTS) {
          const ceiling = RETRY_BASE_MS * 2 ** attempt;
          await delay(Math.floor(Math.random() * ceiling));
        }
      }
    }
    throw lastError;
  }

  async #getAcknowledgement(sessionId: string): Promise<number> {
    return (
      (await this.#local.getCloudAcknowledgement?.(sessionId)) ??
      this.#memoryAcknowledgements.get(sessionId) ??
      0
    );
  }

  async #setAcknowledgement(
    sessionId: string,
    sequence: number,
  ): Promise<void> {
    if (this.#local.setCloudAcknowledgement) {
      await this.#local.setCloudAcknowledgement(sessionId, sequence);
    } else {
      this.#memoryAcknowledgements.set(
        sessionId,
        Math.max(sequence, this.#memoryAcknowledgements.get(sessionId) ?? 0),
      );
    }
  }

  async #readRemoteTail(
    sessionId: string,
    afterSequence: number,
  ): Promise<RemoteEventPage> {
    const first = await this.#readRemoteEvents(sessionId, afterSequence);
    const events = [...first.events];
    let receivedThrough = events.at(-1)?.sequence ?? afterSequence;
    while (receivedThrough < first.latestSequence) {
      const next = await this.#readRemoteEvents(sessionId, receivedThrough);
      if (next.latestSequence < receivedThrough || next.events.length === 0) {
        throw storageError(`Cloud session "${sessionId}" returned an incomplete remote tail.`);
      }
      events.push(...next.events);
      receivedThrough = events.at(-1)?.sequence ?? receivedThrough;
    }
    return { events, latestSequence: Math.max(first.latestSequence, receivedThrough) };
  }

  async #readRemoteEvents(
    sessionId: string,
    afterSequence: number,
  ): Promise<RemoteEventPage> {
    const url = new URL(
      `${this.#endpoint}/v3/session-storage/sessions/${encodeURIComponent(sessionId)}/events`,
    );
    url.searchParams.set("agent_name", this.#agentName);
    url.searchParams.set("after_sequence", String(afterSequence));
    url.searchParams.set("limit", String(MAX_BATCH_EVENTS));
    const body = await this.#request(url);
    if (
      !isRecord(body) ||
      !Array.isArray(body.events) ||
      !Number.isInteger(body.latest_sequence) ||
      (body.latest_sequence as number) < 0
    ) {
      throw storageError("Amarsia returned an invalid session event response.");
    }
    const events = body.events.map((event) => validateEvent(event, sessionId));
    let expected = afterSequence + 1;
    for (const event of events) {
      if (event.sequence !== expected) throw divergenceError(sessionId, expected);
      expected += 1;
    }
    if (events.length > MAX_BATCH_EVENTS) {
      throw storageError("Amarsia returned an oversized session event page.");
    }
    if (lastSequence(events) > (body.latest_sequence as number)) {
      throw storageError("Amarsia returned an invalid latest session sequence.");
    }
    return { events, latestSequence: body.latest_sequence as number };
  }

  async #appendRemote(
    sessionId: string,
    expectedSequence: number,
    events: SessionEvent[],
  ): Promise<void> {
    if (events.length === 0 || events.length > MAX_BATCH_EVENTS) {
      throw storageError(
        `Cloud session upload batches must contain 1-${MAX_BATCH_EVENTS} events.`,
      );
    }
    const url = new URL(
      `${this.#endpoint}/v3/session-storage/sessions/${encodeURIComponent(sessionId)}/events`,
    );
    const response = await this.#fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-amarsia-project-key": this.#key,
      },
      body: JSON.stringify({
        agent_name: this.#agentName,
        expected_sequence: expectedSequence,
        events,
      }),
    });
    await assertSuccessfulResponse(response);
  }

  async #request(url: URL): Promise<unknown> {
    const response = await this.#fetch(url, {
      headers: { "x-amarsia-project-key": this.#key },
    });
    await assertSuccessfulResponse(response);
    try {
      return await response.json();
    } catch (error) {
      throw storageError("Amarsia returned invalid session storage JSON.", undefined, error);
    }
  }

  async #fetch(input: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    this.#fetchControllers.add(controller);
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      throw new RemoteUnavailableError(
        `Amarsia session storage is unavailable: ${String(error)}`,
      );
    } finally {
      clearTimeout(timer);
      this.#fetchControllers.delete(controller);
    }
  }

  #recordError(error: unknown): void {
    this.#lastError =
      error instanceof Error ? error : new Error(String(error));
    this.#signalState();
  }

  #signalState(): void {
    for (const resolve of this.#stateWaiters) resolve();
    this.#stateWaiters.clear();
  }

  async #waitForState(deadline: number): Promise<void> {
    const remaining = Math.max(0, deadline - Date.now());
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.#stateWaiters.delete(done);
        resolve();
      }, remaining);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.#stateWaiters.add(done);
    });
  }

  async #waitWithin(
    operation: Promise<void>,
    deadline: number,
  ): Promise<boolean> {
    const remaining = Math.max(0, deadline - Date.now());
    return Promise.race([
      operation.then(() => true),
      new Promise<false>((resolve) =>
        setTimeout(() => resolve(false), remaining),
      ),
    ]);
  }
}

function validateEvent(event: unknown, sessionId: string): SessionEvent {
  if (
    !isRecord(event) ||
    !Number.isInteger(event.sequence) ||
    typeof event.type !== "string" ||
    typeof event.timestamp !== "string" ||
    !isRecord(event.data)
  ) {
    throw storageError(`Amarsia returned an invalid event for session "${sessionId}".`);
  }
  return event as unknown as SessionEvent;
}

function lastSequence(events: SessionEvent[]): number {
  return events.at(-1)?.sequence ?? 0;
}

function assertContiguous(
  events: SessionEvent[],
  afterSequence: number,
  sessionId: string,
): void {
  let expected = afterSequence + 1;
  for (const event of events) {
    if (event.sequence !== expected) {
      throw storageError(
        `Local session "${sessionId}" is missing event sequence ${expected}.`,
      );
    }
    expected += 1;
  }
}

function eventsEqual(
  left: SessionEvent | undefined,
  right: SessionEvent | undefined,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

function divergenceError(sessionId: string, sequence: number): OrchaError {
  return new OrchaError(
    "storage_error",
    `Cloud session "${sessionId}" diverged at sequence ${sequence}; local events were preserved and remote events were not overwritten.`,
    { details: { sessionId, sequence, conflict: "immutable_prefix" } },
  );
}

async function assertSuccessfulResponse(response: Response): Promise<void> {
  if (response.ok) return;
  if (response.status === 409) throw new RemoteConflictError();
  if (
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    throw new RemoteUnavailableError(
      `Amarsia session storage is temporarily unavailable (HTTP ${response.status}).`,
    );
  }
  const serverMessage = await readSafeServerMessage(response);
  throw storageError(
    `Amarsia session storage request failed with HTTP ${response.status}${
      serverMessage ? `: ${serverMessage}` : "."
    }`,
    { status: response.status },
  );
}

async function readSafeServerMessage(
  response: Response,
): Promise<string | undefined> {
  try {
    const body = await response.json();
    const value =
      isRecord(body) && isRecord(body.error)
        ? body.error.message
        : isRecord(body)
          ? body.message
          : undefined;
    if (typeof value !== "string") return undefined;
    const sanitized = value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return sanitized ? sanitized.slice(0, 500) : undefined;
  } catch {
    return undefined;
  }
}

function storageError(
  message: string,
  details?: Record<string, unknown>,
  cause?: unknown,
): OrchaError {
  return new OrchaError("storage_error", message, {
    ...(details ? { details } : {}),
    ...(cause === undefined ? {} : { cause }),
  });
}

function incompleteFlushError(
  pendingCount: number,
  cause: Error | undefined,
): OrchaError {
  return storageError(
    `Cloud storage flush incomplete; ${pendingCount} session(s) remain pending.`,
    { pendingCount },
    cause,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
