const state = {
  agents: [],
  agent: undefined,
  sessions: [],
  sessionId: undefined,
  pendingCalls: [],
  evaluations: [],
  tests: [],
  testReports: new Map(),
  operationId: 0,
  inputMode: "text",
  sessionQuery: "",
  running: false,
  rawEvents: "",
  children: [],
};

const element = Object.fromEntries(
  [
    "agent-count", "agent-list", "agent-title", "agent-description",
    "agent-badges", "configuration-grid", "system-instructions", "action-count", "action-list",
    "skill-count", "skill-list", "subagent-count", "subagent-list", "evaluation-definitions",
    "evaluation-session", "evaluation-results",
    "examples", "input-help", "prompt", "run-button", "clear-run", "run-section",
    "live-section", "live-session-label", "run-status", "live-timeline",
    "client-actions", "client-action-fields", "submit-tool-results",
    "run-tests", "test-summary", "test-results",
    "sessions-tab", "session-title", "session-summary", "session-timeline",
    "sessions-index", "center-session-count", "center-session-list",
    "session-history", "back-to-sessions",
    "raw-events", "copy-events", "resume-session", "refresh-sessions",
    "new-session", "session-count-side", "session-search", "session-list",
    "session-list-panel", "session-inspector", "close-session-inspector",
    "inspector-status", "inspector-title", "inspector-children", "inspector-evaluations", "toast",
  ].map((id) => [camel(id), document.querySelector(`#${id}`)]),
);

await loadAgents();

for (const tab of document.querySelectorAll(".main-tab")) {
  tab.addEventListener("click", () => {
    showView(tab.dataset.view);
    if (tab.dataset.view === "sessions") {
      showSessionsIndex();
      showSessionList();
    }
  });
}

for (const segment of document.querySelectorAll(".segment")) {
  segment.addEventListener("click", () => setInputMode(segment.dataset.mode));
}

element.runButton.addEventListener("click", runFromComposer);
element.prompt.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    void runFromComposer();
  }
});
element.clearRun.addEventListener("click", clearRun);
element.newSession.addEventListener("click", startNewSession);
element.refreshSessions.addEventListener("click", loadSessions);
element.closeSessionInspector.addEventListener("click", showSessionList);
element.backToSessions.addEventListener("click", () => {
  showSessionsIndex();
  showSessionList();
});
element.sessionSearch.addEventListener("input", () => {
  state.sessionQuery = element.sessionSearch.value.trim().toLowerCase();
  renderSessionNavigation();
});
element.submitToolResults.addEventListener("click", submitToolResults);
element.runTests.addEventListener("click", () => runAgentTests());
element.resumeSession.addEventListener("click", () => {
  showView("run");
  element.prompt.focus();
});
element.copyEvents.addEventListener("click", async () => {
  if (!state.rawEvents) return;
  await navigator.clipboard.writeText(state.rawEvents);
  showToast("Copied session events.");
});

