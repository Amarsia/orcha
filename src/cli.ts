#!/usr/bin/env node

import { existsSync, watch } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build as bundleEntry } from "esbuild";
import { AGENTS_MD } from "./cli-agents-template.js";
import { buildProject } from "./compiler/build-project.js";
import { loadProjectEnvironment } from "./env.js";
import { orcha } from "./orcha.js";
import type { OrchaClient } from "./orcha.js";
import { getOrchaRuntimeContext } from "./runtime/context.js";
import { sessionAgentDirectoryName } from "./storage/node-jsonl.js";
import { runTests } from "./testing.js";
import type {
  AgentInput,
  AgentRuntime,
  EvaluationResult,
  RunResult,
  SessionEvent,
  SessionHistory,
  ToolResult,
} from "./types.js";

const command = process.argv[2];
const commandArguments = process.argv.slice(3);
const projectRoot = process.cwd();

try {
  switch (command) {
    case "init":
      assertNoArguments(commandArguments, "init");
      await initializeProject(projectRoot);
      break;
    case "dev":
      assertNoArguments(commandArguments, "dev");
      await watchProject(projectRoot);
      break;
    case "run":
      await runAgent(projectRoot, commandArguments);
      break;
    case "test":
      await testAgents(projectRoot, commandArguments);
      break;
    case "build": {
      assertNoArguments(commandArguments, "build");
      loadProjectEnvironment(projectRoot);
      const outputPath = await buildProject({ projectRoot });
      console.log(`Built ${relative(projectRoot, outputPath)}`);
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      throw new Error(`Unknown command "${command}". Run "orcha --help".`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function initializeProject(projectRoot: string): Promise<void> {
  const files = new Map<string, string>([
    [
      "orcha/exampleAgent/index.json",
      `${JSON.stringify(
        {
          name: "Example Agent",
          description: "Answer general questions clearly and concisely.",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          region: "provider_managed",
          maxTokens: 10240,
          outputType: "text",
        },
        null,
        2,
      )}\n`,
    ],
    [
      "orcha/exampleAgent/instructions.md",
      "You are a concise and helpful assistant.\n",
    ],
    [
      "orcha/index.ts",
      [
        'import { orcha } from "orchajs";',
        "",
        "orcha.init({",
        "  providers: {",
        "    anthropic: process.env.ANTHROPIC_API_KEY ?? \"\",",
        "  },",
        "  agents: {",
        "    exampleAgent: \"./exampleAgent\",",
        "  },",
        "});",
        "",
      ].join("\n"),
    ],
    ["AGENTS.md", AGENTS_MD],
  ]);

  for (const [relativePath, contents] of files) {
    const path = resolve(projectRoot, relativePath);
    if (existsSync(path)) {
      console.log(`Skipped existing ${relativePath}`);
      continue;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
    console.log(`Created ${relativePath}`);
  }

  await ensureGitignore(projectRoot);
  console.log(
    '\nRun "orcha dev" to validate changes or "orcha run exampleAgent --input \\"Hello\\"" to execute the agent.',
  );
}

async function watchProject(projectRoot: string): Promise<void> {
  const registryDirectory = resolve(projectRoot, "orcha");
  if (!existsSync(registryDirectory)) {
    throw new Error('Missing "orcha/". Run "orcha init" first.');
  }

  let validating = false;
  let validateAgain = false;
  let timer: NodeJS.Timeout | undefined;
  const validate = async (): Promise<void> => {
    if (validating) {
      validateAgain = true;
      return;
    }
    validating = true;
    try {
      await loadProject(projectRoot);
      const agents = Object.keys(orcha.getCompiledBundle().agents);
      console.log(
        `[orcha] valid — ${agents.length} agent${agents.length === 1 ? "" : "s"}: ${agents.join(", ") || "none"}`,
      );
    } catch (error) {
      console.error(
        `[orcha] invalid — ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      validating = false;
      if (validateAgain) {
        validateAgain = false;
        void validate();
      }
    }
  };

  await validate();
  console.log("[orcha] watching orcha/**");
  const watcher = watch(
    registryDirectory,
    { recursive: true },
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => void validate(), 75);
    },
  );
  await new Promise<void>((resolveStop) => {
    const stop = (): void => {
      clearTimeout(timer);
      watcher.close();
      resolveStop();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function runAgent(
  projectRoot: string,
  arguments_: string[],
): Promise<void> {
  const parsed = parseArguments(arguments_, new Set([
    "--input",
    "--input-file",
    "--session",
    "--tool-results",
  ]));
  const agentName = parsed.positionals[0];
  if (!agentName || parsed.positionals.length > 1) {
    throw new Error(
      'Usage: orcha run <agent> (--input "…" | --input-file request.json) [--session <id>] [--json]',
    );
  }
  await loadProject(projectRoot);
  const agent = (orcha as OrchaClient)[agentName] as
    | AgentRuntime
    | undefined;
  if (!agent || !(agentName in orcha.getCompiledBundle().agents)) {
    throw new Error(`Unknown agent "${agentName}".`);
  }

  const sessionId = parsed.values.get("--session");
  const toolResultsPath = parsed.values.get("--tool-results");
  if (toolResultsPath && (
    parsed.values.has("--input") ||
    parsed.values.has("--input-file")
  )) {
    throw new Error(
      "--tool-results cannot be combined with --input or --input-file.",
    );
  }

  const previousSequence = sessionId
    ? (await agent.events(sessionId, { pageSize: 1 })).throughSequence
    : 0;
  let execution: ReturnType<AgentRuntime["run"]>;
  if (toolResultsPath) {
    if (!sessionId) {
      throw new Error("--tool-results requires --session.");
    }
    execution = agent.resume(sessionId, {
      toolResults: await readToolResults(
        resolve(projectRoot, toolResultsPath),
      ),
    });
  } else {
    const input = await readAgentInput(parsed, projectRoot);
    execution = sessionId
      ? agent.resume(sessionId, normalizeResumeInput(input))
      : agent.run(input);
  }
  const result = await execution.result;
  const evaluations = await execution.evaluations;
  if (parsed.flags.has("--json")) {
    console.log(JSON.stringify({ result, evaluations }));
  } else {
    await printExecutionTrace(
      projectRoot,
      agent,
      result.sessionId,
      previousSequence,
    );
    printRunResult(projectRoot, agentName, result, evaluations);
  }
  if (result.status === "failed") {
    process.exitCode = 1;
  }
}

async function testAgents(
  projectRoot: string,
  arguments_: string[],
): Promise<void> {
  const parsed = parseArguments(arguments_, new Set());
  if (parsed.positionals.length > 1) {
    throw new Error(
      "Usage: orcha test [agent | agent/test] [--json]",
    );
  }
  const selector = parsed.positionals[0];
  const [agent, test, extra] = selector?.split("/") ?? [];
  if (extra || (selector?.includes("/") && (!agent || !test))) {
    throw new Error(
      'Test selector must be an agent name or "agent/test".',
    );
  }
  await loadProject(projectRoot);
  const report = await runTests(orcha, {
    ...(agent ? { agent } : {}),
    ...(test ? { test } : {}),
  });
  if (parsed.flags.has("--json")) {
    console.log(JSON.stringify(report));
  } else {
    console.log(`Agent tests: ${report.passed}/${report.total} passed`);
    for (const testCase of report.cases) {
      const sessionLink = testCase.sessionPath
        ? `${testCase.sessionPath}:1`
        : testCase.sessionId;
      console.log(
        `${testCase.status === "passed" ? "PASS" : "FAIL"} ${testCase.agent}/${testCase.name} (${testCase.durationMs}ms) ${sessionLink}`,
      );
      for (const assertion of testCase.assertions) {
        if (!assertion.passed) {
          console.error(`  ${assertion.message}`);
        }
      }
    }
  }
  if (report.status === "failed") {
    process.exitCode = 1;
  }
}

async function loadProject(projectRoot: string): Promise<void> {
  loadProjectEnvironment(projectRoot);
  const registryPath = resolve(projectRoot, "orcha/index.ts");
  if (!existsSync(registryPath)) {
    throw new Error('Missing "orcha/index.ts". Run "orcha init" first.');
  }
  const temporaryDirectory = resolve(projectRoot, ".orcha/.cli");
  const bundlePath = resolve(
    temporaryDirectory,
    `registry-${process.pid}-${Date.now()}.mjs`,
  );
  await mkdir(temporaryDirectory, { recursive: true });
  try {
    const previousBundle = orcha.isInitialized()
      ? orcha.getCompiledBundle()
      : undefined;
    await bundleEntry({
      entryPoints: [registryPath],
      outfile: bundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node20",
      packages: "external",
      logLevel: "silent",
    });
    const previousRoot = process.env.ORCHA_PROJECT_ROOT;
    const previousCompiling = process.env.ORCHA_COMPILING;
    process.env.ORCHA_PROJECT_ROOT = projectRoot;
    process.env.ORCHA_COMPILING = "1";
    try {
      await import(
        `${pathToFileURL(bundlePath).href}?time=${Date.now()}`
      );
    } finally {
      restoreEnvironment("ORCHA_PROJECT_ROOT", previousRoot);
      restoreEnvironment("ORCHA_COMPILING", previousCompiling);
    }
    if (
      !orcha.isInitialized() ||
      orcha.getCompiledBundle() === previousBundle
    ) {
      throw new Error(
        '"orcha/index.ts" must call orcha.init({ providers, agents }).',
      );
    }
  } finally {
    await rm(bundlePath, { force: true });
  }
}

interface ParsedArguments {
  positionals: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

function parseArguments(
  arguments_: string[],
  valueOptions: Set<string>,
): ParsedArguments {
  const parsed: ParsedArguments = {
    positionals: [],
    flags: new Set(),
    values: new Map(),
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) {
      parsed.positionals.push(argument);
      continue;
    }
    if (argument === "--json") {
      parsed.flags.add(argument);
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new Error(`Unknown option "${argument}".`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option "${argument}" requires a value.`);
    }
    parsed.values.set(argument, value);
    index += 1;
  }
  return parsed;
}

async function readAgentInput(
  parsed: ParsedArguments,
  projectRoot: string,
): Promise<AgentInput | string> {
  const inline = parsed.values.get("--input");
  const inputFile = parsed.values.get("--input-file");
  if (inline && inputFile) {
    throw new Error("--input and --input-file cannot be combined.");
  }
  if (inline !== undefined) {
    return inline;
  }
  if (inputFile) {
    return parseInput(
      await readFile(resolve(projectRoot, inputFile), "utf8"),
    );
  }
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return parseInput(Buffer.concat(chunks).toString("utf8"));
  }
  throw new Error(
    'Provide --input, --input-file, or pipe input through stdin.',
  );
}

function parseInput(value: string): AgentInput | string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Agent input cannot be empty.");
  }
  if (!trimmed.startsWith("{")) {
    return trimmed;
  }
  const parsed: unknown = JSON.parse(trimmed);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("content" in parsed)
  ) {
    throw new Error('Structured input must be an object with "content".');
  }
  return parsed as AgentInput;
}

function normalizeResumeInput(
  input: AgentInput | string,
): string | { content: AgentInput["content"] } {
  return typeof input === "string"
    ? input
    : { content: input.content };
}

async function readToolResults(path: string): Promise<ToolResult[]> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const results =
    Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          "toolResults" in parsed &&
          Array.isArray(parsed.toolResults)
        ? parsed.toolResults
        : undefined;
  if (!results) {
    throw new Error(
      'Tool results must be an array or an object with "toolResults".',
    );
  }
  return results as ToolResult[];
}

