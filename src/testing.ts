import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { build as bundleEntry } from "esbuild";
import { RuntimeAgent } from "./runtime/agent.js";
import { getOrchaRuntimeContext } from "./runtime/context.js";
import type { OrchaClient } from "./runtime/create-orcha.js";
import { SessionEventWriter } from "./runtime/session-events.js";
import { NodeJsonlSessionStore } from "./storage/node-jsonl.js";
import type {
  AgentRegistration,
  AgentRuntime,
  AgentTestActionConfiguration,
  AgentTestAssertionResult,
  AgentTestCaseConfiguration,
  AgentTestCaseReport,
  AgentTestCaseSummary,
  AgentTestRegistrations,
  AgentTestReport,
  AgentTestValueExpectation,
  CompiledAgentManifest,
  EvaluationResult,
  RunResult,
  RunTestsOptions,
  SessionEvent,
} from "./types.js";

interface DiscoveredTestCase {
  agent: string;
  name: string;
  configuration: AgentTestCaseConfiguration;
}

interface ActualActionCall {
  name: string;
  arguments: Record<string, unknown>;
}

export function defineTests<
  const Registrations extends AgentTestRegistrations,
>(registrations: Registrations): Registrations {
  return registrations;
}

export async function listTests(
  orcha: OrchaClient,
  options: RunTestsOptions = {},
): Promise<AgentTestCaseSummary[]> {
  const context = getOrchaRuntimeContext(orcha);
  const temporaryBuildDirectory = resolve(
    context.projectRoot,
    ".orcha/.test-build",
    `list_${randomUUID()}`,
  );
  const registryBuildDirectory = resolve(
    temporaryBuildDirectory,
    "registries",
  );
  try {
    const cases = await discoverTests(
      context.projectRoot,
      context.registrations,
      context.bundle.agents,
      options,
      registryBuildDirectory,
    );
    return cases.map((testCase) => ({
      agent: testCase.agent,
      name: testCase.name,
      description: testCase.configuration.description,
      configuration: testCase.configuration,
    }));
  } finally {
    await rm(temporaryBuildDirectory, {
      recursive: true,
      force: true,
    });
  }
}

export async function runTests(
  orcha: OrchaClient,
  options: RunTestsOptions = {},
): Promise<AgentTestReport> {
  const context = getOrchaRuntimeContext(orcha);
  const suiteId = `tst_${Date.now()}_${randomUUID()}`;
  const startedAt = performance.now();
  const registryBuildDirectory = resolve(
    context.projectRoot,
    ".orcha/.test-build",
    suiteId,
    "registries",
  );
  let cases: DiscoveredTestCase[];
  try {
    cases = await discoverTests(
      context.projectRoot,
      context.registrations,
      context.bundle.agents,
      options,
      registryBuildDirectory,
    );
  } finally {
    await rm(registryBuildDirectory, {
      recursive: true,
      force: true,
    });
  }
  const reports: AgentTestCaseReport[] = [];
  const storageDirectory =
    context.configuration.storage?.directory ?? ".orcha/sessions";
  for (const testCase of cases) {
    const manifest = context.bundle.agents[testCase.agent];
    const store = new NodeJsonlSessionStore(
      storageDirectory,
      context.projectRoot,
      manifest.key ?? manifest.name,
    );
    const agent = new RuntimeAgent({
      manifest: withSimulatedActions(manifest),
      configuration: context.configuration,
      store,
      activeSessions: new Set(),
      generateProviderResponse: context.generateProviderResponse,
      sessionIdPrefix: "ses_test_",
      projectRoot: context.projectRoot,
    });
    reports.push(
      await runTestCase(
        agent,
        store,
        testCase,
        suiteId,
        context.projectRoot,
        storageDirectory,
      ),
    );
  }

  const passed = reports.filter(
    (report) => report.status === "passed",
  ).length;
  return {
    suiteId,
    status: passed === reports.length ? "passed" : "failed",
    total: reports.length,
    passed,
    failed: reports.length - passed,
    durationMs: Math.round(performance.now() - startedAt),
    cases: reports,
  };
}

