// Run: bun scripts/remote-vault-save-e2e.ts
// Real AttentionRegistry, VaultService and VaultStore with synthetic browser/provider boundaries.
// The HTTP routes E2E imports this same fixture. No browser, provider or account is started here.
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentEvent, BrowserTab, BrowserTakeoverRequest, ConversationSnapshot } from "@openbot/contracts/ipc";
import {
  BROWSER_SECRET_VAULT_CODECS,
  BROWSER_SECRET_VAULT_ROUTES,
  parseBrowserSecretVaultSaveInput,
} from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import { redactText } from "@openbot/logging";
import { Duration, Effect } from "effect";
import { AttentionRegistry } from "../src/backend/agent/attention-registry";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { DynamicToolCallParams } from "../src/backend/protocol";
import { VaultService } from "../src/main/vault-service";
import { VaultStore } from "../src/main/vault-store";

/** The actual secret-save domain path, shared by the standalone and real HTTP host checks. */
export async function createRemoteVaultSaveFixture(directory: string, canPersist = true) {
  const key = randomBytes(32);
  const path = join(directory, "openbot-vault-v1.json");
  let encryptionFails = false;
  let encryptionWrites = 0;
  let submitted = 0;
  let lastSubmitted = "";
  const cipher = {
    encrypt(value: string): Buffer {
      if (encryptionFails) throw new Error("Synthetic secret storage is unavailable.");
      const nonce = randomBytes(12);
      const encrypt = createCipheriv("aes-256-gcm", key, nonce);
      const content = Buffer.concat([encrypt.update(value, "utf8"), encrypt.final()]);
      encryptionWrites += 1;
      return Buffer.concat([nonce, encrypt.getAuthTag(), content]);
    },
    decrypt(value: Buffer): string {
      const decrypt = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decrypt.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decrypt.update(value.subarray(28)), decrypt.final()]).toString("utf8");
    },
  };
  const open = async () => {
    const vault = new VaultService({ store: new VaultStore(path, cipher), canPersist: () => canPersist });
    await Effect.runPromise(vault.load());
    return vault;
  };
  const vault = await open();
  const snapshots = new Map<string, ConversationSnapshot>();
  const tabs: BrowserTab[] = [];
  const events: AgentEvent[] = [];
  const answers: string[] = [];
  const notes: string[] = [];
  const requests = new Map<string, { method: "password" | "otp" | "authenticator"; origin: string }>();
  const stops: Array<() => Promise<void>> = [];
  let next = 0;
  let onRequest: ((request: BrowserTakeoverRequest) => void) | undefined;
  const registry = new AttentionRegistry({
    conversation: {
      agentForThread: (thread) => [...snapshots.values()].find((snapshot) => snapshot.threadId === thread)?.agentId,
      publicThreadId: (_agentId, thread) => thread,
      ensureSnapshot: (agentId) => {
        const snapshot = snapshots.get(agentId);
        assert.ok(snapshot);
        return snapshot;
      },
      emitConversation: () => undefined,
    },
    browser: {
      listTabs: () => tabs,
      beginTakeover: () => Effect.void,
      endTakeover: () => undefined,
      prepareSecret: (params) =>
        Effect.sync(() => {
          const request = requests.get(params.callId);
          assert.ok(request);
          return {
            request: { ...request, digits: 6 },
            agentScriptedOrigin: false,
            vaultFillable: true,
            submit: (secret: string) =>
              Effect.sync(() => {
                submitted += 1;
                lastSubmitted = secret;
                return "submitted" as const;
              }),
            cancel: () => undefined,
          };
        }),
    },
    hostedSites: { prepareApproval: () => Effect.succeed(null), resolveApproval: () => Effect.void },
    routines: { markNeedsAttention: () => undefined, markRunningForTurn: () => undefined },
    vaultItems: vault.items,
    agentName: () => "Synthetic agent",
    noteVaultChange: (_agentId, _threadId, _turnId, text) => notes.push(text),
    emit: (event) => {
      events.push(event);
      if (event.type === "browser-takeover-requested") onRequest?.(event.request);
    },
    emitError: () => undefined,
    emitRuntimeSnapshot: () => undefined,
  });
  const provider = new CodexAppServerClient("/nonexistent/synthetic-provider");
  async function begin(
    options: {
      agentId?: string;
      method?: "password" | "otp" | "authenticator";
      username?: string;
      origin?: string;
    } = {},
  ) {
    next += 1;
    const agentId = options.agentId ?? "agent-ada";
    const threadId = `thread-${agentId}`;
    const callId = `secure-call-${next}`;
    const origin = options.origin ?? "https://login.example.test";
    const method = options.method ?? "password";
    snapshots.set(agentId, { agentId, threadId, activeTurnId: `turn-${next}`, revision: 0, messages: [] });
    const tabId = `secure-tab-${next}`;
    tabs.push({
      id: tabId,
      title: "Synthetic login",
      url: origin,
      loading: false,
      ownerAgentId: agentId,
      ownerThreadId: threadId,
    });
    requests.set(callId, { method, origin });
    const shown = Promise.withResolvers<BrowserTakeoverRequest>();
    onRequest = shown.resolve;
    const controller = new AbortController();
    const params: DynamicToolCallParams = {
      namespace: "openbot_browser",
      tool: "submit_secret",
      ownerAgentId: agentId,
      threadId,
      turnId: `turn-${next}`,
      callId,
      arguments: {
        tabId,
        method,
        targets: [{ kind: "css", selector: "#secret" }],
        submission: "enter",
        username: options.username ?? "synthetic-user",
        digits: 6,
      },
    };
    const completed = Effect.runPromise(
      registry
        .surfaceBrowserTakeover(provider, { id: next, method: "item/tool/call", params })
        .pipe(Effect.timeout(Duration.seconds(15))),
      { signal: controller.signal },
    );
    // Retain only secret-free provider results; cleanup joins every pending domain operation.
    void completed.then(
      (answer) => answers.push(JSON.stringify(answer)),
      () => undefined,
    );
    stops.push(async () => {
      controller.abort();
      await completed.catch(() => undefined);
    });
    const request = await Promise.race([
      shown.promise,
      completed.then(() => {
        throw new Error("Secure request ended before presentation.");
      }),
    ]);
    onRequest = undefined;
    return { request, completed };
  }
  return {
    path,
    vault,
    registry,
    begin,
    reopen: open,
    metrics: () => ({ submitted, encryptionWrites }),
    received: (value: string) => lastSubmitted === value,
    failEncryption: (fail: boolean) => {
      encryptionFails = fail;
    },
    publicData: () =>
      JSON.stringify({ events, answers, notes, snapshots: [...snapshots.values()], state: vault.state() }),
    close: async () => {
      for (const stop of stops.reverse()) await stop();
    },
  };
}

