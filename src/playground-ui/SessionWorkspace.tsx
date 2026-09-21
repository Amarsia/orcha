import { Button, KIND, SIZE } from "baseui/button";
import { Modal, ModalBody } from "baseui/modal";
import { Spinner } from "baseui/spinner";
import { Textarea } from "baseui/textarea";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import type {
  ClientToolCall,
  SessionEvent,
  TranscriptTab,
} from "./types";
import {
  CodeBlock,
  Disclosure,
  DisclosureButton,
  DisclosureChevron,
  DisclosureDetails,
  EmptyState,
  Message,
  MarkdownHeading,
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownList,
  MarkdownListItem,
  MarkdownOrderedList,
  MarkdownParagraph,
  MarkdownQuote,
  MarkdownRoot,
  MetaRow,
  Muted,
  RoleLabel,
  Transcript,
  WorkspaceTab,
  WorkspaceTabs,
} from "./ui";

interface Props {
  tabs: TranscriptTab[];
  activeTabId?: string;
  events: Record<string, SessionEvent[]>;
  streamingOutput: Record<string, string>;
  busy: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onClose: () => void;
  onOpenSubagent: (
    parentAgent: string,
    childSessionId: string,
    childAgent: string,
  ) => void;
  onSend: (tab: TranscriptTab, content: unknown) => Promise<void>;
  onResolve: (
    tab: TranscriptTab,
    results: Array<{ callId: string; output: unknown }>,
  ) => Promise<void>;
}

