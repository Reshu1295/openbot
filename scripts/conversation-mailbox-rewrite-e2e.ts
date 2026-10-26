// Checks that a queue change writes no unchanged chat rows again. Runs the real SQLite, mailbox
// store, conversation runtime and mailbox sync on a temporary profile. The chat has more messages
// than the 100 the runtime keeps. Before them in the display order are a queued message from the
// user, a request whose delivery still shows running, and a completed message that the agent sent
// in that request's turn. Each round changes the chat, then a queue change syncs the mailbox.
// Before the fix, the runtime dropped the mailbox messages again after each sync, so each queue
// change wrote them again and sent the whole chat.
//
// The cases:
// - `message-limit`: a provider update adds an answer each round.
// - `byte-limit`: the answers are larger than the 8 MiB that the runtime keeps of one chat.
// - `provider-read`: each round, a provider read replaces the chat with one that has no mailbox
//   messages, so the cache has no record of them.
// No app, provider, account or network is started.
//
// Run: bun scripts/conversation-mailbox-rewrite-e2e.ts
// Writes .openbot-build/conversation-mailbox-rewrite-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, ConversationMessage, ConversationSnapshot } from "@openbot/contracts/ipc";
import { Effect, Exit, Scope } from "effect";
import { CONVERSATION_CACHE_BYTES_LIMIT, ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { MailboxSync } from "../src/backend/agent/mailbox-sync";
import { RoutineScheduler } from "../src/backend/agent/routine-scheduler";
import { AgentStore } from "../src/backend/agent-store";
import { AgentWaitStore } from "../src/backend/agent-waits/agent-wait-store";
import { AgentWaits } from "../src/backend/agent-waits/agent-waits";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineTimer } from "../src/backend/routine-timer";

const OUT = resolve(import.meta.dirname, "../.openbot-build/conversation-mailbox-rewrite-e2e");
/** More than `CONVERSATION_SNAPSHOT_MESSAGE_LIMIT`, so the runtime keeps only part of the chat. */
const SEEDED_TURNS = 120;
const ROUNDS = 5;

type CaseName = "message-limit" | "byte-limit" | "provider-read";

interface Round {
  round: number;
  changeWrites: string[];
  queueChangeWrites: string[];
  queueChangeConversationEvents: number;
  cachedMessages: number;
  keepsMailboxMessages: boolean;
}

interface CaseReport {
  name: CaseName;
  checks: string[];
  rounds: Round[];
  passed: boolean;
  error?: string;
}

const report: { cases: CaseReport[]; passed: boolean } = { cases: [], passed: false };

function assistantMessage(turn: string, createdAt: string, text: string): ConversationMessage {
  // Mailbox sync sets the reactions of each message. Seed them, so only a real change differs.
  return {
    id: `${turn}-answer`,
    turnId: turn,
    author: "assistant",
    text,
    createdAt,
    status: "completed",
    reactions: [],
    reaction: null,
  };
}

/** The ISO time 1 ms after `iso`. */
function after(iso: string): string {
  return new Date(Date.parse(iso) + 1).toISOString();
}