async function runRemoteVaultSave() {
  const root = await mkdtemp(join(tmpdir(), "openbot-remote-vault-save-"));
  const output = resolve(import.meta.dirname, "../.openbot-build/remote-vault-save-e2e");
  const cases: string[] = [];
  const password = `synthetic-vault-${randomBytes(12).toString("hex")}`;
  const replacement = `synthetic-vault-new-${randomBytes(12).toString("hex")}`;
  const fixture = await createRemoteVaultSaveFixture(root);
  let unavailable: Awaited<ReturnType<typeof createRemoteVaultSaveFixture>> | undefined;
  let failure: unknown;
  try {
    const initial = await fixture.begin();
    const codec = BROWSER_SECRET_VAULT_CODECS.get(BROWSER_SECRET_VAULT_ROUTES.respondAndSave);
    assert.ok(codec);
    const wire = codec.request({
      requestId: initial.request.requestId,
      agentId: initial.request.agentId,
      decision: "submit",
      secret: password,
      saveToVault: true,
    });
    const decoded = parseBrowserSecretVaultSaveInput(JSON.parse(JSON.stringify(wire)));
    await runCauseEffect(fixture.registry.respondToBrowserSecret(decoded));
    assert.equal((await initial.completed).success, true);
    assert.equal(fixture.received(password), true);
    const login = fixture.vault.state().items[0];
    assert.ok(login?.kind === "login");
    const encrypted = await readFile(fixture.path, "utf8");
    assert.equal(encrypted.includes(password), false);
    const reopened = await fixture.reopen();
    assert.equal(reopened.reveal({ id: login.id, field: "password" }) === password, true);
    if (process.platform !== "win32") assert.equal((await stat(fixture.path)).mode & 0o777, 0o600);
    cases.push(
      "the frozen optional wire codec round-trips consent into secure input and an encrypted host Vault that reopens",
    );
    const update = await fixture.begin();
    await runCauseEffect(
      fixture.registry.respondToBrowserSecret({
        requestId: update.request.requestId,
        agentId: update.request.agentId,
        decision: "submit",
        secret: replacement,
        saveToVault: true,
      }),
    );
    await update.completed;
    assert.equal(fixture.vault.state().items.length, 1);
    assert.equal(fixture.vault.state().items[0]?.id, login.id);
    assert.equal((await fixture.reopen()).reveal({ id: login.id, field: "password" }) === replacement, true);
    cases.push("the same site and username update the existing encrypted login instead of adding a duplicate");
    const writes = fixture.metrics().encryptionWrites;
    const unchanged = await fixture.begin();
    await runCauseEffect(
      fixture.registry.respondToBrowserSecret({
        requestId: unchanged.request.requestId,
        agentId: unchanged.request.agentId,
        decision: "submit",
        secret: replacement,
        saveToVault: true,
      }),
    );
    await unchanged.completed;
    assert.equal(fixture.metrics().encryptionWrites, writes);
    cases.push("a repeated saved password completes sign-in without a second Vault write");
    for (const mode of ["opt-out", "cancel", "otp", "authenticator"] as const) {
      const flow = await fixture.begin({
        username: mode,
        ...(mode === "otp" || mode === "authenticator" ? { method: mode } : {}),
      });
      await runCauseEffect(
        fixture.registry.respondToBrowserSecret(
          mode === "cancel"
            ? { requestId: flow.request.requestId, agentId: flow.request.agentId, decision: "cancel" }
            : {
                requestId: flow.request.requestId,
                agentId: flow.request.agentId,
                decision: "submit",
                secret: mode === "otp" || mode === "authenticator" ? "729104" : password,
                ...(mode !== "opt-out" ? { saveToVault: true } : {}),
              },
        ),
      );
      await flow.completed;
      assert.equal(fixture.metrics().encryptionWrites, writes);
      assert.equal(fixture.vault.state().items.length, 1);
      cases.push(`${mode} does not store a login`);
    }
    const beforeFailure = await readFile(fixture.path, "utf8");
    fixture.failEncryption(true);
    const failing = await fixture.begin({ username: "save-failure" });
    await runCauseEffect(
      fixture.registry.respondToBrowserSecret({
        requestId: failing.request.requestId,
        agentId: failing.request.agentId,
        decision: "submit",
        secret: password,
        saveToVault: true,
      }),
    );
    const answer = await failing.completed;
    assert.equal(answer.success, true);
    assert.ok(JSON.stringify(answer).includes("not saved"));
    assert.equal(fixture.vault.state().items.length, 1);
    assert.equal(await readFile(fixture.path, "utf8"), beforeFailure);
    cases.push(
      "a failed encryption save keeps the previous Vault and completes sign-in with a safe save failure result",
    );
    for (const value of [password, replacement]) {
      assert.equal(fixture.publicData().includes(value), false);
      assert.equal(redactText(value).includes(value), false);
    }
    cases.push("provider results, events, conversation state and public Vault summaries contain no saved password");
    unavailable = await createRemoteVaultSaveFixture(join(root, "unavailable"), false);
    const unavailableFlow = await unavailable.begin();
    await runCauseEffect(
      unavailable.registry.respondToBrowserSecret({
        requestId: unavailableFlow.request.requestId,
        agentId: unavailableFlow.request.agentId,
        decision: "submit",
        secret: password,
        saveToVault: true,
      }),
    );
    const unavailableResult = await unavailableFlow.completed;
    assert.equal(unavailableResult.success, true);
    assert.ok(JSON.stringify(unavailableResult).includes("not saved"));
    assert.equal(unavailable.vault.state().status, "unavailable");
    assert.equal(unavailable.metrics().encryptionWrites, 0);
    assert.equal(await readFile(unavailable.path, "utf8").catch(() => undefined), undefined);
    cases.push("a host without secret storage completes sign-in and saves no plaintext or Vault file");
  } catch (error) {
    failure = error;
  } finally {
    await fixture.close();
    await unavailable?.close();
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, "report.json"),
      `${JSON.stringify({ passed: !failure, cipher: "AES-256-GCM injected at the real VaultStore boundary", osKeyringChecked: false, cases, metrics: fixture.metrics(), failure: failure ? redactText(String(failure)).replaceAll(password, "[synthetic-secret]").replaceAll(replacement, "[synthetic-secret]") : null }, null, 2)}\n`,
    );
    await rm(root, { recursive: true, force: true });
  }
  if (failure) throw failure;
  // Machine-readable: focused persistence results for CI.
  process.stdout.write(`${JSON.stringify({ passed: true, cases: cases.length })}\n`);
}

if (import.meta.main) await runRemoteVaultSave();
