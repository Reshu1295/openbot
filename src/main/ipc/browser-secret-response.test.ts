// @vitest-environment node

import {
  parseLocalBrowserSecretResponse,
  type RespondToBrowserSecretInput,
  remoteBrowserSecretResponse,
} from "@openbot/contracts/ipc";
import { parseBrowserSecretVaultSaveInput } from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import { describe, expect, it } from "vitest";

const SUBMIT: RespondToBrowserSecretInput = { requestId: "r1", agentId: "a1", decision: "submit", secret: "hunter2" };

describe("parseLocalBrowserSecretResponse", () => {
  it("keeps Save to Vault only for a submitted secret", () => {
    expect(parseLocalBrowserSecretResponse({ ...SUBMIT, saveToVault: true })).toEqual({ ...SUBMIT, saveToVault: true });
    expect(parseLocalBrowserSecretResponse(SUBMIT)).toEqual(SUBMIT);
    expect(() =>
      parseLocalBrowserSecretResponse({ requestId: "r1", agentId: "a1", decision: "cancel", saveToVault: true }),
    ).toThrow();
  });

  it.each([false, "true", 1, null])("refuses saveToVault %j without the secret in the error", (saveToVault) => {
    expect(() => parseLocalBrowserSecretResponse({ ...SUBMIT, saveToVault })).toThrow(
      "Invalid secure authentication response.",
    );
  });
});

describe("remoteBrowserSecretResponse", () => {
  it("sends only the released fields to a remote server", () => {
    expect(remoteBrowserSecretResponse({ ...SUBMIT, saveToVault: true })).toEqual(SUBMIT);
    expect(remoteBrowserSecretResponse({ requestId: 2, agentId: "a1", decision: "takeover" })).toEqual({
      requestId: 2,
      agentId: "a1",
      decision: "takeover",
    });
  });
});

describe("remote Vault save boundary", () => {
  it("keeps explicit consent only on a submitted secure input", () => {
    expect(parseBrowserSecretVaultSaveInput({ ...SUBMIT, saveToVault: true })).toEqual({
      ...SUBMIT,
      saveToVault: true,
    });
    expect(parseBrowserSecretVaultSaveInput({ ...SUBMIT, requestId: 2, saveToVault: true }).requestId).toBe(2);
  });

  it.each([
    { ...SUBMIT },
    { ...SUBMIT, saveToVault: false },
    { ...SUBMIT, saveToVault: "true" },
    { ...SUBMIT, decision: "cancel", saveToVault: true },
    { ...SUBMIT, decision: "takeover", saveToVault: true },
    { ...SUBMIT, saveToVault: true, password: SUBMIT.secret },
    { ...SUBMIT, saveToVault: true, requestId: "" },
    { ...SUBMIT, saveToVault: true, requestId: "r".repeat(129) },
    { ...SUBMIT, saveToVault: true, requestId: Number.POSITIVE_INFINITY },
    { ...SUBMIT, saveToVault: true, agentId: "" },
    { ...SUBMIT, saveToVault: true, agentId: "a".repeat(129) },
    { ...SUBMIT, saveToVault: true, secret: "" },
    { ...SUBMIT, saveToVault: true, secret: "s".repeat(4097) },
  ])("refuses malformed or unconsented save input without its values in the error", (input) => {
    expect(() => parseBrowserSecretVaultSaveInput(input)).toThrow("Invalid secure authentication response.");
  });
});