async function runCase(name: CaseName, result: CaseReport): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openbot-conversation-rewrite-"));
  const database = new OpenBotDatabase(join(root, "state"));
  const store = new AgentStore(join(root, "state"), join(root, "home"), database);
  const mailbox = new MailboxStore(join(root, "state"), store.sharedRoot, database);
  const events: AgentEvent[] = [];
  const conversation = new ConversationRuntime(
    store,
    (event) => events.push(event),
    () => store.list(),
  );
  const timer = new RoutineTimer(
    () => [],
    () => false,
    () => {},
  );
  const waits = new AgentWaits({
    store: new AgentWaitStore({ database }),
    mailbox,
    hooks: { emit: () => {}, ownsRoutine: () => true, hasRoutine: () => true, requireKnownAgent: () => {} },
  });
  const routines = new RoutineScheduler({
    store,
    mailbox,
    conversation,
    timer,
    waits,
    timezone: () => "UTC",
    hooks: {
      emit: () => {},
      emitError: () => {},
      emitQueue: () => {},
      scheduleDrain: () => {},
      interrupt: () => Effect.void,
      awaitDrain: () => undefined,
      syncMailboxMessages: () => {},
      listAgents: () => store.list(),
      excludedAgents: () => new Set(),
      isRunning: () => false,
      usageLimited: () => false,
    },
  });
  const scope = Scope.makeUnsafe();
  const sync = new MailboxSync({
    database,
    mailbox,
    conversation,
    routines,
    scope: () => scope,
    hooks: { emit: () => {}, emitError: () => {}, queueHold: () => null },
  });

  // Records the message ids of each conversation write.
  const writes: string[][] = [];
  const persistConversationChanges = database.persistConversationChanges.bind(database);
  database.persistConversationChanges = (input) => {
    writes.push(input.changedMessages.map((message) => message.id));
    return persistConversationChanges(input);
  };

  try {
    await runCauseEffect(store.initialize());
    await runCauseEffect(mailbox.initialize());
    const agent = await runCauseEffect(
      store.createAgent({ name: "Writer", description: "Gets queued work", avatarSeed: "rewrite-a", avatarHue: null }),
    );
    const teammate = await runCauseEffect(
      store.createAgent({ name: "Reviewer", description: "Gets sent work", avatarSeed: "rewrite-b", avatarHue: null }),
    );
    const threadId = store.ensureThreadIdNow(agent.id);

    // The user's message stays queued, so mailbox sync always adds it back.
    const queued = await runCauseEffect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: "Queued request" }),
    );
    const queuedDeliveryId = queued.deliveries[0]?.id;
    assert.ok(queuedDeliveryId);
    // The provider finished this turn, but the delivery still shows running.
    const running = await runCauseEffect(
      mailbox.enqueue({ sender: { kind: "user" }, recipientAgentIds: [agent.id], text: "Old request" }),
    );
    const runningDeliveryId = running.deliveries[0]?.id;
    assert.ok(runningDeliveryId);
    await runCauseEffect(mailbox.markStarting(runningDeliveryId));
    await runCauseEffect(mailbox.markRunning(runningDeliveryId, "turn-0"));
    const runningAt = mailbox
      .conversationMessages(agent.id)
      .find((message) => message.id === runningDeliveryId)?.createdAt;
    assert.ok(runningAt);
    // The seeded answers come after both requests, so the requests sort before the last 100.
    const answeredAt = after(runningAt);
    while (new Date().toISOString() <= answeredAt) await Promise.resolve();

    // Sent in the old turn: the turn sorts before the window, but this message's time is in it.
    const sent = await runCauseEffect(
      mailbox.enqueue({
        sender: { kind: "agent", agentId: agent.id },
        recipientAgentIds: [teammate.id],
        text: "Please review",
        idempotencyKey: `send:turn-0:${crypto.randomUUID()}`,
      }),
    );
    const sentDeliveryId = sent.deliveries[0]?.id;
    assert.ok(sentDeliveryId);
    await runCauseEffect(mailbox.markStarting(sentDeliveryId));
    await runCauseEffect(mailbox.markTerminal(sentDeliveryId, "completed"));
    const mailboxIds = [queuedDeliveryId, runningDeliveryId, `outbox-${sent.messageId}`];

    // In `byte-limit`, all answers together are 1.5 times the limit of one chat.
    const answerText =
      name === "byte-limit" ? "x".repeat(Math.ceil((CONVERSATION_CACHE_BYTES_LIMIT * 1.5) / SEEDED_TURNS)) : null;
    const seeded: ConversationSnapshot = {
      agentId: agent.id,
      threadId,
      activeTurnId: null,
      revision: 0,
      messages: Array.from({ length: SEEDED_TURNS }, (_, index) =>
        assistantMessage(`turn-${index + 1}`, answeredAt, answerText ?? `Answer ${index + 1}`),
      ),
    };
    conversation.emitConversation(seeded, "e2e.seeded", {});
    result.checks.push(`seeded ${SEEDED_TURNS} answers, a queued and a running request, 1 sent message`);

    for (let round = 0; round < ROUNDS; round += 1) {
      const snapshot = conversation.snapshot(agent.id);
      assert.ok(snapshot);
      let first = writes.length;
      if (name === "provider-read") {
        // The provider's copy has the same answers, one with new text, and no mailbox messages.
        const read = structuredClone(snapshot);
        read.messages = read.messages.filter((message) => !mailboxIds.includes(message.id));
        const edited = read.messages.at(-1);
        assert.ok(edited);
        edited.text = `Edited ${round}`;
        conversation.setSnapshot(agent.id, read);
      } else {
        snapshot.messages.push(
          assistantMessage(`update-${round}`, new Date().toISOString(), answerText ?? `Update ${round}`),
        );
        conversation.emitConversation(snapshot, "e2e.provider-update", {});
      }
      const changeWrites = writes.slice(first).flat();

      first = writes.length;
      const firstEvent = events.length;
      sync.emitQueue(agent.id);
      const queueChangeWrites = writes.slice(first).flat();
      const cached = conversation.snapshot(agent.id);
      assert.ok(cached);
      const ids = new Set(cached.messages.map((message) => message.id));
      result.rounds.push({
        round,
        changeWrites,
        queueChangeWrites,
        queueChangeConversationEvents: events.slice(firstEvent).filter((event) => event.type === "conversation").length,
        cachedMessages: cached.messages.length,
        keepsMailboxMessages: mailboxIds.every((id) => ids.has(id)),
      });
    }

    for (const round of result.rounds) {
      assert.deepEqual(
        round.changeWrites,
        name === "provider-read" ? [] : [`update-${round.round}-answer`],
        `round ${round.round}: the change writes only its own message`,
      );
      assert.ok(round.keepsMailboxMessages, `round ${round.round}: the chat keeps the mailbox messages`);
    }
    result.checks.push("each change writes only its own message; the chat keeps the mailbox messages");

    const [firstRound, ...laterRounds] = result.rounds;
    assert.ok(firstRound);
    assert.deepEqual(
      [...firstRound.queueChangeWrites].sort(),
      [...mailboxIds].sort(),
      "The first queue change writes the mailbox messages once.",
    );
    for (const round of laterRounds) {
      assert.deepEqual(round.queueChangeWrites, [], `round ${round.round}: a queue change writes no unchanged rows`);
      // A provider read changes the chat, so the queue change that follows it sends the chat once.
      if (name !== "provider-read")
        assert.equal(round.queueChangeConversationEvents, 0, `round ${round.round}: a queue change sends no chat`);
    }
    result.checks.push(
      name === "provider-read"
        ? "later queue changes write no rows"
        : "later queue changes write no rows and send no chat",
    );
    result.passed = true;
  } finally {
    timer.dispose();
    conversation.dispose();
    await Effect.runPromise(Scope.close(scope, Exit.void));
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

try {
  for (const name of ["message-limit", "byte-limit", "provider-read"] as const) {
    const result: CaseReport = { name, checks: [], rounds: [], passed: false };
    report.cases.push(result);
    await runCase(name, result).catch((error: unknown) => {
      result.error = error instanceof Error ? error.message : String(error);
    });
    process.stdout.write(`${name}: ${result.passed ? "passed" : `FAILED: ${result.error}`}\n`);
  }
  report.passed = report.cases.every((result) => result.passed);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`passed: ${report.passed}, report: ${join(OUT, "report.json")}\n`);
if (!report.passed) process.exitCode = 1;
