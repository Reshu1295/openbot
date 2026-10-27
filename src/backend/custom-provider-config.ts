// The user's own model endpoints, as the backend receives them. The `endpoint` provider runs them in
// the Pi CLI (`pi-endpoints.ts`).

import type { CustomProviderHeader, CustomProviderModel } from "@openbot/contracts/ipc";

/** One endpoint, as the main process stores it. Carries the secrets, so it never crosses IPC. */
export interface CustomProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly models: readonly CustomProviderModel[];
  readonly headers: readonly CustomProviderHeader[];
}

/**
 * Read at spawn, never captured: a saved endpoint must land in the *next* process, and a captured
 * array would pin whatever was stored when the driver was built.
 */
export type CustomProviderSource = () => readonly CustomProviderConfig[];