function printRunResult(
  projectRoot: string,
  agentName: string,
  result: RunResult,
  evaluations: EvaluationResult[],
): void {
  console.log(JSON.stringify(result, null, 2));
  if (evaluations.length > 0) {
    console.log("Evaluations:");
    console.log(JSON.stringify(evaluations, null, 2));
  }
  console.log(
    `Session log: ${sessionLogPath(projectRoot, agentName, result.sessionId)}:1`,
  );
}

async function printExecutionTrace(
  projectRoot: string,
  agent: AgentRuntime,
  sessionId: string,
  afterSequence: number,
): Promise<void> {
  const events = await readAllEvents(agent, sessionId);
  const currentEvents = events.filter(
    (event) => event.sequence > afterSequence,
  );
  console.log("Execution trace:");
  for (const event of currentEvents) {
    const line = traceLine(event);
    if (line) {
      console.log(`  ${line}`);
    }
  }

  const children = new Map<string, string>();
  for (const event of events) {
    if (
      event.type === "subagent.initiated" &&
      typeof event.data.agent === "string" &&
      typeof event.data.sessionId === "string"
    ) {
      children.set(event.data.sessionId, event.data.agent);
    }
  }
  if (children.size === 0) {
    return;
  }

  console.log("Subagents:");
  for (const [childSessionId, childAgent] of children) {
    const history = await readAllSubagentHistory(agent, childSessionId);
    console.log(
      `  ${childAgent} — ${history.runStatus ?? history.status}`,
    );
    for (const item of history.items) {
      if (
        (item.type === "action" || item.type === "skill") &&
        item.name
      ) {
        console.log(
          `    ${item.type === "action" ? "Action" : "Skill"} ${item.name} — ${item.status ?? "completed"}${formatDuration(item.durationMs)}`,
        );
      }
    }
    console.log(
      `    Log: ${sessionLogPath(projectRoot, childAgent, childSessionId)}:1`,
    );
  }

}