async function loadAgents() {
  try {
    const data = await requestJson("/api/agents");
    state.agents = data.agents;
    element.agentCount.textContent = String(state.agents.length);
    renderAgentNavigation();
    if (state.agents[0]) await selectAgent(state.agents[0].name);
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderAgentNavigation() {
  element.agentList.replaceChildren(
    ...state.agents.map((agent) => {
      const button = document.createElement("button");
      button.className = `agent-button${state.agent?.name === agent.name ? " active" : ""}`;
      button.innerHTML = `
        <span class="agent-icon">${escapeHtml(agent.name.slice(0, 2))}</span>
        <span class="agent-copy">
          <strong>${escapeHtml(agent.displayName || agent.name)}</strong>
          <span>${escapeHtml(agent.provider)} · ${escapeHtml(agent.model)}</span>
        </span>`;
      button.addEventListener("click", () => selectAgent(agent.name));
      return button;
    }),
  );
}

async function selectAgent(name) {
  if (state.running) {
    showToast("Wait for the current operation to finish.");
    return;
  }
  state.operationId += 1;
  state.agent = state.agents.find((agent) => agent.name === name);
  state.sessions = [];
  state.tests = [];
  state.testReports = new Map();
  state.sessionId = undefined;
  state.pendingCalls = [];
  state.children = [];
  state.evaluations = [];
  state.sessionQuery = "";
  element.sessionSearch.value = "";
  element.evaluationSession.textContent = "Results";
  renderEvaluationResults();
  renderAgentNavigation();
  renderSessionNavigation();
  renderCenterSessionList();
  renderTests();
  element.testSummary.className = "test-summary empty";
  element.testSummary.textContent = "Loading registered tests…";
  renderOverview();
  clearRun();
  showSessionList();
  element.sessionTitle.textContent = "Select a session";
  showSessionsIndex();
  element.rawEvents.textContent = "";
  state.rawEvents = "";
  element.resumeSession.classList.add("hidden");
  showView("overview");
  element.sessionsTab.disabled = true;
  await Promise.all([loadSessions(), loadTests()]);
}

function renderOverview() {
  const agent = state.agent;
  if (!agent) return;
  element.agentTitle.textContent = agent.displayName || agent.name;
  element.agentDescription.textContent =
    agent.description || "Registered Orcha agent.";
  element.agentBadges.innerHTML = [
    badge(agent.provider), badge(agent.model), badge(agent.outputType),
  ].join("");
  element.configurationGrid.innerHTML = [
    configuration("Provider", agent.provider),
    configuration("Model", agent.model),
    configuration("Region", agent.region),
    configuration("Output", agent.outputType),
    configuration("Max tokens", agent.maxTokens ?? "provider default"),
    configuration("Reasoning", agent.reasoningLevel ?? "provider default"),
  ].join("");
  element.systemInstructions.textContent = agent.systemPrompt;
  renderCapabilities(
    element.actionList,
    element.actionCount,
    agent.actions,
    (action) => capability(
      action.name,
      action.description,
      action.execution,
      `${action.sideEffect ? "Side effect" : "Read only"} · ${schemaSummary(action.parameters)}`,
      {
        parameters: action.parameters,
        outputSchema: action.outputSchema,
        permissions: action.permissions,
        timeoutMs: action.timeoutMs,
      },
    ),
  );
  renderCapabilities(
    element.skillList,
    element.skillCount,
    agent.skills,
    (skill) => capability(
      skill.name,
      skill.description,
      "lazy",
      skill.triggers.length
        ? `Triggers: ${skill.triggers.join(" · ")}`
        : "Loaded by the model when needed",
      skill.instructions,
    ),
  );
  renderCapabilities(
    element.subagentList,
    element.subagentCount,
    agent.subagents || [],
    (subagent) => capability(
      subagent.name,
      subagent.description,
      "subagent",
      `${subagent.provider} · ${subagent.model}`,
      { key: subagent.key },
    ),
  );
  renderEvaluationDefinitions();
  renderExamples();
}

function renderEvaluationDefinitions() {
  const evaluations = state.agent?.evaluations || [];
  element.evaluationDefinitions.innerHTML = evaluations.length
    ? evaluations.map((evaluation) => `
        <article class="evaluation-definition">
          <header>
            <div>
              <strong>${escapeHtml(evaluation.name)}</strong>
              <p>${escapeHtml(evaluation.description || "Model-graded evaluation")}</p>
            </div>
            <span class="type ${evaluation.enabled ? "enabled" : "disabled"}">${evaluation.enabled ? "enabled" : "disabled"}</span>
          </header>
          <details class="evaluator-instructions">
            <summary>Evaluator instructions</summary>
            <pre>${escapeHtml(evaluation.instructions || evaluation.description || "")}</pre>
          </details>
          <div class="evaluation-subheading">
            <span class="overline">Scoring criteria</span>
            <strong>Metrics</strong>
          </div>
          <div class="evaluation-metric-definitions">
            ${evaluation.metrics.map((metric) => `
              <div class="evaluation-metric-definition">
                <div>
                  <strong>${escapeHtml(metric.name)}</strong>
                  <span>Threshold ${Number(metric.threshold).toFixed(2)}</span>
                </div>
                <p>${escapeHtml(metric.description)}</p>
              </div>`).join("")}
          </div>
          <details class="evaluation-configuration">
            <summary>Judge configuration</summary>
            <pre class="detail-json">${escapeHtml(JSON.stringify({
              provider: evaluation.provider,
              model: evaluation.model,
              maxTokens: evaluation.maxTokens,
              reasoningLevel: evaluation.reasoningLevel,
            }, null, 2))}</pre>
          </details>
        </article>`).join("")
    : '<div class="empty">No evaluations registered for this agent.</div>';
}

function renderEvaluationResults() {
  const evaluations = state.evaluations || [];
  element.evaluationResults.className = evaluations.length
    ? "evaluation-results"
    : "evaluation-results empty";
  element.evaluationResults.innerHTML = evaluations.length
    ? evaluations.map((evaluation) => `
        <article class="evaluation-card ${escapeHtml(evaluation.status)}">
          <header>
            <div><span class="overline">Evaluation${evaluation.run ? ` · Run ${evaluation.run}` : ""}</span><strong>${escapeHtml(evaluation.name)}</strong></div>
            <span class="evaluation-status">${escapeHtml(evaluation.status)}</span>
          </header>
          ${evaluation.error ? `<p class="evaluation-error">${escapeHtml(evaluation.error.message)}</p>` : ""}
          <div class="metric-list">
            ${(evaluation.metrics || []).map((metric) => `
              <div class="metric-card">
                <div class="metric-heading">
                  <strong>${escapeHtml(metric.name)}</strong>
                  <span class="${metric.passed ? "pass" : "fail"}">${metric.passed ? "PASS" : "FAIL"}</span>
                </div>
                <div class="metric-score">
                  <span>Score ${Number(metric.score).toFixed(2)}</span>
                  <span>Threshold ${Number(metric.threshold).toFixed(2)}</span>
                </div>
                <div class="score-track"><span style="width:${Math.max(0, Math.min(100, Number(metric.score) * 100))}%"></span></div>
                <p>${escapeHtml(metric.reasoning)}</p>
                <div class="evidence">
                  <span class="overline">Evidence</span>
                  ${(metric.evidence || []).map((item) => `<blockquote>${escapeHtml(item)}</blockquote>`).join("")}
                </div>
              </div>`).join("")}
          </div>
        </article>`).join("")
    : "Select or run a session to inspect evaluation results.";
}

function renderCapabilities(container, count, items, render) {
  count.textContent = String(items.length);
  container.innerHTML = items.length
    ? items.map(render).join("")
    : '<div class="empty">None configured.</div>';
}

function renderExamples() {
  const examples = state.agent?.examples || [];
  element.examples.innerHTML = examples.length
    ? examples.map((example, index) =>
        `<button class="example-button" data-example="${index}">${escapeHtml(example.label)}</button>`,
      ).join("")
    : '<span class="empty">No example prompts configured.</span>';
  for (const button of element.examples.querySelectorAll(".example-button")) {
    button.addEventListener("click", () => {
      const example = examples[Number(button.dataset.example)];
      const structured = Array.isArray(example.content);
      setInputMode(structured ? "json" : "text");
      element.prompt.value = structured
        ? JSON.stringify(example.content, null, 2)
        : example.content;
      element.prompt.focus();
    });
  }
}

function showView(name) {
  for (const tab of document.querySelectorAll(".main-tab")) {
    tab.classList.toggle("active", tab.dataset.view === name);
  }
  for (const view of document.querySelectorAll(".main-view")) {
    view.classList.toggle("active", view.id === `${name}-view`);
  }
}

function setInputMode(mode) {
  state.inputMode = mode;
  for (const segment of document.querySelectorAll(".segment")) {
    segment.classList.toggle("active", segment.dataset.mode === mode);
  }
  const structured = mode === "json";
  element.prompt.classList.toggle("json-mode", structured);
  element.prompt.placeholder = structured
    ? '[\n  { "type": "text", "text": "Describe this image." },\n  { "type": "image", "mimeType": "image/png", "fileUri": "https://…" }\n]'
    : "Enter a message…";
  element.inputHelp.textContent = structured
    ? "Enter the complete MessageContent[] JSON array."
    : "Send a plain text message.";
}

async function runFromComposer() {
  if (!state.agent || state.running) return;
  try {
    const content = parseComposerInput();
    addLiveMessage("user", contentText(content));
    await execute({ content, sessionId: state.sessionId });
  } catch (error) {
    showToast(error.message, true);
  }
}

function parseComposerInput() {
  const value = element.prompt.value.trim();
  if (!value) throw new Error("Enter an agent message.");
  if (state.inputMode === "text") return value;
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Content JSON must be a non-empty array.");
  }
  return parsed;
}

async function execute(payload) {
  const operationId = ++state.operationId;
  const agentName = state.agent.name;
  setRunning(true);
  element.liveSection.classList.remove("hidden");
  element.clientActions.classList.add("hidden");
  if (!payload.toolResults) {
    element.runSection.classList.remove("hidden");
  }
  showView("run");
  let assistantMessage;
  try {
    const response = await ensureResponse(await fetch(
      `/api/agents/${encodeURIComponent(agentName)}/executions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    ));
    for await (const event of readNdjson(response.body)) {
      if (operationId !== state.operationId) continue;
      if (event.type === "snapshot") {
        const snapshot = event.snapshot;
        state.sessionId = snapshot.sessionId;
        element.liveSessionLabel.textContent = shortId(snapshot.sessionId);
        renderRunStatus(snapshot.status);
        if (snapshot.output !== undefined) {
          assistantMessage = upsertLiveAssistant(
            assistantMessage,
            outputText(snapshot.output),
          );
        }
        if (snapshot.status === "waiting_for_client_action") {
          showClientActions(snapshot.clientToolCalls);
        }
        if (snapshot.status === "failed") {
          addLiveMessage("system", `${snapshot.error.code}: ${snapshot.error.message}`);
        }
      } else if (event.type === "result") {
        setRunning(false);
        element.prompt.value = "";
        renderRunStatus(event.result.status);
        element.runSection.classList.toggle(
          "hidden",
          event.result.status === "waiting_for_client_action",
        );
        await refreshLiveTrace(event.result.sessionId);
      } else if (event.type === "evaluations") {
        if (event.sessionId === state.sessionId) {
          state.evaluations = event.evaluations;
          element.evaluationSession.textContent = shortId(event.sessionId);
          renderEvaluationResults();
          renderInspectorEvaluations();
        }
      } else if (event.type === "error") {
        throw new Error(event.error);
      }
    }
    if (operationId !== state.operationId) return;
    element.prompt.value = "";
    await loadSessions();
  } catch (error) {
    if (operationId === state.operationId) {
      addLiveMessage("system", error.message);
      showToast(error.message, true);
    }
  } finally {
    if (operationId === state.operationId) {
      setRunning(false);
    }
  }
}

function clearRun() {
  state.pendingCalls = [];
  element.prompt.value = "";
  element.liveTimeline.replaceChildren();
  element.liveSection.classList.add("hidden");
  element.clientActions.classList.add("hidden");
  element.runSection.classList.remove("hidden");
  renderRunStatus("");
}

function startNewSession() {
  state.sessionId = undefined;
  state.evaluations = [];
  element.evaluationSession.textContent = "Results";
  renderEvaluationResults();
  renderInspectorEvaluations();
  clearRun();
  showSessionList();
  element.resumeSession.classList.add("hidden");
  renderSessionNavigation();
  showView("run");
  element.prompt.focus();
}

function showClientActions(calls) {
  state.pendingCalls = calls;
  element.clientActionFields.innerHTML = calls.map((call) => `
    <div class="tool-field">
      <code>${escapeHtml(call.name)}</code>
      <pre>${escapeHtml(JSON.stringify(call.arguments, null, 2))}</pre>
      <textarea data-call-id="${escapeHtml(call.callId)}">{\n  "approved": true,\n  "note": "Approved for this example."\n}</textarea>
    </div>`).join("");
  element.clientActions.classList.remove("hidden");
  element.runSection.classList.add("hidden");
}

async function submitToolResults() {
  try {
    const toolResults = state.pendingCalls.map((call) => {
      const field = document.querySelector(`[data-call-id="${CSS.escape(call.callId)}"]`);
      return { callId: call.callId, output: JSON.parse(field.value) };
    });
    await execute({ sessionId: state.sessionId, toolResults });
  } catch (error) {
    showToast(`Invalid tool result: ${error.message}`, true);
  }
}

async function loadSessions() {
  if (!state.agent) return;
  const agentName = state.agent.name;
  try {
    const sessions = new Map();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const data = await requestJson(
        `/api/agents/${encodeURIComponent(agentName)}/sessions?page=${page}&pageSize=100`,
      );
      for (const session of data.items) {
        sessions.set(session.sessionId, session);
      }
      hasMore = data.hasMore;
      page += 1;
    }
    if (state.agent?.name !== agentName) return;
    state.sessions = [...sessions.values()].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    element.sessionsTab.disabled = state.sessions.length === 0;
    renderSessionNavigation();
    renderCenterSessionList();
  } catch (error) {
    if (state.agent?.name === agentName) {
      showToast(error.message, true);
    }
  }
}

async function loadTests() {
  if (!state.agent) return;
  const agentName = state.agent.name;
  try {
    const data = await requestJson(
      `/api/agents/${encodeURIComponent(agentName)}/tests`,
    );
    if (state.agent?.name !== agentName) return;
    state.tests = data.tests;
    state.testReports = new Map();
    element.testSummary.className = "test-summary";
    element.testSummary.textContent = state.tests.length
      ? `${state.tests.length} registered test${state.tests.length === 1 ? "" : "s"}`
      : "No tests registered for this agent.";
    renderTests();
  } catch (error) {
    if (state.agent?.name === agentName) {
      element.testSummary.className = "test-summary failed";
      element.testSummary.textContent = error.message;
    }
  }
}

function renderTests() {
  element.testResults.innerHTML = state.tests.map((test) => {
    const report = state.testReports.get(test.name);
    return `
      <article class="test-card ${report?.status || ""}">
        <header>
          <div>
            <strong>${escapeHtml(test.name)}</strong>
            <div class="test-meta">${escapeHtml(test.description || "Registered agent test")}</div>
          </div>
          <button class="quiet-button test-run-button" data-test="${escapeHtml(test.name)}"><span aria-hidden="true">▶</span> ${report ? "Run again" : "Run"}</button>
        </header>
        <details class="test-definition">
          <summary>View complete test definition</summary>
          <pre class="detail-json">${escapeHtml(JSON.stringify(test.configuration, null, 2))}</pre>
        </details>
        ${report ? `
          <div class="test-meta">${escapeHtml(report.status.toUpperCase())} · ${report.durationMs}ms${report.evaluations?.length ? ` · ${report.evaluations.length} evaluations` : ""}</div>
          <div class="assertions">
            ${report.assertions.map((assertion) =>
              `<div class="assertion${assertion.passed ? "" : " failed"}">${escapeHtml(assertion.message)}</div>`,
            ).join("")}
          </div>
          ${report.sessionId ? `<a href="#" class="session-link" data-test-session="${escapeHtml(report.sessionId)}">Open session ${escapeHtml(shortId(report.sessionId))}</a>` : ""}
        ` : ""}
      </article>`;
  }).join("");
  for (const button of element.testResults.querySelectorAll(".test-run-button")) {
    button.addEventListener("click", () => runAgentTests(button.dataset.test));
  }
  for (const link of element.testResults.querySelectorAll(".session-link")) {
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      await loadSessions();
      await selectSession(link.dataset.testSession);
    });
  }
}

async function runAgentTests(testName) {
  if (!state.agent || state.running) return;
  state.running = true;
  element.runTests.disabled = true;
  element.runTests.textContent = testName ? "Test running…" : "Running all…";
  element.testSummary.className = "test-summary";
  element.testSummary.textContent =
    `Running ${testName || "all registered tests"} with evaluations…`;
  try {
    const query = testName ? `?test=${encodeURIComponent(testName)}` : "";
    const report = await requestJson(
      `/api/agents/${encodeURIComponent(state.agent.name)}/tests${query}`,
      { method: "POST" },
    );
    element.testSummary.className = `test-summary ${report.status}`;
    element.testSummary.textContent =
      `${report.passed}/${report.total} passed in ${report.durationMs}ms`;
    for (const testCase of report.cases) {
      state.testReports.set(testCase.name, testCase);
    }
    renderTests();
    await loadSessions();
  } catch (error) {
    element.testSummary.className = "test-summary failed";
    element.testSummary.textContent = error.message;
    showToast(error.message, true);
  } finally {
    state.running = false;
    element.runTests.disabled = false;
    element.runTests.innerHTML = '<span aria-hidden="true">▶</span> Run all tests';
  }
}

function renderSessionNavigation() {
  const sessions = state.sessions.filter((session) => {
    const searchable = `${session.name || ""} ${session.sessionId} ${session.runStatus || ""}`.toLowerCase();
    return searchable.includes(state.sessionQuery);
  });
  element.sessionCountSide.textContent = String(state.sessions.length);
  element.sessionList.innerHTML = sessions.length
    ? sessions.map((session) => {
        const status = session.runStatus || "created";
        return `
          <button class="session-button${session.sessionId === state.sessionId ? " active" : ""}" data-session="${escapeHtml(session.sessionId)}">
            <span class="session-row-head">
              <strong>${escapeHtml(session.name || "Untitled session")}</strong>
              <span class="session-status-dot ${escapeHtml(status)}" title="${escapeHtml(status)}"></span>
            </span>
            <span class="session-row-meta">
              <code>${escapeHtml(shortId(session.sessionId))}</code>
              <time>${escapeHtml(relativeDate(session.updatedAt))}</time>
            </span>
          </button>`;
      }).join("")
    : `<div class="empty">${state.sessions.length ? "No matching sessions." : "No sessions for this agent yet."}</div>`;
  for (const button of element.sessionList.querySelectorAll(".session-button")) {
    button.addEventListener("click", () => selectSession(button.dataset.session));
  }
}

function renderCenterSessionList() {
  element.centerSessionCount.textContent = String(state.sessions.length);
  element.centerSessionList.innerHTML = state.sessions.length
    ? state.sessions.map((session) => {
        const status = session.runStatus || "created";
        return `
          <button class="center-session-card" data-center-session="${escapeHtml(session.sessionId)}">
            <span>
              <strong>${escapeHtml(session.name || "Untitled session")}</strong>
              <code>${escapeHtml(shortId(session.sessionId))}</code>
            </span>
            <span class="center-session-meta">
              <span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span>
              <time>${escapeHtml(formatDate(session.updatedAt))}</time>
            </span>
          </button>`;
      }).join("")
    : '<div class="empty">No sessions for this agent yet.</div>';
  for (const button of element.centerSessionList.querySelectorAll(".center-session-card")) {
    button.addEventListener("click", () =>
      selectSession(button.dataset.centerSession),
    );
  }
}

async function selectSession(sessionId) {
  const agentName = state.agent?.name;
  if (!agentName) return;
  state.sessionId = sessionId;
  element.sessionsTab.disabled = false;
  renderSessionNavigation();
  showView("sessions");
  element.sessionsIndex.classList.add("hidden");
  element.sessionHistory.classList.remove("hidden");
  try {
    const agent = encodeURIComponent(agentName);
    const session = encodeURIComponent(sessionId);
    const [snapshot, eventData, children] = await Promise.all([
      requestJson(`/api/agents/${agent}/sessions/${session}`),
      requestJson(`/api/agents/${agent}/sessions/${session}/events`),
      requestJson(`/api/agents/${agent}/sessions/${session}/children`),
    ]);
    if (
      state.agent?.name !== agentName ||
      state.sessionId !== sessionId
    ) {
      return;
    }
    state.children = children.items || [];
    renderSession(snapshot, eventData.events);
    renderInspectorChildren();
  } catch (error) {
    if (
      state.agent?.name === agentName &&
      state.sessionId === sessionId
    ) {
      showToast(error.message, true);
    }
  }
}

function renderSession(snapshot, events) {
  const title = snapshot.name || shortId(snapshot.sessionId);
  element.sessionTitle.textContent = title;
  element.resumeSession.classList.remove("hidden");
  element.inspectorTitle.textContent = title;
  element.inspectorStatus.textContent = snapshot.runStatus || "created";
  element.inspectorStatus.className = `status ${snapshot.runStatus || "created"}`;
  const usage = snapshot.usage;
  const activity = sessionActivityStats(events);
  element.sessionSummary.innerHTML = [
    inspectorFact("Session ID", snapshot.sessionId),
    inspectorFact("Created", formatDate(snapshot.createdAt)),
    inspectorFact("Updated", formatDate(snapshot.updatedAt)),
    inspectorFact("Input tokens", usage?.inputTokens ?? "—"),
    inspectorFact("Output tokens", usage?.outputTokens ?? "—"),
    inspectorFact("Reasoning tokens", usage?.reasoningTokens ?? "—"),
    inspectorFact("Model calls", activity.modelCalls),
    inspectorFact("Tool calls", activity.toolCalls),
    inspectorFact("Skills loaded", activity.skillsLoaded),
    inspectorFact("Pending actions", snapshot.pendingClientActions.length),
    inspectorFact("Metadata", JSON.stringify(snapshot.metadata, null, 2), true),
  ].join("");
  const trace = executionTraceFromEvents(events);
  element.sessionTimeline.innerHTML = trace.length
    ? trace.map(traceCard).join("")
    : '<div class="empty">No execution events.</div>';
  state.rawEvents = JSON.stringify(events, null, 2);
  element.rawEvents.textContent = state.rawEvents;
  renderLiveTrace(events);
  element.liveSection.classList.remove("hidden");
  element.liveSessionLabel.textContent = shortId(snapshot.sessionId);
  renderRunStatus(snapshot.runStatus || "");
  state.evaluations = evaluationResultsFromEvents(events);
  element.evaluationSession.textContent =
    snapshot.name || shortId(snapshot.sessionId);
  renderEvaluationResults();
  renderInspectorEvaluations();
  showSessionInspector();
  if (snapshot.runStatus === "waiting_for_client_action") {
    showClientActions(snapshot.pendingClientActions);
  } else {
    state.pendingCalls = [];
    element.clientActions.classList.add("hidden");
    element.runSection.classList.remove("hidden");
  }
}

function showSessionList() {
  element.sessionListPanel.classList.remove("hidden");
  element.sessionInspector.classList.add("hidden");
}

function showSessionsIndex() {
  element.sessionsIndex.classList.remove("hidden");
  element.sessionHistory.classList.add("hidden");
}

function showSessionInspector() {
  element.sessionListPanel.classList.add("hidden");
  element.sessionInspector.classList.remove("hidden");
}

function inspectorFact(label, value, multiline = false) {
  return `<div class="inspector-fact${multiline ? " multiline" : ""}">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
  </div>`;
}

function renderInspectorEvaluations() {
  const evaluations = state.evaluations || [];
  element.inspectorEvaluations.className = evaluations.length
    ? "inspector-evaluations"
    : "inspector-evaluations empty";
  element.inspectorEvaluations.innerHTML = evaluations.length
    ? evaluations.map((evaluation) => `
        <details class="inspector-evaluation ${escapeHtml(evaluation.status)}" open>
          <summary>
            <strong>${escapeHtml(evaluation.name)}${evaluation.run ? ` · run ${evaluation.run}` : ""}</strong>
            <span>${escapeHtml(evaluation.status)}</span>
          </summary>
          ${evaluation.error
            ? `<p class="evaluation-error">${escapeHtml(evaluation.error.message)}</p>`
            : (evaluation.metrics || []).map((metric) => `
                <div class="inspector-metric">
                  <div>
                    <strong>${escapeHtml(metric.name)}</strong>
                    <span>${Number(metric.score).toFixed(2)} / ${Number(metric.threshold).toFixed(2)}</span>
                  </div>
                  <p>${escapeHtml(metric.reasoning)}</p>
                </div>`).join("")}
        </details>`).join("")
    : "No evaluation results were recorded for this session.";
}

function renderInspectorChildren() {
  const children = state.children || [];
  element.inspectorChildren.className = children.length
    ? "inspector-evaluations"
    : "inspector-evaluations empty";
  element.inspectorChildren.innerHTML = children.length
    ? children.map((child) => `
        <button class="center-session-card child-session-card" data-child-session="${escapeHtml(child.sessionId)}">
          <span>
            <strong>${escapeHtml(child.agent || "Subagent")}</strong>
            <code>${escapeHtml(shortId(child.sessionId))}</code>
          </span>
          <span class="status ${escapeHtml(child.runStatus || child.status)}">${escapeHtml(child.runStatus || child.status)}</span>
        </button>`).join("")
    : "No child sessions were created by this session.";
  for (const button of element.inspectorChildren.querySelectorAll("[data-child-session]")) {
    button.addEventListener("click", () =>
      selectChildSession(button.dataset.childSession),
    );
  }
}

async function selectChildSession(childSessionId) {
  const agentName = state.agent?.name;
  if (!agentName) return;
  try {
    const agent = encodeURIComponent(agentName);
    const child = encodeURIComponent(childSessionId);
    const history = await requestJson(
      `/api/agents/${agent}/children/${child}/history?pageSize=100`,
    );
    renderChildHistory(history);
    element.resumeSession.classList.add("hidden");
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderChildHistory(history) {
  const title = history.name || `${history.agent} subagent`;
  element.sessionTitle.textContent = title;
  element.inspectorTitle.textContent = title;
  element.inspectorStatus.textContent = history.runStatus || history.status;
  element.inspectorStatus.className =
    `status ${history.runStatus || history.status}`;
  element.sessionSummary.innerHTML = [
    inspectorFact("Child session ID", history.sessionId),
    inspectorFact("Agent", history.agent),
    inspectorFact("Parent session", history.lineage?.parentSessionId || "—"),
    inspectorFact("Created", formatDate(history.createdAt)),
    inspectorFact("Updated", formatDate(history.updatedAt)),
    inspectorFact("Input tokens", history.usage?.inputTokens ?? "—"),
    inspectorFact("Output tokens", history.usage?.outputTokens ?? "—"),
    inspectorFact("Reasoning tokens", history.usage?.reasoningTokens ?? "—"),
  ].join("");
  element.sessionTimeline.innerHTML = history.items.length
    ? history.items.map(historyCard).join("")
    : '<div class="empty">No projected history.</div>';
  state.rawEvents = JSON.stringify(history, null, 2);
  element.rawEvents.textContent = state.rawEvents;
  element.liveSection.classList.add("hidden");
  state.evaluations = history.items
    .filter((item) => item.type === "evaluation")
    .map((item) => ({
      name: item.name,
      status: item.status === "completed" ? "passed" : "failed",
      metrics: item.metrics || [],
      durationMs: item.durationMs,
    }));
  renderEvaluationResults();
  renderInspectorEvaluations();
  element.inspectorChildren.className = "inspector-evaluations empty";
  element.inspectorChildren.textContent =
    "Nested subagents are not available; delegation depth is limited to one.";
  showSessionInspector();
}

function historyCard(item) {
  return traceCard({
    type: item.type,
    label:
      item.type === "message"
        ? item.role === "user" ? "Input" : "Output"
        : item.type.replace("_", " "),
    title: item.name,
    status: item.status,
    content: item.content ? contentText(item.content) : item.summary,
    fields: [
      ...(item.childSessionId ? [["Child session", item.childSessionId]] : []),
      ...(typeof item.durationMs === "number"
        ? [["Duration", `${item.durationMs}ms`]]
        : []),
    ],
  });
}

async function refreshLiveTrace(sessionId) {
  const agentName = state.agent?.name;
  if (!agentName) return;
  const agent = encodeURIComponent(agentName);
  const session = encodeURIComponent(sessionId);
  const data = await requestJson(
    `/api/agents/${agent}/sessions/${session}/events`,
  );
  if (
    state.agent?.name !== agentName ||
    state.sessionId !== sessionId
  ) {
    return;
  }
  renderLiveTrace(data.events);
}

function renderLiveTrace(events) {
  const trace = executionTraceFromEvents(events);
  element.liveTimeline.replaceChildren();
  for (const item of trace) {
    addLiveMessage(item.type, item.value);
  }
}

function executionTraceFromEvents(events) {
  const trace = [];
  const actionCalls = new Map();
  const internalSkillCalls = new Set();
  for (const event of events) {
    if (event.type === "run.started") {
      trace.push({
        type: "run",
        label: "Run started",
        status: event.data.status,
        fields: [
          ["Run", event.run],
          ["Provider", event.data.provider],
          ["Model", event.data.model],
        ],
      });
    }
    if (event.type === "message.created" && event.data.role === "user") {
      trace.push({
        type: "input",
        label: "Input",
        content: contentText(event.data.content),
      });
    }
    if (event.type === "message.created" && event.data.role === "assistant") {
      const assistantContent = event.data.content || [];
      const hasReasoningText = assistantContent.some(
        (block) =>
          block.type === "reasoning" &&
          typeof block.text === "string" &&
          block.text.trim(),
      );
      if (
        !hasReasoningText &&
        event.data.usage?.reasoningTokens > 0
      ) {
        trace.push({
          type: "reasoning",
          label: "Reasoning",
          content: `${event.data.provider || "The provider"} returned no displayable reasoning summary.`,
          fields: [["Tokens used", event.data.usage.reasoningTokens]],
        });
      }
      for (const block of assistantContent) {
        if (block.type === "reasoning") {
          if (typeof block.text === "string" && block.text.trim()) {
            trace.push({
              type: "reasoning",
              label: "Reasoning",
              content: block.text,
              fields: typeof event.data.usage?.reasoningTokens === "number"
                ? [["Tokens used", event.data.usage?.reasoningTokens]]
                : [],
            });
          }
        } else if (block.type === "text") {
          trace.push({
            type: "output",
            label: "Output",
            content: formatStructuredText(block.text),
          });
        } else if (block.type === "tool_call") {
          if (block.name === "load_skill") {
            internalSkillCalls.add(block.callId);
            continue;
          }
          actionCalls.set(block.callId, {
            name: block.name,
            arguments: block.arguments,
          });
        }
      }
    }
    if (event.type === "action.requested") {
      const call = actionCalls.get(event.data.callId);
      trace.push({
        type: "action",
        label: "Action requested",
        title: event.data.name || call?.name,
        status: "running",
        fields: [["Execution", "local"]],
        sections: [[
          "Arguments",
          JSON.stringify(event.data.arguments ?? call?.arguments, null, 2),
        ]],
      });
    }
    if (event.type === "action.completed" || event.type === "action.failed") {
      const call = actionCalls.get(event.data.callId);
      trace.push({
        type: "action",
        label:
          event.type === "action.completed"
            ? "Action result"
            : "Action failed",
        title: event.data.name || call?.name,
        status:
          event.type === "action.completed" ? "completed" : "failed",
        fields: [
          ["Execution", "local"],
          ...(typeof event.data.durationMs === "number"
            ? [["Duration", `${event.data.durationMs}ms`]]
            : []),
        ],
        sections: [[
          event.type === "action.completed" ? "Result" : "Error",
          JSON.stringify(
            event.type === "action.completed"
              ? event.data.output
              : event.data.error,
            null,
            2,
          ),
        ]],
      });
    }
    if (event.type === "client_action.requested") {
      for (const call of event.data.calls || []) {
        actionCalls.set(call.callId, {
          name: call.name,
          arguments: call.arguments,
        });
        trace.push({
          type: "action",
          label: "Client action requested",
          title: call.name,
          status: "waiting",
          fields: [["Execution", "client"]],
          sections: [[
            "Arguments",
            JSON.stringify(call.arguments, null, 2),
          ]],
        });
      }
    }
    if (event.type === "client_action.resolved") {
      for (const result of event.data.results || []) {
        const call = actionCalls.get(result.callId);
        trace.push({
          type: "action",
          label: "Client action result",
          title: call?.name,
          status: result.isError === true ? "failed" : "completed",
          fields: [["Execution", "client"]],
          sections: [[
            result.isError === true ? "Error" : "Result",
            JSON.stringify(result.output, null, 2),
          ]],
        });
      }
    }
    if (event.type === "message.created" && event.data.role === "tool") {
      for (const result of event.data.content || []) {
        if (
          internalSkillCalls.has(result.callId) ||
          actionCalls.has(result.callId)
        ) {
          continue;
        }
        trace.push({
          type: "action",
          label: "Action result",
          status: result.isError === true ? "failed" : "completed",
          sections: [[
            result.isError === true ? "Error" : "Result",
            JSON.stringify(result.output, null, 2),
          ]],
        });
      }
    }
    if (event.type === "skill.loaded" || event.type === "skill.failed") {
      const skill = state.agent?.skills.find(
        (candidate) => candidate.name === event.data.name,
      );
      trace.push({
        type: "skill",
        label: "Skill",
        title: event.data.name,
        status: event.type === "skill.loaded" ? "loaded" : "failed",
        content: skill?.instructions,
      });
    }
    if (event.type === "subagent.initiated") {
      trace.push({
        type: "action",
        label: "Subagent initiated",
        title: event.data.agent,
        status: event.data.status,
        fields: [
          ["Session", event.data.sessionId],
          ["Call", event.data.callId],
        ],
      });
    }
    if (event.type === "subagent.resumed") {
      trace.push({
        type: "action",
        label: "Subagent resumed",
        title: event.data.agent,
        status: event.data.status,
        fields: [
          ["Session", event.data.sessionId],
          ["Call", event.data.callId],
        ],
      });
    }
    if (
      event.type === "subagent.completed" ||
      event.type === "subagent.paused" ||
      event.type === "subagent.failed"
    ) {
      trace.push({
        type: "action",
        label: event.type.replace(".", " "),
        title: event.data.agent,
        status: event.data.status,
        fields: [["Session", event.data.sessionId]],
        sections: [[
          event.data.error ? "Error" : "Result",
          JSON.stringify(event.data.error || event.data.output, null, 2),
        ]],
      });
    }
    if (
      event.type === "run.completed" ||
      event.type === "run.paused" ||
      event.type === "run.failed"
    ) {
      trace.push({
        type: "run",
        label: event.type.replace(".", " "),
        status: event.data.status,
        fields: [
          ...(typeof event.data.durationMs === "number"
            ? [["Duration", `${event.data.durationMs}ms`]]
            : []),
        ],
        sections: event.data.usage
          ? [["Usage", JSON.stringify(event.data.usage, null, 2)]]
          : [],
      });
    }
    if (event.type === "test.completed") {
      trace.push({
        type: "test",
        label: "Test completed",
        title: event.data.test,
        status: event.data.status,
        fields: [
          ["Suite", event.data.suiteId],
          ...(typeof event.data.durationMs === "number"
            ? [["Duration", `${event.data.durationMs}ms`]]
            : []),
        ],
        sections: Array.isArray(event.data.assertions)
          ? [["Assertions", JSON.stringify(event.data.assertions, null, 2)]]
          : [],
      });
    }
  }
  return trace;
}

function sessionActivityStats(events) {
  let modelCalls = 0;
  let toolCalls = 0;
  let skillsLoaded = 0;
  for (const event of events) {
    if (event.type === "message.created" && event.data.role === "assistant") {
      modelCalls += 1;
      toolCalls += (event.data.content || []).filter(
        (block) =>
          block.type === "tool_call" &&
          block.name !== "load_skill",
      ).length;
    }
    if (event.type === "skill.loaded" && event.data.alreadyLoaded !== true) {
      skillsLoaded += 1;
    }
  }
  return { modelCalls, toolCalls, skillsLoaded };
}

function traceCard(item) {
  return `<article class="message ${escapeHtml(item.type)}">
    <header class="event-heading">
      <span>${escapeHtml(item.label || item.type)}</span>
      ${item.status ? `<strong>${escapeHtml(item.status)}</strong>` : ""}
    </header>
    ${item.title ? `<div class="event-title">${escapeHtml(item.title)}</div>` : ""}
    ${item.fields?.length ? `<dl class="event-fields">${item.fields.map(([name, value]) => `
      <div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value ?? "—")}</dd></div>`).join("")}</dl>` : ""}
    ${item.content ? `<div class="event-content">${escapeHtml(item.content)}</div>` : ""}
    ${item.sections?.map(([name, value]) => `
      <div class="event-section">
        <span>${escapeHtml(name)}</span>
        <pre>${escapeHtml(value)}</pre>
      </div>`).join("") || ""}
  </article>`;
}

function addLiveMessage(role, text) {
  const displayRole =
    role === "user" ? "input" : role === "assistant" ? "output" : role;
  const message = document.createElement("div");
  message.className = `message ${displayRole}`;
  message.innerHTML = `
    <header class="event-heading"><span>${escapeHtml(displayRole)}</span></header>
    <div class="event-content"></div>`;
  message.querySelector(".event-content").textContent = text;
  element.liveTimeline.append(message);
  return message;
}

function upsertLiveAssistant(message, text) {
  const target = message || addLiveMessage("output", "");
  target.querySelector(".event-content").textContent = text;
  return target;
}

function setRunning(running) {
  state.running = running;
  element.runButton.disabled = running;
  element.runButton.textContent = running ? "Running…" : "Try agent";
}

function renderRunStatus(status) {
  element.runStatus.className = `status ${status}`;
  element.runStatus.innerHTML = status === "running"
    ? '<span class="status-spinner" aria-hidden="true"></span><span>running</span>'
    : escapeHtml(status);
}

async function requestJson(url, options) {
  return (await ensureResponse(await fetch(url, options))).json();
}

async function ensureResponse(response) {
  if (response.ok) return response;
  let message = `Request failed with ${response.status}.`;
  try { message = (await response.json()).error || message; } catch {}
  throw new Error(message);
}

async function* readNdjson(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
    if (done) {
      if (buffer.trim()) yield JSON.parse(buffer);
      return;
    }
  }
}

function capability(name, description, type, metadata, details) {
  return `<details class="capability-card">
    <summary>
      <span class="capability-summary">
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(description)}</span>
      </span>
      <span class="type ${escapeHtml(type)}">${escapeHtml(type)}</span>
    </summary>
    <div class="capability-details">
      <div class="meta">${escapeHtml(metadata)}</div>
      ${details === undefined
        ? ""
        : typeof details === "string"
          ? `<div class="instruction-detail"><span class="overline">Instructions</span><pre>${escapeHtml(details)}</pre></div>`
          : `<pre class="detail-json">${escapeHtml(JSON.stringify(details, null, 2))}</pre>`}
    </div>
  </details>`;
}

function configuration(name, value) {
  return `<div class="configuration-item"><span>${escapeHtml(name)}</span><strong title="${escapeHtml(String(value))}">${escapeHtml(String(value))}</strong></div>`;
}

function badge(value) {
  return `<span class="badge">${escapeHtml(value)}</span>`;
}

function schemaSummary(schema) {
  const required = schema?.required || [];
  return required.length ? `Requires ${required.join(", ")}` : "No required arguments";
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return outputText(content);
  if (content.some((item) => item.type !== "text")) {
    return JSON.stringify(content, null, 2);
  }
  return content.map((item) =>
    item.text,
  ).join("\n");
}

function outputText(output) {
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

function formatStructuredText(text) {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null
      ? JSON.stringify(value, null, 2)
      : text;
  } catch {
    return text;
  }
}

function evaluationResultsFromEvents(events) {
  return events.flatMap((event) =>
    event.type === "evaluation.completed" ||
    event.type === "evaluation.failed"
      ? [{ ...event.data, run: event.run }]
      : [],
  );
}

function shortId(value) {
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "";
}

function relativeDate(value) {
  const timestamp = new Date(value).getTime();
  const delta = Date.now() - timestamp;
  if (!Number.isFinite(timestamp)) return "";
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 604_800_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(value).toLocaleDateString();
}

function camel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let toastTimer;
function showToast(message, error = false) {
  clearTimeout(toastTimer);
  element.toast.textContent = message;
  element.toast.className = `toast visible${error ? " error" : ""}`;
  toastTimer = setTimeout(() => {
    element.toast.className = "toast";
  }, 3500);
}
