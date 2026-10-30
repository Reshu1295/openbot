import { type AgentModelId, type AgentProviderId, isAgentProvider } from "@openbot/contracts/ipc";
import { z } from "zod";

const FIRST_RUN_RESUME_STORAGE_KEY = "openbot:first-run-resume:v1";

type ResumeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The choices made before the permission step. macOS asks the user to quit and reopen OpenBot after
 * a Screen Recording grant, so first run opens on that step again with these choices.
 */
export interface FirstRunResume {
  path: "free" | "plan";
  provider: AgentProviderId;
  /** The endpoint model, when the user chose their own endpoints on the plan step. */
  customModel: AgentModelId | null;
  skipped: boolean;
}

const firstRunResumeSchema = z.object({
  path: z.enum(["free", "plan"]),
  provider: z.custom<AgentProviderId>(isAgentProvider),
  customModel: z.string().min(1).nullable(),
  skipped: z.boolean(),
});

/** Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the guard. */
export function readFirstRunResume(storage?: ResumeStorage): FirstRunResume | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(FIRST_RUN_RESUME_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = firstRunResumeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeFirstRunResume(value: FirstRunResume, storage?: ResumeStorage): void {
  try {
    (storage ?? window.localStorage).setItem(FIRST_RUN_RESUME_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Blocked or full storage starts first run from the first question after a relaunch.
  }
}

export function clearFirstRunResume(storage?: ResumeStorage): void {
  try {
    (storage ?? window.localStorage).removeItem(FIRST_RUN_RESUME_STORAGE_KEY);
  } catch {
    // Nothing was saved when storage is blocked.
  }
}
