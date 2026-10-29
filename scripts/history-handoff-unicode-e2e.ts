// Runs the history handoff path with a real temporary database and synthetic messages.
// No provider request or user profile is used. Run with:
// bun scripts/history-handoff-unicode-e2e.ts
// Writes .openbot-build/history-handoff-unicode-e2e/report.json.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ConversationMessage } from "@openbot/contracts/ipc";

const out = resolve(import.meta.dirname, "../.openbot-build/history-handoff-unicode-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-handoff-unicode-"));
const home = join(root, "home");
process.env.HOME = home;
process.env.CODEX_HOME = join(home, ".codex");
await mkdir(home, { recursive: true });

const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");
const { renderHandoffMessage } = await import("../src/backend/agent/delivery-content");
const { appendRoutineDigest, readHandoffHistory, renderProviderHandoff, renderRoutineHandoff } = await import(
  "../src/backend/agent/handoff-history"
);

interface Check {
  name: string;
  passed: boolean;
  characters?: number;
  error?: string;
}

const report: { passed: boolean; checks: Check[]; error?: string } = { passed: false, checks: [] };
const database = new OpenBotDatabase(join(root, "data"));
const store = new AgentStore(join(root, "data"), home, database);
const names = new Map<string, string>();

function check(name: string, run: () => number | undefined) {
  try {
    const characters = run();
    report.checks.push({ name, passed: true, ...(characters === undefined ? {} : { characters }) });
  } catch (error) {
    report.checks.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function checkedPacket(packet: string | null, limit: number): string {
  assert.ok(packet, "The handoff is missing.");
  assert.equal(Buffer.from(packet, "utf8").toString("utf8"), packet, "The handoff contains an unpaired surrogate.");
  assert.ok(packet.length <= limit, `The handoff exceeds ${limit} characters.`);
  assert.ok(packet.includes("--- end previous transcript ---"), "The handoff lost its ending.");
  return packet;
}

function message(id: string, text: string): ConversationMessage {
  return { id, author: "assistant", text, createdAt: "2026-01-01T00:00:00.000Z", status: "completed" };
}

/** Places an emoji at a cut in the rendered message, including its timestamp and id. */
function atRenderedOffset(id: string, offset: number, length: number): ConversationMessage {
  const prefix = `[messageId: ${id}]\n${renderHandoffMessage(message(id, ""), names)}\n`;
  assert.ok(offset >= prefix.length);
  return message(id, `${"a".repeat(offset - prefix.length)}😀${"b".repeat(length - offset - 2)}`);
}

async function save(id: string, messages: ConversationMessage[]) {
  const agent = await runCauseEffect(store.getOrCreate(id, "Unicode check", "Unicode check"));
  const threadId = await runCauseEffect(store.ensureThreadId(agent.id));
  database.persistConversation(
    { agentId: agent.id, threadId, activeTurnId: null, revision: 0, messages },
    "conversation.updated",
  );
  return { history: readHandoffHistory(database, agent.id, threadId, names), agentId: agent.id, threadId };
}

try {
  await runCauseEffect(store.initialize());

  // The routine limit is 2000. The 57-character marker leaves 972 at the start and 971 at the end.
  for (const [name, offset] of [
    ["prefix", 971],
    ["suffix", 3028],
  ] as const) {
    const source = atRenderedOffset(`routine-${name}`, offset, 4000);
    const { history, agentId, threadId } = await save(`routine-${name}`, [source]);
    check(`routine ${name} boundary`, () => checkedPacket(renderRoutineHandoff(history, names), 8000).length);
    check(`routine ${name} source is unchanged`, () => {
      assert.equal(database.readConversation(agentId, threadId).messages[0]?.text, source.text);
      return undefined;
    });
  }

  const short = message("short", "Keep this complete: 😀. Final instruction.");
  const shortHistory = await save("short-history", [short]);
  check("short history is complete", () => {
    const packet = checkedPacket(renderRoutineHandoff(shortHistory.history, names), 8000);
    assert.ok(packet.includes(short.text));
    assert.ok(!packet.includes("[... omitted;"));
    return packet.length;
  });

  // Both parities exercise the cut positions in provider role anchors.
  for (const padding of [0, 1]) {
    const id = `provider-${padding}`;
    const source = message(id, `${"a".repeat(padding)}${"😀".repeat(24_000)}FINAL-INSTRUCTION`);
    const { history, agentId, threadId } = await save(id, [source]);
    check(`provider handoff parity ${padding}`, () => {
      const packet = checkedPacket(renderProviderHandoff(history, names, new Map()), 32_000);
      assert.ok(packet.includes("FINAL-INSTRUCTION"));
      return packet.length;
    });
    check(`provider source parity ${padding} is unchanged`, () => {
      assert.equal(database.readConversation(agentId, threadId).messages[0]?.text, source.text);
      return undefined;
    });
  }

  // Use a short message so a failure here comes only from the captured steps.
  for (const [name, offset] of [
    ["prefix", 471],
    ["suffix", 2528],
  ] as const) {
    const header = `[messageId: ${short.id}]\n`;
    const captured = `${"a".repeat(offset - header.length)}😀${"b".repeat(3000 - offset - 2)}`;
    check(`captured step ${name} boundary`, () => {
      const packet = checkedPacket(
        renderProviderHandoff(shortHistory.history, names, new Map([[short.id, captured]])),
        32_000,
      );
      assert.ok(packet.includes("[... omitted;"), "The captured step was not included.");
      return packet.length;
    });
  }

  for (const [name, offset] of [
    ["prefix", 721],
    ["suffix", 2278],
  ] as const) {
    const prefix = "[routine: Unicode]\n";
    const answer = `${"a".repeat(offset - prefix.length)}😀${"b".repeat(3000 - offset - 2)}`;
    check(`routine digest ${name} boundary`, () => {
      const packet = checkedPacket(appendRoutineDigest(undefined, "Unicode", answer), 6200);
      const next = appendRoutineDigest(packet, "Next", "A complete answer 😀.");
      checkedPacket(next, 6200);
      assert.ok(next.includes("A complete answer 😀."));
      return packet.length;
    });
  }

  check("empty history produces no handoff", () => {
    const empty = { recent: [], latest: [], hasOlder: false };
    assert.equal(renderRoutineHandoff(empty, names), null);
    assert.equal(renderProviderHandoff(empty, names, new Map()), null);
    return undefined;
  });
  report.passed = report.checks.every((entry) => entry.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  database.close();
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}

process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(out, "report.json")}\n`);
if (!report.passed) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 1;
}
