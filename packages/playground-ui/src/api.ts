import type {
  AgentSource,
  AgentSummary,
  AgentTest,
  SessionEvent,
  SessionSnapshot,
  TestReport,
} from "./types";

export async function listAgents(): Promise<AgentSummary[]> {
  return (await requestJson<{ agents: AgentSummary[] }>("/api/agents")).agents;
}

export function getAgent(agent: string): Promise<AgentSource> {
  return requestJson(`/api/agents/${encodeURIComponent(agent)}`);
}

export async function listSessions(
  agent: string,
): Promise<SessionSnapshot[]> {
  return (
    await requestJson<{ items: SessionSnapshot[] }>(
      `/api/agents/${encodeURIComponent(agent)}/sessions?pageSize=100`,
    )
  ).items;
}

export async function getSessionEvents(
  agent: string,
  sessionId: string,
): Promise<SessionEvent[]> {
  return (
    await requestJson<{ events: SessionEvent[] }>(
      `/api/agents/${encodeURIComponent(agent)}/sessions/${encodeURIComponent(sessionId)}/events`,
    )
  ).events;
}

export async function getSubagentEvents(
  parentAgent: string,
  childSessionId: string,
): Promise<SessionEvent[]> {
  return (
    await requestJson<{ events: SessionEvent[] }>(
      `/api/agents/${encodeURIComponent(parentAgent)}/subagents/${encodeURIComponent(childSessionId)}/events`,
    )
  ).events;
}

export async function listAgentTests(agent: string): Promise<AgentTest[]> {
  return (
    await requestJson<{ tests: AgentTest[] }>(
      `/api/agents/${encodeURIComponent(agent)}/tests`,
    )
  ).tests;
}

export function runAgentTests(
  agent: string,
  test?: string,
): Promise<TestReport> {
  return mutationRequest(`/api/agents/${encodeURIComponent(agent)}/tests`, {
    method: "POST",
    body: JSON.stringify(test ? { test } : {}),
  });
}

export async function runAgent(
  agent: string,
  body: Record<string, unknown>,
  onMessage: (message: Record<string, unknown>) => void,
): Promise<void> {
  const mutationToken = await getMutationToken();
  const response = await fetch(
    `/api/agents/${encodeURIComponent(agent)}/executions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-orcha-playground-token": mutationToken,
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok || !response.body) {
    throw new Error(await responseMessage(response));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (true) {
    const { value, done } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) {
        onMessage(JSON.parse(line) as Record<string, unknown>);
      }
    }
    if (done) {
      if (buffered.trim()) {
        onMessage(JSON.parse(buffered) as Record<string, unknown>);
      }
      return;
    }
  }
}

export function streamSubagentEvents(
  parentAgent: string,
  childSessionId: string,
  onEvents: (events: SessionEvent[]) => void,
): EventSource {
  const stream = new EventSource(
    `/api/agents/${encodeURIComponent(parentAgent)}/subagents/${encodeURIComponent(childSessionId)}/stream`,
  );
  stream.onmessage = (message) => {
    const value = JSON.parse(message.data) as { events?: SessionEvent[] };
    if (Array.isArray(value.events)) {
      onEvents(value.events);
    }
  };
  return stream;
}

export function streamSessionEvents(
  agent: string,
  sessionId: string,
  onEvents: (events: SessionEvent[]) => void,
): EventSource {
  const stream = new EventSource(
    `/api/agents/${encodeURIComponent(agent)}/sessions/${encodeURIComponent(sessionId)}/stream`,
  );
  stream.onmessage = (message) => {
    const value = JSON.parse(message.data) as { events?: SessionEvent[] };
    if (Array.isArray(value.events)) {
      onEvents(value.events);
    }
  };
  return stream;
}

export function streamAgentSessions(
  agent: string,
  onSnapshot: (snapshot: SessionSnapshot) => void,
): EventSource {
  const stream = new EventSource(
    `/api/agents/${encodeURIComponent(agent)}/sessions/stream`,
  );
  stream.onmessage = (message) => {
    const value = JSON.parse(message.data) as {
      snapshot?: SessionSnapshot;
    };
    if (value.snapshot) {
      onSnapshot(value.snapshot);
    }
  };
  return stream;
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(await responseMessage(response));
  }
  return (await response.json()) as T;
}

let mutationTokenPromise: Promise<string> | undefined;

async function getMutationToken(): Promise<string> {
  mutationTokenPromise ??= requestJson<{ mutationToken: string }>(
    "/api/playground",
  ).then((value) => value.mutationToken);
  return mutationTokenPromise;
}

async function mutationRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const mutationToken = await getMutationToken();
  return requestJson(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-orcha-playground-token": mutationToken,
    },
  });
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const value = (await response.json()) as { error?: string };
    return value.error ?? `Request failed with ${response.status}.`;
  } catch {
    return `Request failed with ${response.status}.`;
  }
}
