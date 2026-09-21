import { Button, KIND, SIZE } from "baseui/button";
import { Input, SIZE as INPUT_SIZE } from "baseui/input";
import {
  KIND as NOTIFICATION_KIND,
  Notification,
} from "baseui/notification";
import { Spinner } from "baseui/spinner";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getAgent,
  getSessionEvents,
  getSubagentEvents,
  listAgents,
  listSessions,
  runAgent,
  streamAgentSessions,
  streamSessionEvents,
  streamSubagentEvents,
} from "./api";
import { AgentDetails } from "./AgentDetails";
import { SessionWorkspace } from "./SessionWorkspace";
import type {
  AgentSource,
  AgentSummary,
  SessionEvent,
  SessionSnapshot,
  TranscriptTab,
} from "./types";
import {
  AppFrame,
  Brand,
  BrandIcon,
  Columns,
  EmptyState,
  Header,
  Main,
  Muted,
  NavItem,
  ScrollArea,
  SectionHeader,
  Sidebar,
  Title,
} from "./ui";

export function App() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>();
  const [source, setSource] = useState<AgentSource>();
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [filter, setFilter] = useState("");
  const [revision, setRevision] = useState(0);
  const [projectError, setProjectError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [workspaceTabs, setWorkspaceTabs] = useState<TranscriptTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>();
  const [events, setEvents] = useState<Record<string, SessionEvent[]>>({});
  const [streamingOutput, setStreamingOutput] = useState<
    Record<string, string>
  >({});
  const childStreams = useRef(new Map<string, EventSource>());
  const parentStreams = useRef(new Map<string, EventSource>());
  const selectedRequest = useRef(0);

  const refreshAgents = useCallback(async () => {
    const next = await listAgents();
    setAgents(next);
    setSelectedAgent((current) =>
      current && next.some((agent) => agent.key === current)
        ? current
        : next[0]?.key,
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void refreshAgents().catch((error: unknown) => {
      setProjectError(error instanceof Error ? error.message : String(error));
      setLoading(false);
    });
    const stream = new EventSource("/api/project/events");
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data) as {
        type: string;
        error?: string;
      };
      if (event.type === "project.updated") {
        setProjectError(undefined);
        setRevision((value) => value + 1);
        void refreshAgents();
      } else if (event.type === "project.error") {
        setProjectError(event.error ?? "Project reload failed.");
      }
    };
    return () => stream.close();
  }, [refreshAgents]);

  useEffect(
    () => () => {
      for (const stream of childStreams.current.values()) {
        stream.close();
      }
      childStreams.current.clear();
      for (const stream of parentStreams.current.values()) {
        stream.close();
      }
      parentStreams.current.clear();
    },
    [],
  );

  const refreshSelected = useCallback(async () => {
    if (!selectedAgent) {
      return;
    }
    const request = ++selectedRequest.current;
    const [nextSource, nextSessions] = await Promise.all([
      getAgent(selectedAgent),
      listSessions(selectedAgent),
    ]);
    if (request !== selectedRequest.current) {
      return;
    }
    setSource(nextSource);
    setSessions(nextSessions);
  }, [selectedAgent]);

  useEffect(() => {
    setSource(undefined);
    setSessions([]);
    void refreshSelected().catch((error: unknown) =>
      setProjectError(error instanceof Error ? error.message : String(error)),
    );
  }, [refreshSelected, revision]);

  useEffect(() => {
    if (!selectedAgent) {
      return;
    }
    const stream = streamAgentSessions(selectedAgent, (snapshot) => {
      setSessions((current) => upsertSession(current, snapshot));
    });
    return () => stream.close();
  }, [selectedAgent, revision]);

  const visibleAgents = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query
      ? agents.filter(
          (agent) =>
            agent.name.toLowerCase().includes(query) ||
            agent.key.toLowerCase().includes(query),
        )
      : agents;
  }, [agents, filter]);

  const startParentStream = useCallback(
    (agent: string, sessionId: string, tabId: string) => {
      if (parentStreams.current.has(tabId)) {
        return;
      }
      const stream = streamSessionEvents(
        agent,
        sessionId,
        (appended) => {
          setEvents((current) => ({
            ...current,
            [tabId]: mergeEvents(current[tabId] ?? [], appended),
          }));
        },
      );
      parentStreams.current.set(tabId, stream);
    },
    [],
  );

  const openSession = async (session: SessionSnapshot) => {
    if (!selectedAgent) return;
    const id = `session:${session.sessionId}`;
    setWorkspaceTabs((current) =>
      current.some((tab) => tab.id === id)
        ? current
        : [
            ...current,
            {
              id,
              agent: selectedAgent,
              sessionId: session.sessionId,
              label: session.name ?? selectedAgent,
              kind: "parent",
            },
          ],
    );
    setActiveTabId(id);
    startParentStream(selectedAgent, session.sessionId, id);
    if (!events[id]) {
      try {
        const sessionEvents = await getSessionEvents(
          selectedAgent,
          session.sessionId,
        );
        setEvents((current) => ({ ...current, [id]: sessionEvents }));
      } catch (error) {
        setProjectError(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const tryAgent = () => {
    if (!selectedAgent || !source) return;
    const id = `new:${selectedAgent}:${Date.now()}`;
    setWorkspaceTabs((current) => [
      ...current,
      {
        id,
        agent: selectedAgent,
        sessionId: "",
        label: source.name,
        kind: "parent",
      },
    ]);
    setEvents((current) => ({ ...current, [id]: [] }));
    setActiveTabId(id);
  };

  const openSubagent = async (
    parentAgent: string,
    childSessionId: string,
    childAgent: string,
  ) => {
    const id = `subagent:${childSessionId}`;
    setWorkspaceTabs((current) =>
      current.some((tab) => tab.id === id)
        ? current
        : [
            ...current,
            {
              id,
              agent: childAgent,
              parentAgent,
              sessionId: childSessionId,
              label: childAgent,
              kind: "subagent",
            },
          ],
    );
    setActiveTabId(id);
    if (!childStreams.current.has(id)) {
      const stream = streamSubagentEvents(
        parentAgent,
        childSessionId,
        (appended) => {
          setEvents((current) => ({
            ...current,
            [id]: mergeEvents(current[id] ?? [], appended),
          }));
          if (
            appended.some((event) =>
              ["run.completed", "run.failed"].includes(event.type),
            )
          ) {
            stream.close();
            childStreams.current.delete(id);
          }
        },
      );
      childStreams.current.set(id, stream);
    }
    if (!events[id]) {
      try {
        const childEvents = await getSubagentEvents(
          parentAgent,
          childSessionId,
        );
        setEvents((current) => ({
          ...current,
          [id]: mergeEvents(current[id] ?? [], childEvents),
        }));
      } catch (error) {
        setProjectError(error instanceof Error ? error.message : String(error));
      }
    }
  };

  const execute = async (
    tab: TranscriptTab,
    body: Record<string, unknown>,
  ) => {
    setBusy(true);
    setProjectError(undefined);
    try {
      await runAgent(tab.agent, body, (message) => {
        if (
          message.type === "snapshot" &&
          isRecord(message.snapshot) &&
          message.snapshot.status === "streaming"
        ) {
          const output = message.snapshot.output;
          setStreamingOutput((current) => ({
            ...current,
            [tab.id]:
              typeof output === "string"
                ? output
                : JSON.stringify(output, null, 2) ?? String(output),
          }));
        }
        if (
          message.type === "execution.started" &&
          typeof message.sessionId === "string"
        ) {
          const sessionId = message.sessionId;
          startParentStream(tab.agent, sessionId, tab.id);
          setWorkspaceTabs((current) =>
            current.map((item) =>
              item.id === tab.id ? { ...item, sessionId } : item,
            ),
          );
        }
        if (
          message.type === "events.appended" &&
          Array.isArray(message.events)
        ) {
          const appendedEvents = message.events as SessionEvent[];
          if (
            appendedEvents.some(
              (event) =>
                event.type === "message.created" &&
                event.data.role === "assistant",
            )
          ) {
            setStreamingOutput((current) => ({
              ...current,
              [tab.id]: "",
            }));
          }
          setEvents((current) => ({
            ...current,
            [tab.id]: mergeEvents(
              current[tab.id] ?? [],
              appendedEvents,
            ),
          }));
          for (const event of appendedEvents) {
            if (
              [
                "subagent.completed",
                "subagent.paused",
                "subagent.failed",
              ].includes(event.type) &&
              typeof event.data.sessionId === "string"
            ) {
              const childTabId = `subagent:${event.data.sessionId}`;
              void getSubagentEvents(tab.agent, event.data.sessionId).then(
                (childEvents) =>
                  setEvents((current) => ({
                    ...current,
                    [childTabId]: childEvents,
                  })),
              ).catch(() => undefined);
            }
          }
        }
        if (
          message.type === "events" &&
          Array.isArray(message.events)
        ) {
          setStreamingOutput((current) => ({
            ...current,
            [tab.id]: "",
          }));
          setEvents((current) => ({
            ...current,
            [tab.id]: message.events as SessionEvent[],
          }));
        }
        if (message.type === "error") {
          setProjectError(String(message.error));
        }
      });
      await refreshSelected();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const closeTab = (id: string) => {
    childStreams.current.get(id)?.close();
    childStreams.current.delete(id);
    parentStreams.current.get(id)?.close();
    parentStreams.current.delete(id);
    setWorkspaceTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (id === activeTabId) {
        setActiveTabId(next[Math.max(0, index - 1)]?.id);
      }
      return next;
    });
    setEvents((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setStreamingOutput((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  return (
    <AppFrame>
      <Header>
        <Brand>
          <BrandIcon src="/orcha-logo.svg" alt="" />
          <div>
            <Title>Orcha Playground</Title>
            <Muted>Local agent workspace</Muted>
          </div>
        </Brand>
        <Muted>{agents.length} agents</Muted>
      </Header>
      {projectError ? (
        <Notification
          kind={NOTIFICATION_KIND.negative}
          overrides={{ Body: { style: { margin: 0, width: "auto" } } }}
        >
          {projectError}
        </Notification>
      ) : null}
      <Columns>
        <Sidebar>
          <SectionHeader>
            <Title>Agents</Title>
          </SectionHeader>
          <div style={{ padding: 8 }}>
            <Input
              value={filter}
              onChange={(event) => setFilter(event.currentTarget.value)}
              placeholder="Search agents"
              size={INPUT_SIZE.mini}
              clearable
              overrides={{
                Root: {
                  style: ({ $theme }) => ({
                    borderTopColor: $theme.colors.contentPrimary,
                    borderRightColor: $theme.colors.contentPrimary,
                    borderBottomColor: $theme.colors.contentPrimary,
                    borderLeftColor: $theme.colors.contentPrimary,
                    backgroundColor: $theme.colors.backgroundPrimary,
                  }),
                },
                InputContainer: {
                  style: ({ $theme }) => ({
                    backgroundColor: $theme.colors.backgroundPrimary,
                  }),
                },
                Input: {
                  style: ({ $theme }) => ({
                    color: $theme.colors.contentPrimary,
                    backgroundColor: $theme.colors.backgroundPrimary,
                    "::placeholder": {
                      color: $theme.colors.contentSecondary,
                      opacity: 1,
                    },
                  }),
                },
              }}
            />
          </div>
          <ScrollArea>
            {visibleAgents.map((agent) => (
              <NavItem
                key={agent.key}
                $active={agent.key === selectedAgent}
                onClick={() => {
                  selectedRequest.current += 1;
                  setSelectedAgent(agent.key);
                }}
              >
                <Title>{agent.name}</Title>
                <Muted>
                  {agent.provider} · {agent.model}
                </Muted>
              </NavItem>
            ))}
          </ScrollArea>
        </Sidebar>
        <Main>
          {loading || (selectedAgent && !source) ? (
            <EmptyState>
              <Spinner $size={20} />
            </EmptyState>
          ) : source ? (
            <AgentDetails
              key={source.key}
              agent={source}
              revision={revision}
              onTry={tryAgent}
            />
          ) : (
            <EmptyState>No registered agents.</EmptyState>
          )}
        </Main>
        <Sidebar $right>
          <SectionHeader>
            <Title>Sessions</Title>
            <Button
              kind={KIND.tertiary}
              size={SIZE.mini}
              onClick={() => void refreshSelected()}
            >
              Refresh
            </Button>
          </SectionHeader>
          <ScrollArea>
            {sessions.length === 0 ? (
              <EmptyState>No sessions yet.</EmptyState>
            ) : (
              sessions.map((session) => (
                <NavItem
                  key={session.sessionId}
                  onClick={() => void openSession(session)}
                >
                  <Title>{session.name ?? "Untitled session"}</Title>
                  <Muted>
                    {session.runStatus ?? session.status} ·{" "}
                    {formatDate(session.updatedAt)}
                  </Muted>
                </NavItem>
              ))
            )}
          </ScrollArea>
        </Sidebar>
      </Columns>
      <SessionWorkspace
        tabs={workspaceTabs}
        activeTabId={activeTabId}
        events={events}
        streamingOutput={streamingOutput}
        busy={busy}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
        onClose={() => {
          for (const stream of childStreams.current.values()) {
            stream.close();
          }
          childStreams.current.clear();
          for (const stream of parentStreams.current.values()) {
            stream.close();
          }
          parentStreams.current.clear();
          setWorkspaceTabs([]);
          setActiveTabId(undefined);
          setEvents({});
          setStreamingOutput({});
        }}
        onOpenSubagent={(parentAgent, sessionId, childAgent) =>
          void openSubagent(parentAgent, sessionId, childAgent)
        }
        onSend={async (tab, content) => {
          await execute(tab, {
            content,
            ...(tab.sessionId ? { sessionId: tab.sessionId } : {}),
          });
        }}
        onResolve={async (tab, toolResults) => {
          await execute(tab, {
            sessionId: tab.sessionId,
            toolResults,
          });
        }}
      />
    </AppFrame>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeEvents(
  current: SessionEvent[],
  appended: SessionEvent[],
): SessionEvent[] {
  const bySequence = new Map(
    [...current, ...appended].map((event) => [event.sequence, event]),
  );
  return [...bySequence.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

function upsertSession(
  sessions: SessionSnapshot[],
  snapshot: SessionSnapshot,
): SessionSnapshot[] {
  return [
    snapshot,
    ...sessions.filter(
      (session) => session.sessionId !== snapshot.sessionId,
    ),
  ].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() -
      new Date(left.updatedAt).getTime(),
  );
}
