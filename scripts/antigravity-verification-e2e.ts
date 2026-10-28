// Checks that a Google account-verification answer from Antigravity fails the turn as an
// authentication state instead of landing in the chat as the assistant's reply (#2419). Runs the
// real agent service on a temporary profile with a fake Antigravity ACP server. A prompt that
// names `verify-account` is answered with Google's verification text - a sign-in link on
// `accounts.google.com/signin/continue` that continues to the Gemini Code Assist success page -
// once with the target percent-encoded, as Google sends it, and once in plain form. Both turns
// must fail with `error.provider.geminiVerificationRequired`, neither text may be stored as an
// assistant message, and a later ordinary prompt must complete, because the user verifies in the
// browser and simply sends the message again.
// `bun scripts/antigravity-verification-e2e.ts`. Writes
// .openbot-build/antigravity-verification-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_PROVIDERS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-verification-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-verification-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const install = join(root, "antigravity");
const fakeAgy = join(install, "bin", "agy_acp_server");
const logPath = join(root, "agy.jsonl");

// Before the service modules load: the stores read the home folder.
process.env.HOME = home;
process.env.OPENBOT_ANTIGRAVITY_PATH = fakeAgy;
process.env.FAKE_AGY_LOG = logPath;
mkdirSync(home, { recursive: true });

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

/** Google's verification answer, with the continue target as Google encodes it. */
const VERIFICATION_ENCODED = [
  "Verify your account to continue.",
  "",
  "To continue, verify your Google account: https://accounts.google.com/signin/continue?prompt=consent&continue=https%3A%2F%2Fdevelopers.google.com%2Fgemini-code-assist%2Fauth%2Fauth_success_gemini&flowName=GeneralOAuthFlow",
].join("\n");
/** The same answer with the continue target written out in plain form. */
const VERIFICATION_PLAIN =
  "Please verify your account: https://accounts.google.com/signin/continue?continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini";

/** An Antigravity ACP server with the methods that the service calls. */
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const log = (entry) => fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({ pid: process.pid, ...entry }) + NL);
log({ start: true });
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
const MODEL = "gemini-3-pro";
const setup = (sessionId) => ({ sessionId, models: { availableModels: [{ modelId: MODEL, name: "Gemini 3 Pro" }], currentModelId: MODEL } });
let sessions = 0;
function handle(message) {
  const params = message.params ?? {};
  if (message.method) log({ method: message.method, sessionId: params.sessionId ?? null });
  if (message.id === undefined) return;
  if (message.method === "initialize")
    return write({ id: message.id, result: { protocolVersion: 1, authMethods: [], agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } } });
  if (message.method === "session/new") return write({ id: message.id, result: setup("agy-" + process.pid + "-" + ++sessions) });
  if (message.method === "session/resume" || message.method === "session/load") return write({ id: message.id, result: setup(params.sessionId) });
  if (message.method === "session/prompt") {
    const text = params.prompt.map((block) => block.text ?? "").join("");
    const answer = text.includes("verify-account-plain")
      ? ${JSON.stringify(VERIFICATION_PLAIN)}
      : text.includes("verify-account")
        ? ${JSON.stringify(VERIFICATION_ENCODED)}
        : "Done.";
    write({ method: "session/update", params: { sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: answer } } } });
    return write({ id: message.id, result: { stopReason: "end_turn" } });
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

interface CaseReport {
  name: string;
  status: string | null;
  error: string | null;
  passed: boolean;
}

const report: { cases: CaseReport[]; verificationStored: number | null; passed: boolean; error?: string } = {
  cases: [],
  verificationStored: null,
  passed: false,
};

const unused = () => Effect.die(new Error("Not used by this check."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

/** Waits for a state of the service or of its database. */
async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

await mkdir(join(install, "bin"), { recursive: true });
await writeFile(join(install, "antigravity-package.json"), `${JSON.stringify({ version: "1.4.3" })}\n`);
await writeFile(fakeAgy, FAKE_AGY, { mode: 0o755 });
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "antigravity",
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "antigravity"),
});
let connection: DatabaseSync | null = null;
const sqlite = () => {
  connection ??= new DatabaseSync(database.path);
  return connection;
};
const closeReader = () => connection?.close();

const expectedError = sourceText("error.provider.geminiVerificationRequired");

/** Sends one message and records the delivery's final status and error. */
async function send(agentId: string, name: string, text: string, status: string, error: string | null): Promise<void> {
  const receipt = await runCauseEffect(agents.sendMessage({ agentId, text }));
  const deliveryId = receipt.deliveries[0]?.id;
  assert.ok(deliveryId, `${name}: no delivery`);
  const final = await waitFor(name, () => {
    const delivery = mailbox.getDelivery(deliveryId)?.delivery;
    return delivery && ["completed", "failed", "interrupted"].includes(delivery.status) ? delivery : null;
  });
  const result: CaseReport = { name, status: final.status, error: final.error ?? null, passed: false };
  report.cases.push(result);
  assert.equal(final.status, status, `${name}: the turn ${status === "failed" ? "fails" : "completes"}`);
  assert.equal(final.error ?? null, error, `${name}: the turn reports the verification message`);
  result.passed = true;
}

try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "Gemini verification",
      description: "Checks the Gemini account-verification answer.",
      avatarSeed: "gemini-verification",
      avatarHue: null,
      initialMessage: "Say hello.",
    }),
  );
  const threadId = await waitFor("the agent's own thread", () => store.list().find((a) => a.id === agent.id)?.threadId);
  await waitFor("the first turn to end", () =>
    agents
      .listQueue(agent.id)
      .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status)),
  );

  await send(agent.id, "verification answer, encoded link", "verify-account", "failed", expectedError);
  await send(agent.id, "verification answer, plain link", "verify-account-plain", "failed", expectedError);
  await send(agent.id, "answer after verification", "Say hello again.", "completed", null);

  const stored = sqlite()
    .prepare(
      "SELECT COUNT(*) AS count FROM projection_thread_messages WHERE thread_id = ? AND author = 'assistant' AND message_json LIKE '%auth_success_gemini%'",
    )
    .get(threadId);
  report.verificationStored = Number(stored?.count ?? -1);
  assert.equal(report.verificationStored, 0, "the verification text is not stored as an assistant message");
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  closeReader();
  database.close();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
}
