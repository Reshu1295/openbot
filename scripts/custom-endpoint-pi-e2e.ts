// Runs the real `endpoint` provider driver against a fake `pi` that loads the extension OpenBot gives
// it, as Pi does, and answers the RPC requests that a model list and a thread start make. No account
// or model request is used.
// Checks that with no endpoint the client starts no process and lists no model; that the extension
// registers each endpoint (OpenAI compatible, or Anthropic's Messages API on api.anthropic.com) with
// its key and headers as literals, and removes the variable that carried them; that no key is in the
// extension file; that the client lists only the endpoints' models, as `<endpointId>/<modelId>` named
// `<endpoint>/<model>`; and that a thread on `local/m1` selects Pi provider `local`, model `m1`.
// `bun run test:custom-endpoint-pi`. Writes .openbot-build/custom-endpoint-pi-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentClient } from "../src/backend/agent-client";
import type { CustomProviderConfig } from "../src/backend/custom-provider-config";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { getString, isRecord } from "../src/backend/protocol";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/custom-endpoint-pi-e2e");

// The fake Pi: loads the endpoint extension with a `pi` that records each registration, then serves
// the models of those registrations and one model of a provider the user signed in to in Pi itself.
const fakeSource = String.raw`
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
const [logPath, sessionFile] = process.argv.slice(2);
const log = (entry) => appendFileSync(logPath, JSON.stringify(entry) + "\n");
const args = process.argv.slice(4);
const registrations = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] !== "--extension") continue;
  const path = args[index + 1];
  if (basename(path) !== "endpoints.mjs") continue;
  const extension = await import(pathToFileURL(path).href);
  extension.default({ registerProvider: (id, config) => registrations.push({ id, config }) });
  log({ event: "extension", source: readFileSync(path, "utf8"), variableLeft: "OPENBOT_PI_ENDPOINTS" in process.env });
}
log({ event: "start", registrations });
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
const models = [
  ...registrations.flatMap(({ id, config }) =>
    config.models.map((model) => ({ provider: id, id: model.id, name: model.name, reasoning: model.reasoning }))),
  { provider: "openai", id: "gpt-own", name: "GPT Own", reasoning: false },
];
createInterface({ input: process.stdin })
  .on("close", () => process.exit(0))
  .on("line", (line) => {
    const message = JSON.parse(line);
    const reply = (data) => send({ type: "response", id: message.id, command: message.type, success: true, data });
    if (message.type === "set_model") log({ event: "set_model", provider: message.provider, modelId: message.modelId });
    if (message.type === "get_state") return reply({ sessionFile, thinkingLevel: "off" });
    if (message.type === "get_available_models") return reply({ models });
    if (["set_model", "switch_session", "set_thinking_level"].includes(message.type)) return reply({});
    send({ type: "response", id: message.id, command: message.type, success: false, error: "Not in the fake: " + message.type });
  });
`;

interface LogEntry {
  event: "extension" | "start" | "set_model";
  source?: string;
  variableLeft?: boolean;
  registrations?: { id: string; config: Registration }[];
  provider?: string;
  modelId?: string;
}

/** The config that the extension gives `pi.registerProvider`. */
interface Registration {
  baseUrl: string;
  api: string;
  apiKey: string;
  headers?: Record<string, string>;
  models: { id: string; name: string }[];
}

interface Report {
  passed: boolean;
  noEndpoint?: { models: number; spawned: boolean };
  registered?: Record<string, { baseUrl: string; api: string }>;
  models?: { id: string; name: string }[];
  thread?: { provider?: string; modelId?: string };
}

const KEY = "sk-$secret-key";
const HEADER = "org-$1";
const ANTHROPIC_KEY = "!anthropic-key";
const endpointsSaved: CustomProviderConfig[] = [
  {
    id: "local",
    name: "Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: null,
    models: [{ id: "m1", name: "M1" }],
    headers: [{ name: "X-Org", value: HEADER }],
  },
  {
    id: "anth",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1/",
    apiKey: ANTHROPIC_KEY,
    models: [{ id: "claude-x", name: "Claude X" }],
    headers: [],
  },
  {
    id: "hosted",
    name: "Hosted",
    baseUrl: "https://example.test/v1",
    apiKey: KEY,
    models: [{ id: "big", name: "Big" }],
    headers: [],
  },
  // An endpoint with no models is not registered: Pi would list a provider with nothing in it.
  { id: "empty", name: "Empty", baseUrl: "http://127.0.0.1:1/v1", apiKey: null, models: [], headers: [] },
];