async function readAllEvents(
  agent: AgentRuntime,
  sessionId: string,
): Promise<SessionEvent[]> {
  const first = await agent.events(sessionId, {
    page: 1,
    pageSize: 100,
  });
  const events = [...first.events];
  for (let page = 2; (page - 1) * 100 < first.total; page += 1) {
    const result = await agent.events(sessionId, {
      page,
      pageSize: 100,
      throughSequence: first.throughSequence,
    });
    events.unshift(...result.events);
  }
  return events;
}

async function readAllSubagentHistory(
  agent: AgentRuntime,
  childSessionId: string,
): Promise<SessionHistory> {
  const first = await agent.subagentHistory(childSessionId, {
    page: 1,
    pageSize: 100,
  });
  const items = [...first.items];
  for (let page = 2; (page - 1) * 100 < first.total; page += 1) {
    const result = await agent.subagentHistory(childSessionId, {
      page,
      pageSize: 100,
    });
    items.unshift(...result.items);
  }
  return { ...first, items };
}

function traceLine(event: SessionEvent): string | undefined {
  const name =
    typeof event.data.name === "string" ? event.data.name : undefined;
  const agent =
    typeof event.data.agent === "string" ? event.data.agent : undefined;
  switch (event.type) {
    case "run.started":
      return `Run ${event.run ?? ""} started (${String(event.data.provider)}/${String(event.data.model)}).`;
    case "skill.loaded":
      return `Skill ${name ?? "unknown"} loaded.`;
    case "evaluation.requested":
      return `Evaluation ${name ?? "unknown"} started.`;
    case "evaluation.completed":
      return `Evaluation ${name ?? "unknown"} completed${formatDuration(event.data.durationMs)}.`;
    case "evaluation.failed":
      return `Evaluation ${name ?? "unknown"} failed${formatDuration(event.data.durationMs)}.`;
    case "action.requested":
      return `Action ${name ?? "unknown"} started.`;
    case "action.completed":
      return `Action ${name ?? "unknown"} completed${formatDuration(event.data.durationMs)}.`;
    case "action.failed":
      return `Action ${name ?? "unknown"} failed${formatDuration(event.data.durationMs)}.`;
    case "subagent.initiated":
      return `Subagent ${agent ?? "unknown"} started.`;
    case "subagent.resumed":
      return `Subagent ${agent ?? "unknown"} resumed.`;
    case "subagent.completed":
      return `Subagent ${agent ?? "unknown"} completed.`;
    case "subagent.paused":
      return `Subagent ${agent ?? "unknown"} paused (${String(event.data.status)}).`;
    case "subagent.failed":
      return `Subagent ${agent ?? "unknown"} failed.`;
    case "client_action.requested":
      return `Waiting for ${clientActionNames(event)}.`;
    case "client_action.resolved":
      return "Client action resolved.";
    case "run.completed":
      return `Run completed${formatDuration(event.data.durationMs)}.`;
    case "run.paused":
      return `Run paused (${String(event.data.status)}).`;
    case "run.failed":
      return `Run failed: ${eventErrorMessage(event)}.`;
    default:
      return undefined;
  }
}