async function discoverTests(
  projectRoot: string,
  registrations: Record<string, AgentRegistration>,
  manifests: Record<string, CompiledAgentManifest>,
  options: RunTestsOptions,
  registryBuildDirectory: string,
): Promise<DiscoveredTestCase[]> {
  if (options.agent && !manifests[options.agent]) {
    throw new Error(`Unknown agent "${options.agent}".`);
  }

  const discovered: DiscoveredTestCase[] = [];
  const registryRoot = resolve(projectRoot, "orcha");
  for (const [agentName, registeredPath] of Object.entries(
    registrations,
  )) {
    if (options.agent && options.agent !== agentName) {
      continue;
    }
    const testsDirectory = resolve(
      registryRoot,
      typeof registeredPath === "string"
        ? registeredPath
        : registeredPath.path,
      "tests",
    );
    const registryPath = resolve(testsDirectory, "index.js");
    if (!existsSync(registryPath)) {
      continue;
    }

    const registrations = await loadTestRegistrations(
      registryPath,
      agentName,
      registryBuildDirectory,
    );
    for (const [testName, testPath] of Object.entries(
      registrations,
    )) {
      if (options.test && options.test !== testName) {
        continue;
      }
      const sourceDirectory = resolve(testsDirectory, testPath);
      assertInsideDirectory(
        testsDirectory,
        sourceDirectory,
        `Test "${agentName}/${testName}"`,
      );
      const configuration = await loadTestConfiguration(
        resolve(sourceDirectory, "index.json"),
        agentName,
        testName,
      );
      validateTestCase(
        agentName,
        testName,
        configuration,
        manifests[agentName],
      );
      discovered.push({
        agent: agentName,
        name: testName,
        configuration,
      });
    }
  }

  if (options.test && discovered.length === 0) {
    const scope = options.agent
      ? ` for agent "${options.agent}"`
      : "";
    throw new Error(
      `Unknown registered test "${options.test}"${scope}.`,
    );
  }
  return discovered;
}

async function loadTestRegistrations(
  registryPath: string,
  agentName: string,
  registryBuildDirectory: string,
): Promise<AgentTestRegistrations> {
  let loaded: unknown;
  const bundledRegistryPath = resolve(
    registryBuildDirectory,
    `${randomUUID()}.mjs`,
  );
  try {
    await mkdir(registryBuildDirectory, { recursive: true });
    await bundleEntry({
      entryPoints: [registryPath],
      outfile: bundledRegistryPath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      packages: "external",
      logLevel: "silent",
    });
    const module = (await import(
      `${pathToFileURL(bundledRegistryPath).href}?time=${Date.now()}`
    )) as { default?: unknown };
    loaded = module.default;
  } catch (error) {
    throw new Error(
      `Agent "${agentName}" has an invalid tests/index.js.`,
      { cause: error },
    );
  } finally {
    await rm(bundledRegistryPath, { force: true });
  }
  if (!isRecord(loaded)) {
    throw new Error(
      `Agent "${agentName}" tests/index.js must default export an object.`,
    );
  }

  const registrations: AgentTestRegistrations = {};
  for (const [name, path] of Object.entries(loaded)) {
    if (!name.trim()) {
      throw new Error(
        `Agent "${agentName}" has an empty registered test name.`,
      );
    }
    if (typeof path !== "string" || !path.trim()) {
      throw new Error(
        `Test "${agentName}/${name}" must register a folder path.`,
      );
    }
    registrations[name] = path;
  }
  return registrations;
}

async function loadTestConfiguration(
  path: string,
  agentName: string,
  testName: string,
): Promise<AgentTestCaseConfiguration> {
  try {
    return JSON.parse(
      await readFile(path, "utf8"),
    ) as AgentTestCaseConfiguration;
  } catch (error) {
    throw new Error(
      `Test "${agentName}/${testName}" is missing a valid index.json at ${path}.`,
      { cause: error },
    );
  }
}