export function SessionWorkspace({
  tabs,
  activeTabId,
  events,
  streamingOutput,
  busy,
  onSelectTab,
  onCloseTab,
  onClose,
  onOpenSubagent,
  onSend,
  onResolve,
}: Props) {
  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const activeEvents = active ? events[active.id] ?? [] : [];
  const pendingCalls = useMemo(
    () => unresolvedClientCalls(activeEvents),
    [activeEvents],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftModes, setDraftModes] = useState<
    Record<string, "text" | "json">
  >({});
  const [toolOutputs, setToolOutputs] = useState<
    Record<string, Record<string, string>>
  >({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    active?.id,
    activeEvents.length,
    active ? streamingOutput[active.id] : undefined,
  ]);

  if (!active) {
    return null;
  }
  const message = drafts[active.id] ?? "";
  const draftMode = draftModes[active.id] ?? "text";
  const activeToolOutputs = toolOutputs[active.id] ?? {};
  const inputError = inputErrors[active.id];
  const summary = sessionSummary(activeEvents);

  return (
    <Modal
      isOpen
      onClose={onClose}
      closeable={false}
      animate
      overrides={{
        Dialog: {
          style: {
            width: "min(1180px, calc(100vw - 48px))",
            height: "min(860px, calc(100vh - 48px))",
            maxWidth: "none",
            margin: 0,
            borderRadius: "10px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          },
        },
        DialogContainer: {
          style: { alignItems: "center", justifyContent: "center" },
        },
      }}
    >
      <WorkspaceTabs>
        {tabs.map((tab) => (
          <WorkspaceTab
            key={tab.id}
            $active={tab.id === active.id}
            onClick={() => onSelectTab(tab.id)}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {tab.label}
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label={`Close ${tab.label}`}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }
              }}
            >
              ×
            </span>
          </WorkspaceTab>
        ))}
        <button
          type="button"
          aria-label="Close session workspace"
          onClick={onClose}
          style={{
            marginLeft: "auto",
            alignSelf: "center",
            border: 0,
            background: "transparent",
            cursor: "pointer",
            fontSize: 18,
            padding: "8px 14px",
          }}
        >
          ×
        </button>
      </WorkspaceTabs>
      <MetaRow
        style={{
          minHeight: 38,
          padding: "0 16px",
          borderBottom: "1px solid #e7e7e7",
        }}
      >
        <Muted>
          {active.kind === "subagent" ? "Subagent" : "Session"} ·{" "}
          {active.sessionId || "New session"}
          {summary.status ? ` · ${summary.status}` : ""}
          {summary.status === "Running" ? (
            <span
              style={{
                display: "inline-flex",
                marginLeft: 5,
                verticalAlign: "-1px",
              }}
            >
              <Spinner
                $size={9}
                $borderWidth={1}
                $color="currentColor"
              />
            </span>
          ) : null}
          {summary.timestamp ? ` · ${summary.timestamp}` : ""}
          {summary.tokens !== undefined
            ? ` · ${summary.tokens.toLocaleString()} tokens`
            : ""}
        </Muted>
      </MetaRow>
      <ModalBody
        ref={scrollRef}
        $style={{
          margin: 0,
          minHeight: 0,
          flex: 1,
          overflowY: "auto",
        }}
      >
        <Transcript>
          {activeEvents.length === 0 && !streamingOutput[active.id] ? (
            <EmptyState>
              {active.sessionId
                ? "Loading session transcript…"
                : "Send a message to start this agent."}
            </EmptyState>
          ) : (
            <>
              <EventTimeline
                events={activeEvents}
                parentAgent={
                  active.kind === "subagent"
                    ? active.parentAgent ?? active.agent
                    : active.agent
                }
                onOpenSubagent={onOpenSubagent}
              />
              {streamingOutput[active.id] ? (
                <Message $role="assistant">
                  <MarkdownContent>
                    {streamingOutput[active.id]}
                  </MarkdownContent>
                </Message>
              ) : null}
            </>
          )}
        </Transcript>
      </ModalBody>
      {active.kind === "parent" ? (
        <div
          style={{
            borderTop: "1px solid #e7e7e7",
            padding: 12,
            background: "#fff",
          }}
        >
          {pendingCalls.length > 0 ? (
            <>
              <Muted style={{ marginBottom: 8 }}>
                {pendingCalls.map((call) => call.name).join(", ")} requires a
                result. Enter JSON output.
              </Muted>
              {inputError ? (
                <Muted style={{ color: "#b42318", marginBottom: 8 }}>
                  {inputError}
                </Muted>
              ) : null}
              {pendingCalls.map((call) => (
                <div key={call.callId} style={{ marginBottom: 10 }}>
                  <Muted style={{ marginBottom: 6 }}>{call.name}</Muted>
                  <Textarea
                    value={activeToolOutputs[call.callId] ?? "{}"}
                    onChange={(event) =>
                      setToolOutputs((current) => ({
                        ...current,
                        [active.id]: {
                          ...(current[active.id] ?? {}),
                          [call.callId]: event.currentTarget.value,
                        },
                      }))
                    }
                    size={SIZE.compact}
                  />
                </div>
              ))}
              <MetaRow style={{ justifyContent: "flex-end" }}>
                <Button
                  size={SIZE.compact}
                  disabled={busy}
                  onClick={() => {
                    try {
                      const results = pendingCalls.map((call) => ({
                        callId: call.callId,
                        output: JSON.parse(
                          activeToolOutputs[call.callId] ?? "{}",
                        ) as unknown,
                      }));
                      setInputErrors((current) => {
                        const next = { ...current };
                        delete next[active.id];
                        return next;
                      });
                      void onResolve(active, results);
                    } catch {
                      setInputErrors((current) => ({
                        ...current,
                        [active.id]: "Enter valid JSON output.",
                      }));
                    }
                  }}
                >
                  Continue
                </Button>
              </MetaRow>
            </>
          ) : (
            <>
              <MetaRow style={{ marginBottom: 8 }}>
                <Button
                  size={SIZE.mini}
                  kind={draftMode === "text" ? KIND.primary : KIND.tertiary}
                  onClick={() =>
                    setDraftModes((current) => ({
                      ...current,
                      [active.id]: "text",
                    }))
                  }
                >
                  Text
                </Button>
                <Button
                  size={SIZE.mini}
                  kind={draftMode === "json" ? KIND.primary : KIND.tertiary}
                  onClick={() =>
                    setDraftModes((current) => ({
                      ...current,
                      [active.id]: "json",
                    }))
                  }
                >
                  JSON content
                </Button>
                {inputError ? (
                  <Muted style={{ color: "#b42318" }}>{inputError}</Muted>
                ) : null}
              </MetaRow>
              <MetaRow>
              <div style={{ flex: 1 }}>
                <Textarea
                  value={message}
                  placeholder={
                    draftMode === "text"
                      ? "Message this agent…"
                      : '[{"type":"text","text":"Review this"},{"filePath":"./document.pdf"}]'
                  }
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [active.id]: event.currentTarget.value,
                    }))
                  }
                  size={SIZE.compact}
                />
              </div>
              <Button
                size={SIZE.compact}
                disabled={busy || !message.trim()}
                onClick={() => {
                  try {
                    const content =
                      draftMode === "json"
                        ? (JSON.parse(message) as unknown)
                        : message.trim();
                    setInputErrors((current) => {
                      const next = { ...current };
                      delete next[active.id];
                      return next;
                    });
                    setDrafts((current) => ({
                      ...current,
                      [active.id]: "",
                    }));
                    void onSend(active, content);
                  } catch {
                    setInputErrors((current) => ({
                      ...current,
                      [active.id]: "Enter valid JSON content.",
                    }));
                  }
                }}
              >
                Send
              </Button>
            </MetaRow>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function EventTimeline({
  events,
  parentAgent,
  onOpenSubagent,
}: {
  events: SessionEvent[];
  parentAgent: string;
  onOpenSubagent: Props["onOpenSubagent"];
}) {
  const terminalSubagents = new Map(
    events
      .filter((event) =>
        [
          "subagent.completed",
          "subagent.paused",
          "subagent.failed",
        ].includes(event.type),
      )
      .map((event) => [String(event.data.sessionId), event]),
  );
  const actionRequests = new Map(
    events
      .filter((event) => event.type === "action.requested")
      .map((event) => [String(event.data.callId), event]),
  );
  const terminalActionIds = new Set(
    events
      .filter(
        (event) =>
          event.type === "action.completed" ||
          event.type === "action.failed",
      )
      .map((event) => String(event.data.callId)),
  );

  return (
    <>
      {events.map((event) => {
        if (event.type === "message.created") {
          const eventRole = String(event.data.role ?? "assistant");
          const role = eventRole === "user" ? "user" : "assistant";
          const roleLabel =
            eventRole === "user"
              ? "User"
              : eventRole === "tool"
                ? "Tool response"
                : "Model";
          const content = Array.isArray(event.data.content)
            ? event.data.content
            : [];
          const text = content
            .filter(
              (item): item is { type: "text"; text: string } =>
                isRecord(item) &&
                item.type === "text" &&
                typeof item.text === "string",
            )
            .map((item) => item.text)
            .join("");
          const reasoning = content
            .filter(
              (item): item is { type: "reasoning"; text: string } =>
                isRecord(item) &&
                item.type === "reasoning" &&
                typeof item.text === "string",
            )
            .map((item) => item.text)
            .join("");
          const attachments = content.filter(
            (item) =>
              isRecord(item) &&
              !["text", "reasoning", "tool_call"].includes(
                String(item.type),
              ),
          );
          return (
            <div key={event.sequence}>
              {reasoning ? (
                <Activity title="Thought">
                  <MarkdownContent>{reasoning}</MarkdownContent>
                </Activity>
              ) : null}
              {text && event.data.parsedOutput === undefined ? (
                <>
                  <RoleLabel>{roleLabel}</RoleLabel>
                  <Message $role={role}>
                    {eventRole === "assistant" ? (
                      <MarkdownContent>{text}</MarkdownContent>
                    ) : (
                      text
                    )}
                  </Message>
                </>
              ) : null}
              {event.data.parsedOutput !== undefined ? (
                <>
                  <RoleLabel>{roleLabel}</RoleLabel>
                  <Message $role={role}>
                    <CodeBlock>
                      {JSON.stringify(event.data.parsedOutput, null, 2)}
                    </CodeBlock>
                  </Message>
                </>
              ) : null}
              {attachments.length > 0 ? (
                <Activity title={roleLabel}>
                  <CodeBlock>{JSON.stringify(attachments, null, 2)}</CodeBlock>
                </Activity>
              ) : null}
            </div>
          );
        }
        if (
          event.type === "action.completed" ||
          event.type === "action.failed"
        ) {
          const request = actionRequests.get(String(event.data.callId));
          return (
            <Activity
              key={event.sequence}
              title={`Tool · ${String(event.data.name ?? "unknown")}`}
              status={event.type === "action.completed" ? "completed" : "failed"}
            >
              <CodeBlock>
                {JSON.stringify(
                  {
                    arguments: request?.data.arguments,
                    output: event.data.output,
                    error: event.data.error,
                    durationMs: event.data.durationMs,
                  },
                  null,
                  2,
                )}
              </CodeBlock>
            </Activity>
          );
        }
        if (
          event.type === "action.requested" &&
          !terminalActionIds.has(String(event.data.callId))
        ) {
          return (
            <Activity
              key={event.sequence}
              title={`Tool · ${String(event.data.name ?? "unknown")}`}
              status="running"
            >
              <CodeBlock>
                {JSON.stringify(event.data.arguments, null, 2)}
              </CodeBlock>
            </Activity>
          );
        }
        if (event.type === "skill.loaded") {
          return (
            <Activity
              key={event.sequence}
              title={`Skill · ${String(event.data.name ?? "unknown")}`}
              status={event.data.alreadyLoaded ? "already loaded" : "loaded"}
            >
              <CodeBlock>{JSON.stringify(event.data, null, 2)}</CodeBlock>
            </Activity>
          );
        }
        if (event.type === "subagent.initiated") {
          const childSessionId = String(event.data.sessionId);
          const childAgent = String(event.data.agent);
          const terminal = terminalSubagents.get(childSessionId);
          return (
            <Disclosure key={event.sequence}>
              <DisclosureButton
                onClick={() =>
                  onOpenSubagent(parentAgent, childSessionId, childAgent)
                }
              >
                <DisclosureChevron>›</DisclosureChevron>
                <span>Subagent · {childAgent}</span>
                <Muted style={{ marginLeft: "auto" }}>
                  {terminal?.data.status?.toString() ?? "running"} →
                </Muted>
              </DisclosureButton>
            </Disclosure>
          );
        }
        if (
          event.type === "evaluation.completed" ||
          event.type === "evaluation.failed"
        ) {
          return (
            <Activity
              key={event.sequence}
              title={`Evaluation · ${String(event.data.name ?? "unknown")}`}
              status={
                event.type === "evaluation.failed"
                  ? "failed"
                  : event.data.status === "passed"
                    ? "passed"
                    : "failed"
              }
            >
              <CodeBlock>{JSON.stringify(event.data, null, 2)}</CodeBlock>
            </Activity>
          );
        }
        if (event.type === "client_action.requested") {
          return (
            <Activity
              key={event.sequence}
              title="Client action"
              status="waiting"
            >
              <CodeBlock>
                {JSON.stringify(event.data.calls, null, 2)}
              </CodeBlock>
            </Activity>
          );
        }
        if (event.type === "run.started") {
          return (
            <Muted key={event.sequence} style={{ marginBottom: 12 }}>
              Run {event.run} started · {String(event.data.provider)} /{" "}
              {String(event.data.model)}
            </Muted>
          );
        }
        if (
          event.type === "run.completed" ||
          event.type === "run.failed" ||
          event.type === "run.paused"
        ) {
          return (
            <Muted key={event.sequence} style={{ marginBottom: 12 }}>
              {event.type.replace(".", " ")} ·{" "}
              {String(event.data.status ?? "")}
            </Muted>
          );
        }
        return null;
      })}
    </>
  );
}