function clientActionNames(event: SessionEvent): string {
  if (!Array.isArray(event.data.calls)) {
    return "client action";
  }
  const names = event.data.calls
    .map((call) =>
      call &&
      typeof call === "object" &&
      "name" in call &&
      typeof call.name === "string"
        ? call.name
        : undefined,
    )
    .filter((name): name is string => name !== undefined);
  return names.length > 0 ? names.join(", ") : "client action";
}

function eventErrorMessage(event: SessionEvent): string {
  const error = event.data.error;
  return error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
    ? error.message
    : "unknown error";
}

function formatDuration(value: unknown): string {
  return typeof value === "number" ? ` (${value}ms)` : "";
}

function sessionLogPath(
  projectRoot: string,
  agentName: string,
  sessionId: string,
): string {
  return relative(
    projectRoot,
    resolve(
      projectRoot,
      getOrchaRuntimeContext(orcha).configuration.storage?.directory ??
        ".orcha/sessions",
      sessionAgentDirectoryName(agentName),
      `${sessionId}.jsonl`,
    ),
  );
}

function restoreEnvironment(
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function assertNoArguments(
  arguments_: string[],
  command: string,
): void {
  if (arguments_.length > 0) {
    throw new Error(`Usage: orcha ${command}`);
  }
}

async function ensureGitignore(projectRoot: string): Promise<void> {
  const path = resolve(projectRoot, ".gitignore");
  const entry = ".orcha/";
  const current = existsSync(path) ? await readFile(path, "utf8") : "";
  const entries = current.split(/\r?\n/).map((line) => line.trim());

  if (entries.includes(entry)) {
    return;
  }

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  await appendFile(path, `${prefix}${entry}\n`, "utf8");
  console.log("Updated .gitignore");
}

function printUsage(): void {
  console.log(
    [
      "Usage: orcha <command>",
      "",
      "Commands:",
      "  init                         Add Orcha to the current project",
      "  dev                          Validate and watch orcha/**",
      "  run <agent> [options]        Execute or resume an agent",
      "  test [agent | agent/test]    Run agent tests",
      "  build                        Build the production Orcha bundle",
      "",
      "Run and test support --json for machine-readable output.",
    ].join("\n"),
  );
}
