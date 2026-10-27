// Runs the real OpenCode driver against a fake `opencode acp` that fails the prompt as OpenCode 2.1.4
// does on a spent free model: `-32603` "Internal error: Free usage limit reached. …" with
// `provider.free-limit` in `data.errorName`. Checks that the failed turn names the free limit and its
// fix, that a model which fails with the same words and another kind keeps the provider's text, and
// that a channel lead on the spent model reports the free limit instead of "could not route".
// `bun run test:opencode-free-limit`. Writes .openbot-build/opencode-free-limit-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type AgentModelOption, isAgentModel } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result } from "effect";
import { generateTextWithoutTools } from "../src/backend/agent/profile-generation";
import { isPlanLimitDiagnostic, isUsageLimitDiagnostic } from "../src/backend/agent/provider-diagnostics";
import type { AgentClient } from "../src/backend/agent-client";
import { routingFailureText } from "../src/backend/channel-service";
import type { AgentCliInfo } from "../src/backend/cli";
import { NO_PROVIDER_CREDENTIALS, requireProviderDriver } from "../src/backend/provider-drivers";
import { installFakeAgent, runTurn, startThread, stopClients } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-free-limit-e2e");
const FREE_MODEL = "opencode/deepseek-v4.1-flash-free";
const OTHER_MODEL = "opencode/other-model";

interface Report {
  passed: boolean;
  turn?: { error: string };
  otherKind?: { error: string };
  routing?: { generation: string; channel: string | null; genericChannel: string | null };
}

const root = await mkdtemp(join(tmpdir(), "openbot-opencode-free-limit-e2e-"));
const report: Report = { passed: false };
const clients: AgentClient[] = [];

async function install(name: string, currentModel: string) {
  const executable = join(root, name, "bin", "opencode");
  await installFakeAgent(executable, "opencode-free-limit", { FAKE_CURRENT_MODEL: currentModel });
  const cli: AgentCliInfo = { executable, version: "2.1.4", source: "managed" };
  return { cli, driver: requireProviderDriver("opencode") };
}

try {
  const workspace = join(root, "workspace");
  await mkdir(workspace);

  // 1. A spent free model fails the turn with the free limit and its way out.
  const free = await install("free", FREE_MODEL);
  const client = free.driver.createClient(free.cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(client);
  client.start();
  const turn = await runTurn(client, await startThread(client, { cwd: workspace }));
  assert.equal(turn.error, sourceText("error.provider.opencodeFreeLimit"), "A spent free model names the free limit.");
  // A chat turn reads the text for a usage limit and for a plan window that resets. The new text keeps
  // the first and not the second, as the provider's own text did, so a chat reacts as before.
  assert.ok(isUsageLimitDiagnostic(turn.error), "The free limit text still reads as a usage limit.");
  assert.ok(!isPlanLimitDiagnostic(turn.error), "The free limit text is not a plan window.");
  report.turn = { error: turn.error };

  // 2. The same words with another kind of failure keep the provider's own text.
  const other = await install("other", OTHER_MODEL);
  const otherClient = other.driver.createClient(other.cli, 10_000, NO_PROVIDER_CREDENTIALS);
  clients.push(otherClient);
  otherClient.start();
  const otherTurn = await runTurn(otherClient, await startThread(otherClient, { cwd: workspace }));
  assert.ok(otherTurn.error?.includes("Free usage limit reached"), "Another kind keeps the provider's text.");
  assert.notEqual(otherTurn.error, sourceText("error.provider.opencodeFreeLimit"), "Only the free limit is renamed.");
  report.otherKind = { error: otherTurn.error ?? "" };

  // 3. A channel lead on the spent model: the routing turn is a generation with no tools. Its failure
  // keeps the free limit, and the channel can show that text.
  assert.ok(isAgentModel(FREE_MODEL));
  const model: AgentModelOption = {
    provider: "opencode",
    id: FREE_MODEL,
    name: "DeepSeek V4.1 Flash Free",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  };
  const profileClient = (free.driver.createProfileClient ?? free.driver.createClient)(
    free.cli,
    10_000,
    NO_PROVIDER_CREDENTIALS,
  );
  clients.push(profileClient);
  const generation = await Effect.runPromise(
    Effect.result(generateTextWithoutTools(profileClient, model, "Route this message.")),
  );
  assert.ok(Result.isFailure(generation), "A spent free model cannot generate.");
  const cause = generation.failure.cause;
  assert.ok(cause instanceof Error);
  assert.equal(cause.message, sourceText("error.provider.opencodeFreeLimit"), "The generation keeps the free limit.");
  const channel = routingFailureText(cause);
  assert.equal(channel, sourceText("error.provider.opencodeFreeLimit"), "The channel shows the free limit.");
  // Any other generation failure still reads as the generic lead failure.
  const genericChannel = routingFailureText(new Error(sourceText("error.agent.profileFailed")));
  assert.equal(genericChannel, sourceText("error.backend.channelLeadFailed"), "Other failures stay generic.");
  report.routing = { generation: cause.message, channel, genericChannel };

  report.passed = true;
} finally {
  await stopClients(clients);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
