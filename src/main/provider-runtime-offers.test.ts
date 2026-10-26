// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { ProviderRuntimeManager } from "./provider-runtime-manager";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("provider runtime update offers", () => {
  it("offers no update for a provider that is off, and offers it again once the provider is on", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-runtime-offers-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    let cursorOn = false;
    const manager = new ProviderRuntimeManager({
      root,
      platform: "darwin",
      architecture: "arm64",
      isProviderOn: (provider) => provider !== "cursor" || cursorOn,
      fetchImpl: async () => {
        throw new Error("No network in this test.");
      },
    });
    cleanups.push(() => runCauseEffect(manager.stop()));
    await runCauseEffect(manager.initialize());
    // A CLI older than any release, so only the provider switch decides the offer.
    manager.setSystemVersion("cursor", "2000.01.01-0000000");
    manager.setSystemVersion("codex", "0.0.1");

    expect(manager.getStatus().providers.cursor.availableVersion).toBeNull();
    expect(manager.getStatus().providers.codex.availableVersion).not.toBeNull();

    const snapshots: ProviderRuntimeSnapshot[] = [];
    manager.on("status", (snapshot) => snapshots.push(snapshot));
    cursorOn = true;
    manager.providerUseChanged();

    expect(snapshots.at(-1)?.providers.cursor.availableVersion).not.toBeNull();

    cursorOn = false;
    manager.providerUseChanged();

    expect(snapshots.at(-1)?.providers.cursor.availableVersion).toBeNull();
    expect(snapshots.at(-1)?.revision).toBeGreaterThan(snapshots[0]?.revision ?? Number.POSITIVE_INFINITY);
  });
});