function validateTestCase(
  agentName: string,
  testName: string,
  configuration: AgentTestCaseConfiguration,
  manifest: CompiledAgentManifest,
): void {
  const label = `Test "${agentName}/${testName}"`;
  if (!isRecord(configuration)) {
    throw new Error(`${label} configuration must be an object.`);
  }
  if (
    !isRecord(configuration.input) ||
    !("content" in configuration.input)
  ) {
    throw new Error(`${label} requires input.content.`);
  }
  if (!isRecord(configuration.actions)) {
    throw new Error(`${label} requires an actions object.`);
  }
  if (!isRecord(configuration.expect)) {
    throw new Error(`${label} requires an expect object.`);
  }

  const agentActions = Object.keys(manifest.actions).sort();
  const testActions = Object.keys(configuration.actions).sort();
  const missing = agentActions.filter(
    (name) => !testActions.includes(name),
  );
  const unknown = testActions.filter(
    (name) => !agentActions.includes(name),
  );
  if (missing.length > 0 || unknown.length > 0) {
    const details = [
      missing.length > 0
        ? `missing actions: ${missing.join(", ")}`
        : "",
      unknown.length > 0
        ? `unknown actions: ${unknown.join(", ")}`
        : "",
    ].filter(Boolean);
    throw new Error(
      `${label} actions must exactly match the agent actions (${details.join("; ")}).`,
    );
  }

  for (const [name, action] of Object.entries(
    configuration.actions,
  )) {
    validateTestAction(label, name, action);
  }
  validateExpectation(label, configuration.expect);
  const expectedActions = configuration.expect.actions;
  if (Array.isArray(expectedActions)) {
    for (const expectedAction of expectedActions) {
      if (!manifest.actions[expectedAction.name]) {
        throw new Error(
          `${label} expects unknown action "${expectedAction.name}".`,
        );
      }
    }
  }
}

function validateTestAction(
  label: string,
  name: string,
  action: AgentTestActionConfiguration,
): void {
  if (!isRecord(action) || !Array.isArray(action.responses)) {
    throw new Error(
      `${label} action "${name}" requires a responses array.`,
    );
  }
  for (const [index, response] of action.responses.entries()) {
    if (!isRecord(response) || !("output" in response)) {
      throw new Error(
        `${label} action "${name}" response ${index + 1} requires output.`,
      );
    }
  }
}

function validateExpectation(
  label: string,
  expectation: AgentTestCaseConfiguration["expect"],
): void {
  if (
    expectation.status !== undefined &&
    expectation.status !== "completed" &&
    expectation.status !== "failed"
  ) {
    throw new Error(`${label} has an invalid expected status.`);
  }
  if (expectation.output) {
    validateValueExpectation(
      label,
      "expect.output",
      expectation.output,
    );
  }
  if (expectation.text) {
    for (const field of ["contains", "excludes"] as const) {
      const values = expectation.text[field];
      if (
        values !== undefined &&
        (!Array.isArray(values) ||
          values.some((value) => typeof value !== "string"))
      ) {
        throw new Error(
          `${label} ${field} must be an array of strings.`,
        );
      }
    }
  }
  if (
    expectation.actions !== undefined &&
    !Array.isArray(expectation.actions)
  ) {
    throw new Error(`${label} expect.actions must be an array.`);
  }
  for (const [index, action] of (
    expectation.actions ?? []
  ).entries()) {
    if (!isRecord(action) || typeof action.name !== "string") {
      throw new Error(
        `${label} expected action ${index + 1} requires a name.`,
      );
    }
    if (action.arguments) {
      validateValueExpectation(
        label,
        `expect.actions[${index}].arguments`,
        action.arguments,
      );
    }
  }
}

function validateValueExpectation(
  label: string,
  path: string,
  expectation: AgentTestValueExpectation,
): void {
  if (!isRecord(expectation)) {
    throw new Error(`${label} ${path} must be an object.`);
  }
  const hasEquals = "equals" in expectation;
  const hasPartial = "partial" in expectation;
  if (hasEquals === hasPartial) {
    throw new Error(
      `${label} ${path} requires exactly one of equals or partial.`,
    );
  }
}

function withSimulatedActions(
  manifest: CompiledAgentManifest,
): CompiledAgentManifest {
  return {
    ...manifest,
    actions: Object.fromEntries(
      Object.entries(manifest.actions).map(([name, action]) => [
        name,
        {
          ...action,
          execution: "client" as const,
          source: undefined,
          sourceHash: undefined,
        },
      ]),
    ),
  };
}