function Activity({
  title,
  status,
  children,
}: {
  title: string;
  status?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Disclosure>
      <DisclosureButton onClick={() => setOpen((value) => !value)}>
        <DisclosureChevron $open={open}>›</DisclosureChevron>
        <span>{title}</span>
        {status ? (
          <Muted style={{ marginLeft: "auto" }}>{status}</Muted>
        ) : null}
      </DisclosureButton>
      {open ? <DisclosureDetails>{children}</DisclosureDetails> : null}
    </Disclosure>
  );
}

const markdownComponents: Components = {
  p: ({ children }) => (
    <MarkdownParagraph>{children}</MarkdownParagraph>
  ),
  h1: ({ children }) => <MarkdownHeading>{children}</MarkdownHeading>,
  h2: ({ children }) => <MarkdownHeading>{children}</MarkdownHeading>,
  h3: ({ children }) => <MarkdownHeading>{children}</MarkdownHeading>,
  h4: ({ children }) => <MarkdownHeading>{children}</MarkdownHeading>,
  ul: ({ children }) => <MarkdownList>{children}</MarkdownList>,
  ol: ({ children }) => (
    <MarkdownOrderedList>{children}</MarkdownOrderedList>
  ),
  li: ({ children }) => (
    <MarkdownListItem>{children}</MarkdownListItem>
  ),
  blockquote: ({ children }) => (
    <MarkdownQuote>{children}</MarkdownQuote>
  ),
  a: ({ children, href }) => (
    <MarkdownLink href={href} target="_blank" rel="noreferrer">
      {children}
    </MarkdownLink>
  ),
  pre: ({ children }) => <>{children}</>,
  code: ({ children, className }) => {
    const value = String(children).replace(/\n$/, "");
    return className || value.includes("\n") ? (
      <CodeBlock>{value}</CodeBlock>
    ) : (
      <MarkdownInlineCode>{children}</MarkdownInlineCode>
    );
  },
};

