import { randomUUID } from "node:crypto";
import { callAnthropic } from "../providers/anthropic.js";
import type {
  AgentInput,
  AgentRuntime,
  CompiledAgentManifest,
  Execution,
  ProjectConfiguration,
  RunResult,
  SessionStore,
} from "../types.js";
import { messagesFromEvents, SessionEventWriter } from "./session-events.js";

export class RuntimeAgent implements AgentRuntime {
  readonly #manifest: CompiledAgentManifest;
  readonly #configuration: ProjectConfiguration;
  readonly #store: SessionStore;
  readonly #activeSessions: Set<string>;

  constructor(options: {
    manifest: CompiledAgentManifest;
    configuration: ProjectConfiguration;
    store: SessionStore;
    activeSessions: Set<string>;
  }) {
    this.#manifest = options.manifest;
    this.#configuration = options.configuration;
    this.#store = options.store;
    this.#activeSessions = options.activeSessions;
  }

  run(input: AgentInput | string): Execution {
    const normalized = typeof input === "string" ? { input } : input;
    const sessionId = normalized.sessionId ?? `ses_${randomUUID()}`;

    return {
      result: this.#execute(sessionId, normalized.input),
    };
  }

  async #execute(sessionId: string, input: string): Promise<RunResult> {
    if (!input?.trim()) {
      return {
        sessionId,
        status: "failed",
        error: {
          code: "invalid_input",
          message: "Agent input cannot be empty.",
        },
      };
    }
    if (this.#activeSessions.has(sessionId)) {
      return {
        sessionId,
        status: "failed",
        error: {
          code: "session_busy",
          message: "This session already has an active execution.",
        },
      };
    }

    this.#activeSessions.add(sessionId);
    let writer: SessionEventWriter | undefined;
    const runStartedAt = performance.now();

    try {
      const previousEvents = await this.#store.read(sessionId);
      writer = new SessionEventWriter(sessionId, previousEvents);

      if (previousEvents.length === 0) {
        await this.#store.append(sessionId, [
          writer.create(
            "session.created",
            {
              schemaVersion: 1,
              sessionId,
              agent: this.#manifest.name,
              status: "active",
            },
            "session",
          ),
        ]);
      }

      await this.#store.append(sessionId, [
        writer.create("run.started", {
          status: "running",
          agent: this.#manifest.name,
          provider: this.#manifest.provider,
          model: this.#manifest.model,
          region: this.#manifest.region ?? "provider_managed",
          reasoningLevel: this.#manifest.reasoningLevel,
          outputType: this.#manifest.outputType,
        }),
        writer.create("message.created", {
          role: "user",
          content: input,
        }),
      ]);

      const messages = [
        ...messagesFromEvents(previousEvents),
        { role: "user" as const, content: input },
      ];
      const provider = this.#configuration.providers[this.#manifest.provider];
      if (!provider) {
        throw new Error(
          `Provider "${this.#manifest.provider}" is not configured in orcha.init().`,
        );
      }

      const modelStartedAt = performance.now();
      const response = await callAnthropic(this.#manifest, provider, messages);
      const modelDurationMs = Math.round(performance.now() - modelStartedAt);
      const runDurationMs = Math.round(performance.now() - runStartedAt);

      await this.#store.append(sessionId, [
        writer.create("message.created", {
          status: "completed",
          provider: this.#manifest.provider,
          model: this.#manifest.model,
          responseId: response.responseId,
          stopReason: response.stopReason,
          role: "assistant",
          content: response.content,
          ...(this.#manifest.outputType === "json"
            ? { parsedOutput: response.output }
            : {}),
          usage: response.usage,
          durationMs: modelDurationMs,
        }),
        writer.create("run.completed", {
          status: "completed",
          durationMs: runDurationMs,
          usage: response.usage,
        }),
      ]);

      return {
        sessionId,
        status: "completed",
        output: response.output,
        usage: response.usage,
      };
    } catch (error) {
      const existingEvents = await this.#store.read(sessionId);
      writer ??= new SessionEventWriter(sessionId, existingEvents);
      const message = error instanceof Error ? error.message : String(error);

      await this.#store.append(sessionId, [
        writer.create("run.failed", {
          status: "failed",
          durationMs: Math.round(performance.now() - runStartedAt),
          error: {
            code: "execution_failed",
            message,
          },
        }),
      ]);

      return {
        sessionId,
        status: "failed",
        error: {
          code: "execution_failed",
          message,
        },
      };
    } finally {
      this.#activeSessions.delete(sessionId);
    }
  }
}
