import { decodeHostVaultSecret, decodeHostVaultState } from "@openbot/contracts/ipc";
import { VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import type { VaultCalls } from "../vault/vault-port";
import type { WebWorkspace } from "./web-client-context";

/**
 * The Vault of the connected host (`vault-v1`), for its owner or admin. The browser has no main
 * process, so a copy shows the secret to this page and puts it on the clipboard here. There is no CSV
 * import: the file is on this computer, not on the host.
 */
export function webVaultCalls(request: () => TeamApiRequest, onHostEvent: WebWorkspace["onHostEvent"]): VaultCalls {
  const post = <T>(path: string, decode: (value: unknown) => T, body: Parameters<TeamApiRequest>[3] = {}) =>
    request()("POST", path, decode, body);
  const list = () => post(VAULT_ROUTES.list, decodeHostVaultState);
  const reveal: VaultCalls["reveal"] = (secret) => post(VAULT_ROUTES.reveal, decodeHostVaultSecret, { ...secret });
  return {
    list,
    save: (input) => post(VAULT_ROUTES.save, decodeHostVaultState, { ...input }),
    remove: (id) => post(VAULT_ROUTES.delete, decodeHostVaultState, { id }),
    reveal,
    copy: async (secret) => navigator.clipboard.writeText(await reveal(secret)),
    reset: () => post(VAULT_ROUTES.reset, decodeHostVaultState),
    // The event carries no item, so the list is read again.
    onChanged: (listener) =>
      onHostEvent((event) => {
        if (event.type === "vault-changed") list().then(listener, () => {});
      }),
  };
}
