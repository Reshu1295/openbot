// Frozen optional browser-secret-vault-v1 wire contract.
// An owner or admin can submit a pending secure browser input and explicitly ask the host to keep
// a password in its Vault. The host checks the request's agent and saves only a successfully
// submitted password, never an OTP or authenticator code. No secret is sent back to the client or
// agent. This route requires browser-secret-handoff as well. The released respond route still
// discards saveToVault; its meaning does not change.
import { isDynamicRecord, isString } from "../runtime-values";
import { adminRoute, empty, type OptionalRouteCodec } from "./admin-wire";

export const BROWSER_SECRET_VAULT_CAPABILITY = "browser-secret-vault-v1";
export const BROWSER_SECRET_VAULT_ROUTES = {
  respondAndSave: "/v1/browser-secrets/respond-and-save",
} as const;

export type BrowserSecretVaultSaveInput = {
  requestId: string | number;
  agentId: string;
  decision: "submit";
  secret: string;
  saveToVault: true;
};

function identifier(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= 128;
}

/** Frozen bounds. Never include the rejected input in an error. */
export function parseBrowserSecretVaultSaveInput(value: unknown): BrowserSecretVaultSaveInput {
  if (
    !isDynamicRecord(value) ||
    Object.keys(value).some(
      (key) =>
        key !== "requestId" && key !== "agentId" && key !== "decision" && key !== "secret" && key !== "saveToVault",
    ) ||
    !(identifier(value.requestId) || (typeof value.requestId === "number" && Number.isFinite(value.requestId))) ||
    !identifier(value.agentId) ||
    value.decision !== "submit" ||
    value.saveToVault !== true ||
    !isString(value.secret) ||
    value.secret.length === 0 ||
    value.secret.length > 4096
  )
    throw new Error("Invalid secure authentication response.");
  return {
    requestId: value.requestId,
    agentId: value.agentId,
    decision: "submit",
    secret: value.secret,
    saveToVault: true,
  };
}

export const BROWSER_SECRET_VAULT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    BROWSER_SECRET_VAULT_ROUTES.respondAndSave,
    adminRoute((value) => ({ ...parseBrowserSecretVaultSaveInput(value) }), empty),
  ],
]);
