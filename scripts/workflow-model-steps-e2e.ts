// Runs workflow model steps end to end on the real Antigravity driver, ACP client, warm client and
// SQLite usage tables, with a fake server process that answers each prompt with text and token usage.
// Checks that two steps share one process and each starts its own session, that each session is
// closed after its step, that a new main client and a failed step each start a new process, that
// shutdown stops the process, and that the host usage report shows the tokens in the one Workflows
// row and not in an agent row.
// Also drives the agent workflow tools through discovery and the real workflow service and SQLite.
//
// Run: bun scripts/workflow-model-steps-e2e.ts
// Writes .openbot-build/workflow-model-steps-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentModelOption,
  analyticsRange,
  isAgentModel,
  isWorkflowDetail,
  WORKFLOWS_USAGE_ID,
  type WorkflowGraph,
} from "@openbot/contracts/ipc";
import { redactText, registerSecretValue } from "@openbot/logging";
import { Effect } from "effect";
import { ProfileClients } from "../src/backend/agent/profile-clients";
import { discoverTools, resolveDeferredTool } from "../src/backend/agent/tool-catalog";
import { workflowUsageObserver } from "../src/backend/agent/usage-collection";
import { WarmGenerations } from "../src/backend/agent/warm-generations";
import type { AgentClient } from "../src/backend/agent-client";
import type { AgentCliInfo } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { type DynamicToolCallParams, getArray, getRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { handleWorkflowTool } from "../src/backend/workflows/workflow-tools";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-model-steps-e2e");

// Logs each request with its process id. A prompt answers "ok" and 100 input, 10 output and 5
// thought tokens; a prompt with "FAIL" in it gets a JSON-RPC error.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
let sessions = 0;
function handle(message) {
  if (message.method) fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({
    pid: process.pid, method: message.method, sessionId: message.params && message.params.sessionId,
  }) + NL);
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    write({ id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    return;
  }
  if (message.method === "session/new") {
    write({ id: message.id, result: {
      sessionId: process.pid + "-" + ++sessions,
      models: { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" },
    } });
    return;
  }
  if (message.method === "session/prompt") {
    const text = message.params.prompt.map((block) => block.text).join("");
    if (text.includes("FAIL")) {
      write({ id: message.id, error: { code: -32603, message: "The fake model failed." } });
      return;
    }
    write({ method: "session/update", params: {
      sessionId: message.params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } },
    } });
    write({ id: message.id, result: { stopReason: "end_turn", usage: {
      inputTokens: 100, outputTokens: 10, thoughtTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 115,
    } } });
    return;
  }
  write({ id: message.id, result: {} });
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
setInterval(() => {}, 1000);
`;

interface LogEntry {
  pid: number;
  method: string;
  sessionId?: string;
}

interface Report {
  checks: string[];
  processes: number[][];
  usage?: unknown;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], processes: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

const root = await mkdtemp(join(tmpdir(), "openbot-workflow-model-steps-e2e-"));
const log = join(root, "agy.jsonl");
process.env.FAKE_AGY_LOG = log;
const database = new OpenBotDatabase(join(root, "profile"));
const clients: AgentClient[] = [];
let workflows: WorkflowsHandle | null = null;

async function readLog(): Promise<LogEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** The process of each step, in order, from the prompts in the log. */
async function promptProcesses(): Promise<number[]> {
  return (await readLog()).filter((entry) => entry.method === "session/prompt").map((entry) => entry.pid);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Waits for a process to end; `client.stop()` resolves before the kernel reaps it. */
async function ended(pid: number): Promise<boolean> {
  for (let tries = 0; tries < 200 && alive(pid); tries++) await new Promise((done) => setTimeout(done, 25));
  return !alive(pid);
}

try {
  await Effect.runPromise(database.initialize());
  const changed: string[] = [];
  let rearmed = 0;
  const store = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") });
  const runs = new WorkflowRunStore({ database });
  workflows = await Effect.runPromise(
    createWorkflows({
      store,
      runs,
      delivery: () => null,
      turnAnswer: () => null,
      sendHandoff: () => Effect.die(new Error("Creation must not start an agent step.")),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.die(new Error("Creation must not start a model step.")),
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.die(new Error("Creation must not post a message.")),
      changed: (id) => changed.push(id),
      rearm: () => {
        rearmed += 1;
      },
      timezone: () => "UTC",
    }),
  );
  const params = (tool: string, args: unknown): DynamicToolCallParams => ({
    namespace: "openbot",
    tool,
    arguments: args,
    threadId: "chat",
    turnId: "turn",
    callId: crypto.randomUUID(),
  });
  const discovered = discoverTools(params("tool_search", { query: "create workflow" }));
  check(
    "workflow creation is discoverable from chat",
    discovered.tools.some((tool) => tool.name === "openbot.create_workflow"),
  );
  const described = discoverTools(params("tool_describe", { names: ["openbot.create_workflow"] }));
  check(
    "workflow guidance explains routines and schedules",
    described.guidance?.some(
      (text) => text.includes("A routine is") && text.includes("schedule triggers become active"),
    ) === true,
  );
  let kindSchema = getRecord(described.tools[0], "inputSchema");
  for (const key of ["properties", "graph", "properties", "nodes", "items", "properties", "kind"])
    kindSchema = getRecord(kindSchema, key);
  const kinds = getArray(kindSchema, "enum");
  check(
    "workflow discovery offers supported node kinds",
    kinds.includes("agent") && kinds.includes("condition") && !kinds.includes("image") && !kinds.includes("asset"),
  );
  const call = async (name: string, args: unknown) => {
    const resolved = resolveDeferredTool(params("tool_call", { name: `openbot.${name}`, arguments: args }));
    assert.ok(resolved);
    const response = await runCauseEffect(
      handleWorkflowTool(resolved.tool, resolved.arguments, workflows, new Set(["research", "writer"]), redactText),
    );
    assert.ok(response);
    return { success: response.success, value: JSON.parse(response.contentItems[0]?.text ?? "null") };
  };
  check("the workflow list starts empty", (await call("list_workflows", {})).value.workflows.length === 0);
  const graph: WorkflowGraph = {
    nodes: [
      { id: "start", kind: "trigger", at: { x: 0, y: 0 }, fields: { trigger: "manual" } },
      {
        id: "research",
        kind: "agent",
        at: { x: 300, y: 0 },
        fields: { agentId: "research", task: "Read the sources." },
      },
      {
        id: "writer",
        kind: "agent",
        at: { x: 600, y: 0 },
        fields: { agentId: "writer", task: "Write a short report." },
      },
    ],
    edges: [
      { id: "first", from: "start", to: "research", type: "text" },
      { id: "second", from: "research", to: "writer", type: "text" },
    ],
    strokes: [],
  };
  const created = await call("create_workflow", { title: "Research report", graph });
  assert.ok(created.success && isWorkflowDetail(created.value));
  const workflowId = created.value.summary.id;
  check(
    "creation saves the full graph in SQLite",
    JSON.stringify(store.detail(workflowId)?.graph) === JSON.stringify(graph),
  );
  check("creation notifies clients and rearms the timer", changed.includes(workflowId) && rearmed === 1);
  check("creation does not start a run", runs.page(workflowId, undefined, 10).runs.length === 0);
  const listed = await call("list_workflows", {});
  check(
    "the saved workflow is listed",
    listed.value.workflows.some((workflow: { id: string }) => workflow.id === workflowId),
  );
  const read = await call("read_workflow", { workflowId });
  check(
    "the saved workflow can be read from chat",
    read.success &&
      isWorkflowDetail(read.value) &&
      read.value.summary.title === "Research report" &&
      read.value.graph.nodes.length === 3,
  );
  const missing = await call("read_workflow", { workflowId: "missing" });
  check(
    "a missing workflow gives a readable tool failure",
    !missing.success && typeof missing.value.error === "string",
  );

  const unsupportedGraphs: { title: string; graph: WorkflowGraph }[] = [
    {
      title: "Image step",
      graph: { nodes: [{ id: "step", kind: "image", at: { x: 0, y: 0 }, fields: {} }], edges: [], strokes: [] },
    },
    {
      title: "Asset step",
      graph: { nodes: [{ id: "step", kind: "asset", at: { x: 0, y: 0 }, fields: {} }], edges: [], strokes: [] },
    },
    {
      title: "Message trigger",
      graph: {
        nodes: [{ id: "step", kind: "trigger", at: { x: 0, y: 0 }, fields: { trigger: "message" } }],
        edges: [],
        strokes: [],
      },
    },
    {
      title: "File output",
      graph: {
        nodes: [{ id: "step", kind: "output", at: { x: 0, y: 0 }, fields: { target: "file" } }],
        edges: [],
        strokes: [],
      },
    },
  ];
  const refusedInputs = [
    ...unsupportedGraphs,
    { title: "   ", graph },
    { title: "Unknown agent", graph: { ...graph, nodes: [{ ...graph.nodes[1], fields: { agentId: "missing" } }] } },
    { title: "Dangling edge", graph: { ...graph, edges: [{ id: "bad", from: "start", to: "missing", type: "text" }] } },
    {
      title: "Invalid port",
      graph: { ...graph, edges: [{ id: "bad", from: "start", to: "research", type: "image" }] },
    },
    { title: "Duplicate node", graph: { ...graph, nodes: [...graph.nodes, graph.nodes[0]] } },
    { title: "Invalid coordinate", graph: { ...graph, nodes: [{ ...graph.nodes[0], at: { x: 2_000_000, y: 0 } }] } },
    { title: "Unexpected argument", graph, active: true },
    {
      title: "Invalid timezone",
      graph: {
        nodes: [
          {
            id: "timer",
            kind: "trigger",
            at: { x: 0, y: 0 },
            fields: { trigger: "schedule", timezone: "Invalid/Zone" },
            schedule: { kind: "daily", time: "09:00" },
          },
        ],
        edges: [],
        strokes: [],
      },
    },
  ];
  for (const input of refusedInputs) {
    const refused = await call("create_workflow", input);
    check(
      `creation refuses ${input.title.trim() || "an empty title"}`,
      !refused.success && typeof refused.value.error === "string",
    );
  }
  check(
    "refused requests save no partial workflow or change event",
    store.list().length === 1 && changed.length === 1 && rearmed === 1,
  );
  const scheduled = await call("create_workflow", {
    title: "Daily report",
    graph: {
      ...graph,
      nodes: [
        {
          ...graph.nodes[0],
          fields: { trigger: "schedule", timezone: "Europe/Prague" },
          schedule: { kind: "daily", time: "09:00" },
        },
        ...graph.nodes.slice(1),
      ],
    },
  });
  check(
    "scheduled creation returns its next occurrence",
    scheduled.success &&
      isWorkflowDetail(scheduled.value) &&
      scheduled.value.triggers.some((trigger) => trigger.type === "schedule" && trigger.nextDueAt !== null),
  );
  const once = await call("create_workflow", {
    title: "One-time report",
    graph: {
      ...graph,
      nodes: [
        {
          ...graph.nodes[0],
          fields: { trigger: "schedule", timezone: "UTC" },
          schedule: { kind: "once", date: "2035-01-02", time: "09:00" },
        },
        ...graph.nodes.slice(1),
      ],
    },
  });
  check(
    "one-time creation preserves the schedule and its due time",
    once.success &&
      isWorkflowDetail(once.value) &&
      once.value.graph.nodes[0]?.schedule?.kind === "once" &&
      once.value.triggers.some((trigger) => trigger.nextDueAt === "2035-01-02T09:00:00.000Z"),
  );
  const opaqueSecret = "fixture-opaque-credential-3580";
  const secrets = ["sk-ant-fixture3580abcdefgh1234567890", opaqueSecret];
  registerSecretValue(opaqueSecret);
  const secretText = secrets.join(" ");
  const secretGraph: WorkflowGraph = {
    nodes: [{ id: "prompt", kind: "prompt", at: { x: 0, y: 0 }, fields: { text: secretText } }],
    edges: [],
    strokes: [],
  };
  const original = await runCauseEffect(workflows.create({ title: secretText, graph: secretGraph }));
  const safeRead = await call("read_workflow", { workflowId: original.summary.id });
  check(
    "reading a saved workflow redacts its title and graph",
    safeRead.success && secrets.every((secret) => !JSON.stringify(safeRead.value).includes(secret)),
  );
  const safeCreate = await call("create_workflow", { title: secretText, graph: secretGraph });
  check(
    "creation redacts the workflow returned to the provider",
    safeCreate.success && secrets.every((secret) => !JSON.stringify(safeCreate.value).includes(secret)),
  );
  const safeList = await call("list_workflows", {});
  check(
    "listing workflows redacts saved titles",
    safeList.success && secrets.every((secret) => !JSON.stringify(safeList.value).includes(secret)),
  );
  check(
    "tool redaction keeps the saved workflow unchanged",
    store.detail(original.summary.id)?.summary.title === secretText &&
      JSON.stringify(store.detail(original.summary.id)?.graph) === JSON.stringify(secretGraph) &&
      store.detail(safeCreate.value.summary.id)?.summary.title === secretText &&
      JSON.stringify(store.detail(safeCreate.value.summary.id)?.graph) === JSON.stringify(secretGraph),
  );
  const unsafeAgent = await call("create_workflow", {
    title: "Unknown agent with a secret",
    graph: {
      nodes: [{ id: "agent", kind: "agent", at: { x: 0, y: 0 }, fields: { agentId: secretText } }],
      edges: [],
      strokes: [],
    },
  });
  check(
    "workflow failures redact unknown agent values",
    !unsafeAgent.success && secrets.every((secret) => !JSON.stringify(unsafeAgent.value).includes(secret)),
  );
  const unsafeArgument = await call("read_workflow", { workflowId, [secretText]: true });
  check(
    "workflow validation failures redact rejected keys",
    !unsafeArgument.success && secrets.every((secret) => !JSON.stringify(unsafeArgument.value).includes(secret)),
  );

  const unavailable = await runCauseEffect(
    handleWorkflowTool("create_workflow", { title: "No host", graph }, null, new Set(), redactText),
  );
  check("an unavailable service gives a readable tool failure", unavailable?.success === false);
  const unrelated = await runCauseEffect(handleWorkflowTool("create_routine", {}, workflows, new Set(), redactText));
  check("routine tools stay with their own handler", unrelated === null);
  await runCauseEffect(workflows.close());
  workflows = null;

  const executable = join(root, "agy", "bin", "agy_acp_server");
  await mkdir(join(root, "agy", "bin"), { recursive: true });
  await writeFile(executable, FAKE_AGY);
  await chmod(executable, 0o755);
  const cli: AgentCliInfo = { executable, version: "1.4.1", source: "managed" };
  const driver = requireProviderDriver("antigravity");
  const modelId = "gemini-fake";
  assert.ok(isAgentModel(modelId));
  const model: AgentModelOption = {
    provider: "antigravity",
    id: modelId,
    name: "Gemini Fake",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  };

  // The main client only stands for the provider's settings: a new one means new settings.
  let owner: AgentClient = driver.createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  const profileClients = new ProfileClients();
  const warm = new WarmGenerations({
    ownerFor: () => owner,
    createClient: () => {
      const client = (driver.createProfileClient ?? driver.createClient)(cli, 10_000, NO_PROVIDER_CREDENTIALS);
      clients.push(client);
      return client;
    },
    profileClients,
  });
  const step = (prompt: string) =>
    runCauseEffect(
      warm.generate("antigravity", model, prompt, workflowUsageObserver(database.usage, "antigravity", modelId)),
    );

  // 1. Two steps share one process, and each starts and closes its own session.
  check("the first step answers", (await step("Say ok.")) === "ok");
  check("the second step answers", (await step("Say ok again.")) === "ok");
  const first = await promptProcesses();
  report.processes.push(first);
  check("two steps run on one process", first.length === 2 && first[0] === first[1], first);
  const entries = await readLog();
  const prompted = entries.filter((entry) => entry.method === "session/prompt").map((entry) => entry.sessionId);
  check("each step starts its own session", new Set(prompted).size === 2, prompted);
  const closed = entries.filter((entry) => entry.method === "session/close").map((entry) => entry.sessionId);
  check(
    "each session is closed after its step",
    prompted.every((sessionId) => closed.includes(sessionId)),
    { prompted, closed },
  );
  check(
    "the process starts once",
    entries.filter((entry) => entry.method === "initialize").length === 1,
    entries.map((entry) => entry.method),
  );

  // 2. A new main client means new settings: the next step starts a new process, and the old one ends.
  const firstPid = first[0] ?? 0;
  await runCauseEffect(warm.ownerStopped(owner));
  check("the old process ends when its main client stops", await ended(firstPid));
  owner = driver.createClient(cli, 10_000, NO_PROVIDER_CREDENTIALS);
  check("a step after a new main client answers", (await step("Say ok.")) === "ok");
  const second = await promptProcesses();
  const secondPid = second.at(-1) ?? 0;
  check("the step after a new main client runs on a new process", secondPid !== firstPid, second);

  // 3. A failed step stops its process, and the next step starts a new one.
  const failed = await runCauseEffect(
    warm.generate("antigravity", model, "FAIL", workflowUsageObserver(database.usage, "antigravity", modelId)),
  ).then(
    () => false,
    () => true,
  );
  check("a failed step fails", failed);
  check("a failed step stops its process", await ended(secondPid));
  check("a step after a failed step answers", (await step("Say ok.")) === "ok");
  const third = await promptProcesses();
  const thirdPid = third.at(-1) ?? 0;
  check("the step after a failed step runs on a new process", thirdPid !== secondPid, third);
  report.processes.push(second, third);

  // 4. Shutdown stops the warm process.
  await runCauseEffect(warm.dispose());
  check("shutdown stops the warm process", await ended(thirdPid));

  // 5. The usage of the four answered steps is in the Workflows row only.
  const usage = database.usage.readHost(analyticsRange(WORKFLOWS_USAGE_ID, 1));
  const all = database.usage.readHost((({ agentId: _agentId, ...range }) => range)(analyticsRange("", 1)));
  report.usage = { workflows: usage.totals, agents: all.agents, models: all.models };
  check(
    "the host report has one row, the Workflows row",
    all.agents.length === 1 && all.agents[0]?.agentId === WORKFLOWS_USAGE_ID,
    all.agents,
  );
  check(
    "the Workflows row counts the tokens of the four answered steps",
    usage.totals.uncachedInput === 400 && usage.totals.output === 60,
    usage.totals,
  );
  check(
    "the model row names the provider and the model",
    all.models.length === 1 && all.models[0]?.provider === "antigravity" && all.models[0]?.model === modelId,
    all.models,
  );

  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (workflows) await runCauseEffect(workflows.close());
  for (const client of clients) await runCauseEffect(client.stop()).catch(() => undefined);
  database.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