function MarkdownContent({ children }: { children: string }) {
  return (
    <MarkdownRoot>
      <ReactMarkdown components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </MarkdownRoot>
  );
}

function unresolvedClientCalls(events: SessionEvent[]): ClientToolCall[] {
  let calls: ClientToolCall[] = [];
  for (const event of events) {
    if (
      event.type === "client_action.requested" &&
      Array.isArray(event.data.calls)
    ) {
      calls = event.data.calls.filter(isClientToolCall);
    }
    if (event.type === "client_action.resolved") {
      calls = [];
    }
  }
  return calls;
}

function isClientToolCall(value: unknown): value is ClientToolCall {
  return (
    isRecord(value) &&
    typeof value.callId === "string" &&
    typeof value.name === "string" &&
    isRecord(value.arguments)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionSummary(events: SessionEvent[]): {
  status?: string;
  timestamp?: string;
  tokens?: number;
} {
  const terminal = [...events]
    .reverse()
    .find((event) =>
      ["run.completed", "run.failed", "run.paused"].includes(event.type),
    );
  const usage = terminal && isRecord(terminal.data.usage)
    ? terminal.data.usage
    : undefined;
  const tokens = usage
    ? ["inputTokens", "outputTokens", "reasoningTokens"]
        .map((key) => usage[key])
        .filter((value): value is number => typeof value === "number")
        .reduce((total, value) => total + value, 0)
    : undefined;
  return {
    status:
      terminal?.type === "run.completed"
        ? "Completed"
        : terminal?.type === "run.failed"
          ? "Failed"
          : terminal?.type === "run.paused"
            ? String(terminal.data.status ?? "Paused")
            : events.length > 0
              ? "Running"
              : undefined,
    timestamp: events[0]
      ? new Date(events[0].timestamp).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : undefined,
    tokens,
  };
}