async function runTestCase(
  agent: AgentRuntime,
  store: NodeJsonlSessionStore,
  testCase: DiscoveredTestCase,
  suiteId: string,
  projectRoot: string,
  storageDirectory: string,
): Promise<AgentTestCaseReport> {
  const startedAt = performance.now();
  const actionIndexes = new Map<string, number>();
  const actionNames = Object.keys(testCase.configuration.actions);
  let execution = agent.run({
    ...testCase.configuration.input,
    name: `${testCase.agent}/${testCase.name}`,
    metadata: {
      ...testCase.configuration.input.metadata,
      orchaTest: true,
      testAgent: testCase.agent,
      testCase: testCase.name,
    },
    clientCapabilities: actionNames,
  });
  let result: RunResult = await execution.result;
  let fixtureError: string | undefined;

  while (result.status === "waiting_for_client_action") {
    const toolResults = [];
    for (const call of result.clientToolCalls) {
      const action = testCase.configuration.actions[call.name];
      const index = actionIndexes.get(call.name) ?? 0;
      const response = action?.responses[index];
      if (!response) {
        fixtureError =
          `Action "${call.name}" has no configured response for call ${index + 1}.`;
        break;
      }
      actionIndexes.set(call.name, index + 1);
      toolResults.push({
        callId: call.callId,
        output: response.output,
        ...(response.isError === true ? { isError: true } : {}),
      });
    }
    if (fixtureError) {
      break;
    }
    execution = agent.resume(result.sessionId, {
      toolResults,
    });
    result = await execution.result;
  }

  const evaluations = await execution.evaluations;
  const events = await store.read(result.sessionId);
  const actualActions = actionCallsFromEvents(events);
  const assertions = evaluateAssertions(
    testCase.configuration,
    result,
    evaluations,
    actualActions,
  );
  if (fixtureError) {
    assertions.unshift({
      path: "actions",
      passed: false,
      message: fixtureError,
    });
  }
  const passed = assertions.every((assertion) => assertion.passed);

  const report: AgentTestCaseReport = {
    agent: testCase.agent,
    name: testCase.name,
    description: testCase.configuration.description,
    status: passed ? "passed" : "failed",
    sessionId: result.sessionId,
    sessionPath: relative(
      projectRoot,
      resolve(
        projectRoot,
        storageDirectory,
        testCase.agent,
        `${result.sessionId}.jsonl`,
      ),
    ),
    durationMs: Math.round(performance.now() - startedAt),
    ...("usage" in result && result.usage
      ? { usage: result.usage }
      : {}),
    ...(evaluations.length > 0
      ? { evaluations }
      : {}),
    assertions,
    ...(result.status === "failed"
      ? { error: result.error }
      : {}),
  };
  const writer = new SessionEventWriter(
    result.sessionId,
    events,
  );
  await store.append(result.sessionId, [
    writer.create(
      "test.completed",
      {
        suiteId,
        agent: report.agent,
        test: report.name,
        status: report.status,
        durationMs: report.durationMs,
        assertions: report.assertions,
        ...(report.usage ? { usage: report.usage } : {}),
        ...(report.evaluations
          ? { evaluations: report.evaluations }
          : {}),
        ...(report.error ? { error: report.error } : {}),
      },
      "session",
    ),
  ]);
  return report;
}

function actionCallsFromEvents(
  events: SessionEvent[],
): ActualActionCall[] {
  return events.flatMap((event) => {
    if (
      event.type !== "client_action.requested" ||
      !Array.isArray(event.data.calls)
    ) {
      return [];
    }
    return event.data.calls.flatMap((call) =>
      isRecord(call) &&
      typeof call.name === "string" &&
      isRecord(call.arguments)
        ? [
            {
              name: call.name,
              arguments: call.arguments,
            },
          ]
        : [],
    );
  });
}

