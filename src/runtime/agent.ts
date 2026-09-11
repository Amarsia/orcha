import { randomUUID } from "node:crypto";
import { OrchaError } from "../errors.js";
import { generateProviderResponse } from "../providers/index.js";
import type {
  ProviderMessage,
  ProviderResponse,
  ProviderToolCall,
  ProviderToolResult,
} from "../providers/types.js";
import type {
  AgentInput,
  AgentRuntime,
  ClientCapability,
  ClientToolCall,
  CompiledActionManifest,
  CompiledAgentManifest,
  Execution,
  MessageContent,
  OrchaErrorCode,
  PaginationOptions,
  ProjectConfiguration,
  ResumeInput,
  RunResult,
  SessionEvent,
  SessionHistory,
  SessionHistoryItem,
  SessionList,
  SessionListOptions,
  SessionMetadata,
  SessionSnapshot,
  SessionStore,
  SessionUpdate,
  ToolResult,
  ToolResumeInput,
  Usage,
} from "../types.js";
import {
  messagesFromEvents,
  normalizePersistedToolResults,
  SessionEventWriter,
} from "./session-events.js";
import { validateStructuredValue } from "./structured-output.js";
import { executeLocalAction } from "./actions/execute.js";
import {
  createExecution,
  type OutputSnapshotPublisher,
} from "./execution.js";