const root = await mkdtemp(join(tmpdir(), "openbot-custom-endpoint-pi-"));
const logPath = join(root, "pi.jsonl");
const report: Report = { passed: false };
let endpoints: CustomProviderConfig[] = [];
let client: AgentClient | null = null;

const readLog = () => readJsonl<LogEntry>(logPath);

async function listModels(target: AgentClient): Promise<{ id: string; name: string }[]> {
  const listed = await runCauseEffect(target.request("model/list", {}, (value) => value));
  const data = isRecord(listed) && Array.isArray(listed.data) ? listed.data : [];
  return data.map((model) => ({ id: getString(model, "model") ?? "", name: getString(model, "displayName") ?? "" }));
}

try {
  const fake = join(root, "fake-pi.mjs");
  await writeFile(fake, fakeSource);
  const executable = join(root, "pi");
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(
    executable,
    `#!/bin/sh\nexec ${[process.execPath, fake, logPath, join(root, "session.jsonl")].map(quote).join(" ")} "$@"\n`,
  );
  await chmod(executable, 0o700);
  client = requireProviderDriver("endpoint").createClient({ executable, version: "fixture" }, 15_000, {
    ...NO_PROVIDER_CREDENTIALS,
    customProviders: () => endpoints,
  });
  client.start();

  // 1. No endpoint: no model, and Pi does not start.
  assert.deepEqual(await listModels(client), [], "With no endpoint the provider lists no model.");
  assert.equal((await readLog()).length, 0, "With no endpoint Pi does not start.");
  report.noEndpoint = { models: 0, spawned: false };

  // 2. The saved endpoints are registered as Pi providers, and only their models are listed.
  endpoints = endpointsSaved;
  const models = await listModels(client);
  assert.deepEqual(
    models,
    [
      { id: "local/m1", name: "Local/M1" },
      { id: "anth/claude-x", name: "Anthropic/Claude X" },
      { id: "hosted/big", name: "Hosted/Big" },
    ],
    "The provider lists each endpoint model as <endpointId>/<modelId>, and no model of Pi's own sign-in.",
  );
  const log = await readLog();
  const extension = log.find((entry) => entry.event === "extension");
  assert.ok(extension, "Pi loaded the endpoint extension.");
  assert.equal(extension.variableLeft, false, "The extension removes the variable that carries the endpoints.");
  for (const secret of [KEY, HEADER, ANTHROPIC_KEY]) {
    assert.ok(!extension.source?.includes(secret), "No key or header value is in the extension file.");
  }
  const registrations = new Map(
    (log.find((entry) => entry.event === "start")?.registrations ?? []).map((r) => [r.id, r.config]),
  );
  assert.deepEqual([...registrations.keys()], ["local", "anth", "hosted"], "An endpoint with no models is left out.");
  assert.deepEqual(
    registrations.get("local"),
    {
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai-completions",
      apiKey: "openbot-no-key",
      headers: { "X-Org": "org-$$1" },
      models: [
        {
          id: "m1",
          name: "M1",
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 16_384,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
    "A keyless local endpoint gets a placeholder key and its header, with `$` escaped.",
  );
  const anthropic = registrations.get("anth");
  assert.equal(anthropic?.baseUrl, "https://api.anthropic.com", "Anthropic's host uses the Messages API origin.");
  assert.equal(anthropic?.api, "anthropic-messages");
  assert.equal(anthropic?.apiKey, "$!anthropic-key", "A key that starts with `!` is a literal, not a command.");
  assert.deepEqual(anthropic?.headers, { "x-api-key": ANTHROPIC_KEY }, "A header reads `!` as a literal.");
  const hosted = registrations.get("hosted");
  assert.equal(hosted?.apiKey, "sk-$$secret-key", "A `$` in a key is a literal, not a variable.");
  assert.deepEqual(hosted?.headers, { Authorization: "Bearer sk-$$secret-key" }, "The saved key replaces Pi's own.");
  report.registered = Object.fromEntries(
    [...registrations].map(([id, config]) => [id, { baseUrl: config.baseUrl, api: config.api }]),
  );
  report.models = models;

  // 3. A thread on an endpoint model selects that Pi provider and model.
  await rm(logPath, { force: true });
  await runCauseEffect(client.request("thread/start", { cwd: root, model: "local/m1" }, (value) => value));
  const selected = (await readLog()).find((entry) => entry.event === "set_model");
  assert.deepEqual(
    { provider: selected?.provider, modelId: selected?.modelId },
    { provider: "local", modelId: "m1" },
    "A thread on local/m1 selects Pi provider local, model m1.",
  );
  report.thread = { provider: selected?.provider, modelId: selected?.modelId };
  report.passed = true;
} finally {
  if (client) await runCauseEffect(client.stop()).catch(() => undefined);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