function evaluateAssertions(
  configuration: AgentTestCaseConfiguration,
  result: RunResult,
  evaluations: EvaluationResult[],
  actualActions: ActualActionCall[],
): AgentTestAssertionResult[] {
  const assertions: AgentTestAssertionResult[] = [];
  const expectedStatus = configuration.expect.status ?? "completed";
  assertions.push(
    assertion(
      "status",
      result.status === expectedStatus,
      `Expected status "${expectedStatus}", received "${result.status}".`,
      expectedStatus,
      result.status,
    ),
  );
  if (result.status === "completed") {
    for (const evaluation of evaluations) {
      assertions.push(
        assertion(
          `evaluations.${evaluation.name}`,
          evaluation.status === "passed",
          evaluation.status === "error"
            ? `Evaluation "${evaluation.name}" failed to run: ${evaluation.error?.message ?? "Unknown error."}`
            : `Evaluation "${evaluation.name}" did not meet every metric threshold.`,
          "passed",
          evaluation.status,
        ),
      );
    }
  }

  if (configuration.expect.output) {
    const actual =
      result.status === "completed" ||
      result.status === "waiting_for_client_action"
        ? result.output
        : undefined;
    assertions.push(
      evaluateValue(
        "output",
        configuration.expect.output,
        actual,
      ),
    );
  }
  if (configuration.expect.text) {
    const actual =
      result.status === "completed" &&
      typeof result.output === "string"
        ? result.output
        : "";
    for (const value of configuration.expect.text.contains ?? []) {
      assertions.push(
        assertion(
          "text.contains",
          actual.includes(value),
          `Expected output text to contain ${JSON.stringify(value)}.`,
          value,
          actual,
        ),
      );
    }
    for (const value of configuration.expect.text.excludes ?? []) {
      assertions.push(
        assertion(
          "text.excludes",
          !actual.includes(value),
          `Expected output text not to contain ${JSON.stringify(value)}.`,
          value,
          actual,
        ),
      );
    }
  }
  if (configuration.expect.actions) {
    assertions.push(
      assertion(
        "actions.length",
        actualActions.length ===
          configuration.expect.actions.length,
        `Expected ${configuration.expect.actions.length} action calls, received ${actualActions.length}.`,
        configuration.expect.actions.length,
        actualActions.length,
      ),
    );
    for (const [
      index,
      expected,
    ] of configuration.expect.actions.entries()) {
      const actual = actualActions[index];
      assertions.push(
        assertion(
          `actions[${index}].name`,
          actual?.name === expected.name,
          `Expected action ${index + 1} to be "${expected.name}".`,
          expected.name,
          actual?.name,
        ),
      );
      if (expected.arguments) {
        assertions.push(
          evaluateValue(
            `actions[${index}].arguments`,
            expected.arguments,
            actual?.arguments,
          ),
        );
      }
    }
  }
  return assertions;
}

function evaluateValue(
  path: string,
  expectation: AgentTestValueExpectation,
  actual: unknown,
): AgentTestAssertionResult {
  if ("equals" in expectation) {
    return assertion(
      path,
      deepEqual(expectation.equals, actual),
      `Expected ${path} to equal the configured value.`,
      expectation.equals,
      actual,
    );
  }
  return assertion(
    path,
    deepPartial(expectation.partial, actual),
    `Expected ${path} to include the configured partial value.`,
    expectation.partial,
    actual,
  );
}

function assertion(
  path: string,
  passed: boolean,
  message: string,
  expected?: unknown,
  actual?: unknown,
): AgentTestAssertionResult {
  return {
    path,
    passed,
    message: passed ? "Passed." : message,
    ...(expected !== undefined ? { expected } : {}),
    ...(actual !== undefined ? { actual } : {}),
  };
}

function deepEqual(expected: unknown, actual: unknown): boolean {
  if (Object.is(expected, actual)) {
    return true;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return (
      expected.length === actual.length &&
      expected.every((item, index) =>
        deepEqual(item, actual[index]),
      )
    );
  }
  if (isRecord(expected) && isRecord(actual)) {
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);
    return (
      expectedKeys.length === actualKeys.length &&
      expectedKeys.every(
        (key) =>
          Object.hasOwn(actual, key) &&
          deepEqual(expected[key], actual[key]),
      )
    );
  }
  return false;
}

function deepPartial(expected: unknown, actual: unknown): boolean {
  if (isRecord(expected)) {
    return (
      isRecord(actual) &&
      Object.entries(expected).every(
        ([key, value]) =>
          Object.hasOwn(actual, key) &&
          deepPartial(value, actual[key]),
      )
    );
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.length <= actual.length &&
      expected.every((item, index) =>
        deepPartial(item, actual[index]),
      )
    );
  }
  return Object.is(expected, actual);
}

function assertInsideDirectory(
  parent: string,
  child: string,
  label: string,
): void {
  const path = relative(parent, child);
  if (
    path === ".." ||
    path.startsWith(`..${sep}`) ||
    isAbsolute(path)
  ) {
    throw new Error(`${label} path must stay inside its tests directory.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