interface PendingClientActions {
  run: number;
  requestSequence: number;
  calls: ClientToolCall[];
  capabilities: string[];
  localResults: ProviderToolResult[];
  toolCallOrder: string[];
  resolvedResults?: ToolResult[];
}

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

  get clientTools(): CompiledActionManifest[] {
    return Object.values(this.#manifest.actions ?? {}).filter(
      (action) => action.execution === "client",
    );
  }

  run(input: AgentInput | string): Execution {
    const normalized = typeof input === "string" ? { content: input } : input;
    const sessionId = `ses_${randomUUID()}`;
    if (
      typeof normalized === "object" &&
      normalized !== null &&
      "sessionId" in normalized
    ) {
      return createExecution(sessionId, async () =>
        failure(
            sessionId,
            "invalid_input",
            "run() always creates a new session and does not accept sessionId.",
        ),
      );
    }

    return createExecution(sessionId, (publishOutput) =>
      this.#start(sessionId, normalized, true, publishOutput),
    );
  }

  resume(sessionId: string, input: ResumeInput): Execution {
    if (typeof input === "string") {
      return createExecution(sessionId, (publishOutput) =>
        this.#start(sessionId, { content: input }, false, publishOutput),
      );
    }
    if (!input || typeof input !== "object") {
      return createExecution(sessionId, async () =>
        failure(
            sessionId,
            "invalid_input",
            "resume() requires content or toolResults.",
        ),
      );
    }
    const hasMessage = "content" in input;
    const hasToolResults = "toolResults" in input;
    if (hasMessage === hasToolResults) {
      return createExecution(sessionId, async () =>
        failure(
            sessionId,
            "invalid_input",
            "resume() requires either content or toolResults, but not both.",
        ),
      );
    }

    return createExecution(sessionId, (publishOutput) =>
      hasMessage
        ? this.#start(sessionId, input, false, publishOutput)
        : this.#resumeToolResults(sessionId, input, publishOutput),
    );
  }

  async get(sessionId: string): Promise<SessionSnapshot> {
    const events = await this.#readSession(sessionId);
    this.#assertOwnedSession(sessionId, events);
    return projectSessionSnapshot(events);
  }

  async history(
    sessionId: string,
    options: PaginationOptions = {},
  ): Promise<SessionHistory> {
    const events = await this.#readSession(sessionId);
    this.#assertOwnedSession(sessionId, events);
    const { page, pageSize } = normalizePagination(options);
    const allItems = projectHistoryItems(events);
    const end = Math.max(0, allItems.length - (page - 1) * pageSize);
    const start = Math.max(0, end - pageSize);

    return {
      ...projectSessionSnapshot(events),
      items: allItems.slice(start, end),
      page,
      pageSize,
      total: allItems.length,
      hasMore: start > 0,
    };
  }

  async list(options: SessionListOptions = {}): Promise<SessionList> {
    const { page, pageSize } = normalizePagination(options);
    let sessionIds: string[];
    try {
      sessionIds = await this.#store.listSessionIds();
    } catch (error) {
      throw new OrchaError(
        "storage_error",
        error instanceof Error ? error.message : String(error),
        { retryable: true, cause: error },
      );
    }
    const snapshots = (
      await Promise.all(
        sessionIds.map(async (sessionId) => {
          const events = await this.#readSession(sessionId);
          const agent = events.find(
            (event) => event.type === "session.created",
          )?.data.agent;
          return agent === this.#manifest.name
            ? projectSessionSnapshot(events)
            : undefined;
        }),
      )
    )
      .filter((item): item is SessionSnapshot => item !== undefined)
      .filter((item) => !options.status || item.status === options.status)
      .filter((item) => metadataMatches(item.metadata, options.metadata))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const start = (page - 1) * pageSize;

    return {
      items: snapshots.slice(start, start + pageSize),
      page,
      pageSize,
      total: snapshots.length,
      hasMore: start + pageSize < snapshots.length,
    };
  }

  async update(
    sessionId: string,
    update: SessionUpdate,
  ): Promise<SessionSnapshot> {
    return this.#withSessionMutationLock(sessionId, async () => {
      const events = await this.#readSession(sessionId);
      this.#assertOwnedSession(sessionId, events);
      if (
        update.name === undefined &&
        update.metadata === undefined
      ) {
        throw new OrchaError(
          "invalid_input",
          "update() requires name or metadata.",
        );
      }
      const writer = new SessionEventWriter(sessionId, events);
      const event = writer.create(
        "session.updated",
        {
          ...(update.name !== undefined
            ? { name: normalizeName(update.name) }
            : {}),
          ...(update.metadata !== undefined
            ? { metadata: normalizeMetadata(update.metadata) }
            : {}),
        },
        "session",
      );
      await this.#store.append(sessionId, [event]);
      return projectSessionSnapshot([...events, event]);
    });
  }

  #assertOwnedSession(
    sessionId: string,
    events: SessionEvent[],
  ): void {
    const agent = events.find(
      (event) => event.type === "session.created",
    )?.data.agent;
    if (agent !== this.#manifest.name) {
      throw new OrchaError(
        "session_not_found",
        `Session "${sessionId}" was not found for agent "${this.#manifest.name}".`,
      );
    }
  }

  async #readSession(sessionId: string): Promise<SessionEvent[]> {
    try {
      return await this.#store.read(sessionId);
    } catch (error) {
      throw new OrchaError(
        "storage_error",
        error instanceof Error ? error.message : String(error),
        { retryable: true, cause: error },
      );
    }
  }

  async #start(
    sessionId: string,
    input: AgentInput,
    createSession = true,
    publishOutput?: OutputSnapshotPublisher<unknown>,
  ): Promise<RunResult> {
    const content = normalizeContent(input.content);
    if (!content) {
      return failure(
        sessionId,
        "invalid_input",
        "Agent content must contain at least one valid item.",
      );
    }
    let initialName: string | undefined;
    let initialMetadata: SessionMetadata = {};
    let initialVariables: Record<string, string> = {};
    if (createSession) {
      try {
        initialName = normalizeName(input.name);
        initialMetadata = normalizeMetadata(input.metadata);
        initialVariables = normalizeVariables(input.variables);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failure(sessionId, "invalid_input", message);
      }
    }

    const capabilities = normalizeClientCapabilities(
      input.clientCapabilities ?? [],
    );
    if (!capabilities) {
      return failure(
        sessionId,
        "invalid_input",
        "clientCapabilities must contain tool names or client tool definitions.",
      );
    }
    const unknownCapabilities = capabilities.filter(
      (name) => !(this.#manifest.actions ?? {})[name],
    );
    if (unknownCapabilities.length > 0) {
      return failure(
        sessionId,
        "invalid_input",
        `Unknown client capabilities: ${unknownCapabilities.join(", ")}.`,
      );
    }

    return this.#withSessionExecutionLock(sessionId, async () => {
      const previousEvents = await this.#readSession(sessionId);
      if (!createSession && previousEvents.length === 0) {
        return failure(
          sessionId,
          "session_not_found",
          `Session "${sessionId}" does not exist.`,
        );
      }
      if (getPendingClientActions(previousEvents)) {
        return failure(
          sessionId,
          "client_action_required",
          "This session is waiting for client tool results. Resume with toolResults.",
        );
      }

      const writer = new SessionEventWriter(sessionId, previousEvents);
      const variables = createSession
        ? initialVariables
        : sessionVariables(previousEvents);
      let sessionEvents = previousEvents;
      if (previousEvents.length === 0) {
        const created = writer.create(
          "session.created",
          {
            schemaVersion: 1,
            sessionId,
            agent: this.#manifest.name,
            status: "active",
            name: initialName,
            metadata: initialMetadata,
            variables,
          },
          "session",
        );
        await this.#store.append(sessionId, [created]);
        sessionEvents = [created];
      } else {
        const sessionAgent = previousEvents.find(
          (event) => event.type === "session.created",
        )?.data.agent;
        if (sessionAgent !== this.#manifest.name) {
          return failure(
            sessionId,
            "session_not_found",
            `Session "${sessionId}" was not created by this agent.`,
          );
        }
      }

      const runEvents = [
        writer.create("run.started", {
          status: "running",
          agent: this.#manifest.name,
          provider: this.#manifest.provider,
          model: this.#manifest.model,
          region: this.#manifest.region ?? "provider_managed",
          reasoningLevel: this.#manifest.reasoningLevel,
          outputType: this.#manifest.outputType,
          clientCapabilities: capabilities,
        }),
        writer.create("message.created", {
          role: "user",
          content,
        }),
      ];
      await this.#store.append(sessionId, runEvents);

      const messages: ProviderMessage[] = [
        ...messagesFromEvents(previousEvents),
        { role: "user", content },
      ];
      return this.#continue(
        sessionId,
        writer,
        messages,
        capabilities,
        [...sessionEvents, ...runEvents],
        variables,
        0,
        publishOutput,
      );
    });
  }

  async #resumeToolResults(
    sessionId: string,
    input: ToolResumeInput,
    publishOutput?: OutputSnapshotPublisher<unknown>,
  ): Promise<RunResult> {
    if (!Array.isArray(input?.toolResults) || input.toolResults.length === 0) {
      return failure(
        sessionId,
        "missing_tool_results",
        "resume() requires at least one tool result.",
      );
    }

    return this.#withSessionExecutionLock(sessionId, async () => {
      const events = await this.#readSession(sessionId);
      if (events.length === 0) {
        return failure(
          sessionId,
          "session_not_found",
          `Session "${sessionId}" does not exist.`,
        );
      }
      const pending = getPendingClientActions(events);
      if (!pending) {
        const previousResult = getCompletedDuplicateResult(
          sessionId,
          events,
          input.toolResults,
        );
        if (previousResult) {
          return previousResult;
        }
        return failure(
          sessionId,
          "unknown_call_id",
          "This session is not waiting for a client action.",
        );
      }

      const validationError = this.#validateToolResults(
        pending.calls,
        input.toolResults,
      );
      if (validationError) {
        return failure(sessionId, "invalid_tool_result", validationError);
      }
      const normalizedResults = orderToolResults(
        pending.calls,
        input.toolResults,
      );
      if (
        pending.resolvedResults &&
        stableStringify(pending.resolvedResults) !==
          stableStringify(normalizedResults)
      ) {
        return failure(
          sessionId,
          "action_result_conflict",
          "These client action calls were already resolved with different results.",
        );
      }

      const writer = new SessionEventWriter(sessionId, events, pending.run);
      let updatedEvents = events;
      const continuationEvents: SessionEvent[] = [];
      if (!pending.resolvedResults) {
        const resolved = writer.create("client_action.resolved", {
          status: "completed",
          results: normalizedResults,
        });
        continuationEvents.push(resolved);
      }
      const existingToolMessage = events.find(
        (event) =>
          event.run === pending.run &&
          event.type === "message.created" &&
          event.data.role === "tool" &&
          event.sequence > pending.requestSequence,
      );
      if (!existingToolMessage) {
        continuationEvents.push(
          writer.create("message.created", {
            role: "tool",
            content: [
              ...orderProviderToolResults(
                pending.toolCallOrder,
                [
                  ...pending.localResults,
                  ...normalizedResults.map(toProviderToolResult),
                ],
              ),
            ],
          }),
        );
      }
      if (continuationEvents.length > 0) {
        await this.#store.append(sessionId, continuationEvents);
        updatedEvents = [...events, ...continuationEvents];
      }

      return this.#continue(
        sessionId,
        writer,
        messagesFromEvents(updatedEvents, pending.run),
        pending.capabilities,
        updatedEvents,
        sessionVariables(events),
        0,
        publishOutput,
      );
    });
  }

  async #continue(
    sessionId: string,
    writer: SessionEventWriter,
    messages: ProviderMessage[],
    capabilities: string[],
    previousEvents: SessionEvent[],
    variables: Record<string, string>,
    toolRound = 0,
    publishOutput?: OutputSnapshotPublisher<unknown>,
  ): Promise<RunResult> {
    try {
      if (toolRound > 10) {
        throw new Error("Agent exceeded the maximum of 10 action rounds.");
      }
      const provider = this.#configuration.providers[this.#manifest.provider];
      if (!provider) {
        throw new Error(
          `Provider "${this.#manifest.provider}" is not configured in orcha.init().`,
        );
      }

      const modelStartedAt = performance.now();
      let response: ProviderResponse;
      const localActionNames = Object.values(
        this.#manifest.actions ?? {},
      )
        .filter((action) => action.execution === "local")
        .map((action) => action.name);
      const availableToolNames = [
        ...new Set([...localActionNames, ...capabilities]),
      ];
      try {
        response = await generateProviderResponse(
          this.#manifest.provider,
          provider,
          {
            model: this.#manifest.model,
            region: this.#manifest.region,
            maxTokens: this.#manifest.maxTokens,
            reasoningLevel: this.#manifest.reasoningLevel,
            outputType: this.#manifest.outputType,
            outputSchema: this.#manifest.outputSchema,
            systemPrompt: renderPrompt(
              this.#manifest.systemPrompt,
              variables,
            ),
            messages,
            tools: availableToolNames.map((name) => {
              const action = this.#manifest.actions[name];
              return {
                name: action.name,
                description: action.description,
                parameters: action.parameters,
              };
            }),
            publishOutput,
          },
        );
      } catch (error) {
        if (error instanceof OrchaError) {
          throw error;
        }
        throw new OrchaError(
          "provider_error",
          error instanceof Error ? error.message : String(error),
          { retryable: true, cause: error },
        );
      }
      const modelDurationMs = Math.round(performance.now() - modelStartedAt);
      const usage = aggregateUsage(previousEvents, writer.run, response.usage);
      const assistantEvent = writer.create("message.created", {
        status:
          response.stopReason === "max_tokens"
            ? "incomplete"
            : "completed",
        provider: this.#manifest.provider,
        model: this.#manifest.model,
        responseId: response.responseId,
        stopReason: response.stopReason,
        role: "assistant",
        content: response.content,
        ...(this.#manifest.outputType === "json" &&
        response.toolCalls.length === 0
          ? { parsedOutput: response.output }
          : {}),
        usage: response.usage,
        durationMs: modelDurationMs,
      });

      if (response.stopReason === "max_tokens") {
        const message =
          "The model reached its output-token limit before completing the response.";
        await this.#store.append(sessionId, [
          assistantEvent,
          writer.create("run.failed", {
            status: "failed",
            durationMs: elapsedRunDuration(previousEvents, writer.run),
            usage,
            error: {
              code: "provider_error",
              message,
              retryable: true,
            },
          }),
        ]);
        return failure(sessionId, "provider_error", message);
      }

      if (response.toolCalls.length > 0) {
        this.#assertValidToolCalls(response, capabilities);
        await this.#store.append(sessionId, [assistantEvent]);
        const eventsAfterAssistant = [...previousEvents, assistantEvent];
        const localCalls = response.toolCalls.filter(
          (call) =>
            this.#manifest.actions[call.name]?.execution === "local",
        ).map(toClientToolCall);
        const clientCalls = response.toolCalls.filter(
          (call) =>
            this.#manifest.actions[call.name]?.execution === "client",
        ).map(toClientToolCall);
        const localExecution = await this.#executeLocalToolCalls(
          sessionId,
          writer,
          localCalls,
          eventsAfterAssistant,
        );

        if (clientCalls.length > 0) {
          const pauseEvents = [
            writer.create("client_action.requested", {
              status: "waiting",
              calls: clientCalls,
              localResults: localExecution.results,
              toolCallOrder: response.toolCalls.map((call) => call.callId),
            }),
            writer.create("run.paused", {
              status: "waiting_for_client_action",
              clientToolCalls: clientCalls,
              usage,
            }),
          ];
          await this.#store.append(sessionId, pauseEvents);
          return {
            sessionId,
            status: "waiting_for_client_action",
            output: response.output,
            clientToolCalls: clientCalls,
            usage,
          };
        }

        const toolMessage = writer.create("message.created", {
          role: "tool",
          content: localExecution.results,
        });
        await this.#store.append(sessionId, [toolMessage]);
        const nextEvents = [
          ...eventsAfterAssistant,
          ...localExecution.events,
          toolMessage,
        ];
        return this.#continue(
          sessionId,
          writer,
          [
            ...messages,
            { role: "assistant", content: response.content },
            { role: "tool", results: localExecution.results },
          ],
          capabilities,
          nextEvents,
          variables,
          toolRound + 1,
          publishOutput,
        );
      }

      await this.#store.append(sessionId, [
        assistantEvent,
        writer.create("run.completed", {
          status: "completed",
          durationMs: elapsedRunDuration(previousEvents, writer.run),
          usage,
        }),
      ]);
      return {
        sessionId,
        status: "completed",
        output: response.output,
        usage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        error instanceof OrchaError ? error.code : "execution_failed";
      await this.#store.append(sessionId, [
        writer.create("run.failed", {
          status: "failed",
          durationMs: elapsedRunDuration(previousEvents, writer.run),
          error: {
            code,
            message,
          },
        }),
      ]);
      return failure(sessionId, code, message);
    }
  }

  async #executeLocalToolCalls(
    sessionId: string,
    writer: SessionEventWriter,
    calls: ClientToolCall[],
    previousEvents: SessionEvent[],
  ): Promise<{
    events: SessionEvent[];
    results: ProviderToolResult[];
  }> {
    const configuration = this.#configuration.actions;
    if (calls.length === 0) {
      return { events: [], results: [] };
    }
    if (!configuration) {
      throw new Error("Local action runtime is not configured.");
    }
    const metadata = projectSessionSnapshot(previousEvents).metadata;
    const events: SessionEvent[] = [];
    const results: ProviderToolResult[] = [];

    for (const call of calls) {
      const action = this.#manifest.actions[call.name];
      if (!action || action.execution !== "local") {
        throw new Error(`Unknown local action "${call.name}".`);
      }
      const existing = findLast(
        previousEvents,
        (event) =>
          event.type === "action.completed" &&
          event.data.callId === call.callId,
      );
      if (existing) {
        if (existing.data.sourceHash !== action.sourceHash) {
          throw new Error(
            `Action "${action.name}" changed after call "${call.callId}" completed.`,
          );
        }
        results.push({
          callId: call.callId,
          output: existing.data.output ?? null,
        });
        continue;
      }

      const idempotencyKey = `${sessionId}:${call.callId}`;
      const requested = writer.create("action.requested", {
        callId: call.callId,
        name: action.name,
        arguments: call.arguments,
        sourceHash: action.sourceHash,
        idempotencyKey,
      });
      await this.#store.append(sessionId, [requested]);
      events.push(requested);
      const startedAt = performance.now();

      try {
        validateStructuredValue(call.arguments, action.parameters);
        const rawOutput = await executeLocalAction({
          action,
          parameters: call.arguments,
          configuration,
          sessionId,
          metadata,
          idempotencyKey,
        });
        const output = ensureJsonSerializable(rawOutput);
        if (action.outputSchema) {
          validateStructuredValue(output, action.outputSchema);
        }
        const completed = writer.create("action.completed", {
          callId: call.callId,
          name: action.name,
          output,
          sourceHash: action.sourceHash,
          durationMs: Math.round(performance.now() - startedAt),
        });
        await this.#store.append(sessionId, [completed]);
        events.push(completed);
        results.push({
          callId: call.callId,
          output: output ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed = writer.create("action.failed", {
          callId: call.callId,
          name: action.name,
          sourceHash: action.sourceHash,
          durationMs: Math.round(performance.now() - startedAt),
          error: {
            code: "action_execution_failed",
            message,
          },
        });
        await this.#store.append(sessionId, [failed]);
        events.push(failed);
        results.push({
          callId: call.callId,
          output: { error: message },
          isError: true,
        });
      }
    }

    return { events, results };
  }

  #assertValidToolCalls(
    response: ProviderResponse,
    capabilities: string[],
  ): void {
    for (const call of response.toolCalls) {
      const action = (this.#manifest.actions ?? {})[call.name];
      if (
        !action ||
        (action.execution === "client" && !capabilities.includes(call.name))
      ) {
        throw new Error(
          `Model requested unavailable action "${call.name}".`,
        );
      }
    }
  }

  #validateToolResults(
    calls: ClientToolCall[],
    results: ToolResult[],
  ): string | undefined {
    const expectedIds = new Set(calls.map((call) => call.callId));
    const receivedIds = new Set(results.map((result) => result.callId));
    if (
      results.length !== receivedIds.size ||
      results.length !== calls.length ||
      [...expectedIds].some((callId) => !receivedIds.has(callId))
    ) {
      return "toolResults must resolve every pending callId exactly once.";
    }

    for (const result of results) {
      const call = calls.find((candidate) => candidate.callId === result.callId);
      const schema = call
        ? (this.#manifest.actions ?? {})[call.name]?.outputSchema
        : undefined;
      if (schema) {
        try {
          validateStructuredValue(result.output, schema);
        } catch (error) {
          return `Result for "${call?.name}" is invalid: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      }
    }
    return undefined;
  }

  async #withSessionExecutionLock(
    sessionId: string,
    operation: () => Promise<RunResult>,
  ): Promise<RunResult> {
    if (this.#activeSessions.has(sessionId)) {
      return failure(
        sessionId,
        "session_busy",
        "This session already has an active execution.",
      );
    }

    this.#activeSessions.add(sessionId);
    try {
      return await operation();
    } catch (error) {
      const normalized =
        error instanceof OrchaError
          ? error
          : new OrchaError(
              "storage_error",
              error instanceof Error ? error.message : String(error),
              { retryable: true, cause: error },
            );
      return failure(sessionId, normalized.code, normalized.message);
    } finally {
      this.#activeSessions.delete(sessionId);
    }
  }

  async #withSessionMutationLock<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.#activeSessions.has(sessionId)) {
      throw new OrchaError(
        "session_busy",
        "This session already has an active execution.",
        { retryable: true },
      );
    }

    this.#activeSessions.add(sessionId);
    try {
      return await operation();
    } catch (error) {
      if (error instanceof OrchaError) {
        throw error;
      }
      throw new OrchaError(
        "storage_error",
        error instanceof Error ? error.message : String(error),
        { retryable: true, cause: error },
      );
    } finally {
      this.#activeSessions.delete(sessionId);
    }
  }
}

function getPendingClientActions(
  events: SessionEvent[],
): PendingClientActions | undefined {
  const paused = findLast(
    events,
    (event) => event.type === "run.paused" && typeof event.run === "number",
  );
  if (!paused?.run) {
    return undefined;
  }
  const terminal = events.find(
    (event) =>
      event.run === paused.run &&
      event.sequence > paused.sequence &&
      (event.type === "run.completed" || event.type === "run.failed"),
  );
  if (terminal) {
    return undefined;
  }

  const requested = findLast(
    events,
    (event) =>
      event.run === paused.run &&
      event.type === "client_action.requested" &&
      event.sequence <= paused.sequence,
  );
  const calls = parseClientToolCalls(requested?.data.calls);
  if (!requested || !calls) {
    return undefined;
  }
  const runStarted = events.find(
    (event) =>
      event.run === paused.run && event.type === "run.started",
  );
  const resolved = events.find(
    (event) =>
      event.run === paused.run &&
      event.type === "client_action.resolved" &&
      event.sequence > requested.sequence,
  );

  return {
    run: paused.run,
    requestSequence: requested.sequence,
    calls,
    capabilities: Array.isArray(runStarted?.data.clientCapabilities)
      ? runStarted.data.clientCapabilities.filter(
          (name): name is string => typeof name === "string",
        )
      : [],
    localResults: Array.isArray(requested.data.localResults)
      ? normalizePersistedToolResults(requested.data.localResults) ?? []
      : [],
    toolCallOrder: Array.isArray(requested.data.toolCallOrder)
      ? requested.data.toolCallOrder.filter(
          (callId): callId is string => typeof callId === "string",
        )
      : calls.map((call) => call.callId),
    resolvedResults: parseToolResults(resolved?.data.results),
  };
}

function parseClientToolCalls(value: unknown): ClientToolCall[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const calls: ClientToolCall[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.callId !== "string" ||
      typeof item.name !== "string" ||
      !isRecord(item.arguments)
    ) {
      return undefined;
    }
    calls.push({
      callId: item.callId,
      name: item.name,
      arguments: item.arguments,
    });
  }
  return calls;
}

function parseToolResults(value: unknown): ToolResult[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const results: ToolResult[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.callId !== "string" ||
      !("output" in item)
    ) {
      return undefined;
    }
    results.push({
      callId: item.callId,
      output: item.output,
    });
  }
  return results;
}

function toProviderToolResult(result: ToolResult): ProviderToolResult {
  return {
    callId: result.callId,
    output: result.output ?? null,
  };
}

function toClientToolCall(
  call: Pick<ProviderToolCall, "callId" | "name" | "arguments">,
): ClientToolCall {
  return {
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
  };
}

function orderProviderToolResults(
  callOrder: string[],
  results: ProviderToolResult[],
): ProviderToolResult[] {
  const byCallId = new Map(
    results.map((result) => [result.callId, result]),
  );
  return callOrder.flatMap((callId) => {
    const result = byCallId.get(callId);
    return result ? [result] : [];
  });
}

function ensureJsonSerializable(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Action output must be JSON serializable.");
  }
  return JSON.parse(serialized);
}

function orderToolResults(
  calls: ClientToolCall[],
  results: ToolResult[],
): ToolResult[] {
  const byCallId = new Map(
    results.map((result) => [result.callId, result]),
  );
  return calls.map((call) => {
    const result = byCallId.get(call.callId);
    if (!result) {
      throw new OrchaError(
        "missing_tool_results",
        `Missing result for client action call "${call.callId}".`,
      );
    }
    return result;
  });
}

function aggregateUsage(
  events: SessionEvent[],
  run: number,
  current: Usage,
): Usage {
  const usages = events.flatMap((event) =>
    event.run === run &&
    event.type === "message.created" &&
    event.data.role === "assistant" &&
    isUsage(event.data.usage)
      ? [event.data.usage]
      : [],
  );
  return [...usages, current].reduce<Usage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      reasoningTokens:
        total.reasoningTokens === null && usage.reasoningTokens === null
          ? null
          : (total.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
      cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: null,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  );
}

function getCompletedDuplicateResult(
  sessionId: string,
  events: SessionEvent[],
  submittedResults: ToolResult[],
): RunResult | undefined {
  const resolved = findLast(
    events,
    (event) =>
      event.type === "client_action.resolved" &&
      Array.isArray(event.data.results),
  );
  const previousResults = parseToolResults(resolved?.data.results);
  if (!resolved?.run || !previousResults) {
    return undefined;
  }

  const expected = [...previousResults].sort((left, right) =>
    left.callId.localeCompare(right.callId),
  );
  const submitted = [...submittedResults].sort((left, right) =>
    left.callId.localeCompare(right.callId),
  );
  if (stableStringify(expected) !== stableStringify(submitted)) {
    return failure(
      sessionId,
      "action_result_conflict",
      "These client action calls were already resolved with different results.",
    );
  }

  const completed = events.find(
    (event) =>
      event.run === resolved.run &&
      event.type === "run.completed" &&
      event.sequence > resolved.sequence,
  );
  if (!completed) {
    return undefined;
  }
  const assistant = findLast(
    events,
    (event) =>
      event.run === resolved.run &&
      event.type === "message.created" &&
      event.data.role === "assistant" &&
      event.sequence < completed.sequence,
  );
  const textOutput = Array.isArray(assistant?.data.content)
    ? assistant.data.content
        .flatMap((block) =>
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "text" &&
          "text" in block &&
          typeof block.text === "string"
            ? [block.text]
            : [],
        )
        .join("")
    : undefined;

  return {
    sessionId,
    status: "completed",
    output: assistant?.data.parsedOutput ?? textOutput,
    usage: isUsage(completed.data.usage) ? completed.data.usage : undefined,
  };
}

function elapsedRunDuration(events: SessionEvent[], run: number): number {
  const started = events.find(
    (event) => event.run === run && event.type === "run.started",
  );
  const startedAt = started ? Date.parse(started.timestamp) : Date.now();
  return Math.max(0, Date.now() - startedAt);
}

function isUsage(value: unknown): value is Usage {
  return (
    typeof value === "object" &&
    value !== null &&
    "inputTokens" in value &&
    "outputTokens" in value &&
    "reasoningTokens" in value &&
    "cacheReadTokens" in value &&
    "cacheWriteTokens" in value
  );
}

function normalizeContent(
  content: string | MessageContent[],
): MessageContent[] | undefined {
  if (typeof content === "string") {
    return content.trim()
      ? [{ type: "text", text: content }]
      : undefined;
  }
  if (!Array.isArray(content) || content.length === 0) {
    return undefined;
  }
  const normalized: MessageContent[] = [];
  for (const item of content) {
    if (
      item?.type === "text" &&
      typeof item.text === "string" &&
      item.text.trim()
    ) {
      normalized.push({ type: "text", text: item.text });
      continue;
    }
    if (
      item &&
      ["image", "video", "audio", "url"].includes(item.type) &&
      "mimeType" in item &&
      "fileUri" in item &&
      typeof item.mimeType === "string" &&
      item.mimeType.trim() &&
      typeof item.fileUri === "string" &&
      item.fileUri.trim()
    ) {
      normalized.push(item);
      continue;
    }
    return undefined;
  }
  return normalized;
}

function normalizeClientCapabilities(
  capabilities: ClientCapability[],
): string[] | undefined {
  const names: string[] = [];
  for (const capability of capabilities) {
    let name: string | undefined;
    if (typeof capability === "string") {
      name = capability;
    } else if (capability && typeof capability.name === "string") {
      name = capability.name;
    }
    if (!name?.trim()) {
      return undefined;
    }
    names.push(name);
  }
  return [...new Set(names)];
}

function normalizeName(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const name = value.trim();
  if (!name || name.length > 200) {
    throw new OrchaError(
      "invalid_input",
      "Session name must contain 1 to 200 characters.",
    );
  }
  return name;
}

function normalizeMetadata(
  metadata: unknown,
): SessionMetadata {
  if (metadata === undefined) {
    return {};
  }
  if (!isRecord(metadata) || Object.keys(metadata).length > 50) {
    throw new OrchaError(
      "invalid_input",
      "Session metadata must contain at most 50 fields.",
    );
  }
  const normalized: SessionMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (
      !key.trim() ||
      !(
        value === null ||
        typeof value === "string" ||
        (typeof value === "number" && Number.isFinite(value)) ||
        typeof value === "boolean"
      )
    ) {
      throw new OrchaError(
        "invalid_input",
        "Session metadata values must be strings, numbers, booleans, or null.",
      );
    }
    normalized[key] = value;
  }
  return normalized;
}

function normalizeVariables(
  variables: Record<string, string> | undefined,
): Record<string, string> {
  if (variables === undefined) {
    return {};
  }
  if (!isRecord(variables) || Object.keys(variables).length > 50) {
    throw new OrchaError(
      "invalid_input",
      "Prompt variables must contain at most 50 string values.",
    );
  }
  for (const [name, value] of Object.entries(variables)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      typeof value !== "string"
    ) {
      throw new OrchaError(
        "invalid_input",
        "Prompt variable names must be identifiers and values must be strings.",
      );
    }
  }
  return { ...variables };
}

function sessionVariables(events: SessionEvent[]): Record<string, string> {
  const variables = events.find(
    (event) => event.type === "session.created",
  )?.data.variables;
  if (!isRecord(variables)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(variables).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function renderPrompt(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_match, name: string) => {
      if (!(name in variables)) {
        throw new OrchaError(
          "invalid_input",
          `Missing instruction variable "${name}".`,
        );
      }
      return variables[name];
    },
  );
}

function projectSessionSnapshot(events: SessionEvent[]): SessionSnapshot {
  const created = events.find(
    (event) => event.type === "session.created",
  );
  if (!created || typeof created.data.sessionId !== "string") {
    throw new OrchaError("storage_error", "Session log is missing session.created.");
  }
  const updates = events.filter((event) => event.type === "session.updated");
  let name =
    typeof created.data.name === "string" ? created.data.name : undefined;
  let metadata = isRecord(created.data.metadata)
    ? normalizeMetadata(created.data.metadata)
    : {};
  let status: SessionSnapshot["status"] =
    created.data.status === "completed" ? "completed" : "active";
  for (const update of updates) {
    if (typeof update.data.name === "string") {
      name = update.data.name;
    }
    if (isRecord(update.data.metadata)) {
      metadata = {
        ...metadata,
        ...normalizeMetadata(update.data.metadata),
      };
    }
    if (update.data.status === "completed") {
      status = "completed";
    }
  }

  const latestRunEvent = findLast(
    events,
    (event) =>
      event.type === "run.started" ||
      event.type === "run.paused" ||
      event.type === "run.completed" ||
      event.type === "run.failed",
  );
  const runStatus =
    latestRunEvent?.type === "run.started"
      ? "running"
      : latestRunEvent?.type === "run.paused"
        ? "waiting_for_client_action"
        : latestRunEvent?.type === "run.completed"
          ? "completed"
          : latestRunEvent?.type === "run.failed"
            ? "failed"
            : undefined;
  const pending = getPendingClientActions(events);
  const lastAssistant = findLast(
    events,
    (event) =>
      event.type === "message.created" &&
      event.data.role === "assistant",
  );
  const latestUsageEvent = findLast(
    events,
    (event) =>
      (event.type === "run.completed" || event.type === "run.paused") &&
      isUsage(event.data.usage),
  );

  return {
    sessionId: created.data.sessionId,
    name,
    status,
    metadata,
    createdAt: created.timestamp,
    updatedAt: events.at(-1)?.timestamp ?? created.timestamp,
    runStatus,
    pendingClientActions: pending?.calls ?? [],
    lastOutput: publicAssistantOutput(lastAssistant),
    usage: latestUsageEvent && isUsage(latestUsageEvent.data.usage)
      ? latestUsageEvent.data.usage
      : undefined,
  };
}

function projectHistoryItems(events: SessionEvent[]): SessionHistoryItem[] {
  const resolvedCalls = new Map<string, string>();
  for (const event of events) {
    if (
      event.type !== "client_action.resolved" ||
      !Array.isArray(event.data.results)
    ) {
      continue;
    }
    for (const result of event.data.results) {
      if (isRecord(result) && typeof result.callId === "string") {
        resolvedCalls.set(result.callId, event.timestamp);
      }
    }
  }
  const items: SessionHistoryItem[] = [];

  for (const event of events) {
    if (
      event.type === "message.created" &&
      (event.data.role === "user" || event.data.role === "assistant")
    ) {
      const content =
        event.data.role === "assistant"
          ? publicAssistantContent(event.data.content)
          : publicUserContent(event.data.content);
      if (content.length > 0) {
        items.push({
          id: `message:${event.sequence}`,
          type: "message",
          role: event.data.role,
          content,
          createdAt: event.timestamp,
          usage: isUsage(event.data.usage) ? event.data.usage : undefined,
        });
      }
      continue;
    }

    if (
      event.type === "client_action.requested" &&
      Array.isArray(event.data.calls)
    ) {
      for (const call of event.data.calls) {
        if (
          !isRecord(call) ||
          typeof call.callId !== "string" ||
          typeof call.name !== "string"
        ) {
          continue;
        }
        const resolvedAt = resolvedCalls.get(call.callId);
        const completed = resolvedAt !== undefined;
        items.push({
          id: `client-action:${call.callId}`,
          type: "client_action",
          callId: call.callId,
          name: call.name,
          status: completed ? "completed" : "waiting",
          summary: completed
            ? `${call.name.replaceAll("_", " ")} completed.`
            : `${call.name.replaceAll("_", " ")} is waiting for the client.`,
          ...(completed || !isRecord(call.arguments)
            ? {}
            : { arguments: call.arguments }),
          createdAt: resolvedAt ?? event.timestamp,
        });
      }
      continue;
    }

    if (
      (event.type === "action.completed" ||
        event.type === "action.failed") &&
      typeof event.data.name === "string"
    ) {
      const completed = event.type === "action.completed";
      items.push({
        id: `action:${event.data.callId ?? event.sequence}`,
        type: "action",
        name: event.data.name,
        status: completed ? "completed" : "failed",
        summary: completed
          ? `${event.data.name.replaceAll("_", " ")} completed.`
          : `${event.data.name.replaceAll("_", " ")} failed.`,
        createdAt: event.timestamp,
        durationMs:
          typeof event.data.durationMs === "number"
            ? event.data.durationMs
            : undefined,
      });
    }
  }

  return items;
}

function publicUserContent(value: unknown): MessageContent[] {
  return Array.isArray(value)
    ? value.filter(isMessageContent)
    : typeof value === "string"
      ? [{ type: "text", text: value }]
      : [];
}

function publicAssistantContent(value: unknown): MessageContent[] {
  if (!Array.isArray(value)) {
    return typeof value === "string"
      ? [{ type: "text", text: value }]
      : [];
  }
  const content: MessageContent[] = [];
  for (const block of value) {
    if (
      isRecord(block) &&
      block.type === "text" &&
      typeof block.text === "string"
    ) {
      content.push({ type: "text", text: block.text });
    }
  }
  return content;
}

function publicAssistantOutput(
  event: SessionEvent | undefined,
): unknown {
  if (!event) {
    return undefined;
  }
  if (event.data.parsedOutput !== undefined) {
    return event.data.parsedOutput;
  }
  const content = publicAssistantContent(event.data.content);
  return content.map((item) => item.type === "text" ? item.text : "").join("");
}

function isMessageContent(value: unknown): value is MessageContent {
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }
  if (value.type === "text") {
    return typeof value.text === "string";
  }
  return (
    ["image", "video", "audio", "url"].includes(value.type) &&
    typeof value.mimeType === "string" &&
    typeof value.fileUri === "string"
  );
}

function normalizePagination(options: PaginationOptions): {
  page: number;
  pageSize: number;
} {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 50;
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new OrchaError(
      "invalid_input",
      "Pagination requires page >= 1 and pageSize between 1 and 100.",
    );
  }
  return { page, pageSize };
}

function metadataMatches(
  metadata: SessionMetadata,
  expected: SessionMetadata | undefined,
): boolean {
  return (
    !expected ||
    Object.entries(expected).every(
      ([key, value]) => metadata[key] === value,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function findLast(
  events: SessionEvent[],
  predicate: (event: SessionEvent) => boolean,
): SessionEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) {
      return events[index];
    }
  }
  return undefined;
}

function failure(
  sessionId: string,
  code: OrchaErrorCode,
  message: string,
): RunResult {
  const retryable =
    code === "session_busy" ||
    code === "provider_error" ||
    code === "storage_error";
  return {
    sessionId,
    status: "failed",
    error: { code, message, retryable },
  };
}
