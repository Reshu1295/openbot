import type { SidebarWaitReason } from "@openbot/ui/features/sidebar/sidebar-types";

/** What the agent does in a thread, as a sidebar row shows it for the agent. */
export type ThreadStatus =
  | { kind: "idle" }
  | { kind: "working" }
  /** A message waits for a free turn. */
  | { kind: "queued" }
  | { kind: "waiting"; reason: SidebarWaitReason }
  | { kind: "failed" };

/**
 * One thread of an agent. `main` is the agent's own chat: it has no rename, archive or delete. `draft`
 * is a new thread that has no message yet: its first message starts it.
 */
export interface ThreadItem {
  id: string;
  kind: "main" | "side" | "draft";
  title: string;
  updatedAt: string;
  status: ThreadStatus;
}

/** The thread row as tabs, as one button with the open thread, or as a chevron only. */
export type ThreadRowMode = "tabs" | "compact" | "minimal";

/** A turn runs in the thread. The user stops it before an archive or a delete. */
export function threadBusy(status: ThreadStatus): boolean {
  return status.kind === "working" || status.kind === "waiting";
}

/**
 * The threads of one agent and what the user can do with them. `onRename` and `onDelete` are missing
 * when the host cannot rename or delete threads; the actions then do not show.
 */
export interface ThreadHeaderProps {
  /** Every thread that is not archived, with the agent's own chat. */
  threads: readonly ThreadItem[];
  /** The threads that have a tab, in tab order. The agent's own chat is always one of them. */
  tabs: readonly ThreadItem[];
  archived: readonly ThreadItem[];
  activeId: string;
  /** False at the limit of threads. */
  canStartNew: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToTheRight: (id: string) => void;
  onMove: (id: string, index: number) => void;
  onArchive: (id: string) => void;
  /** Restores an archived thread and opens it. */
  onRestore: (id: string) => void;
  onRename?: ((id: string, title: string) => void) | undefined;
  onDelete?: ((id: string) => void) | undefined;
}

/** The id of the agent's own chat in the thread lists. A side thread has the id of its task. */
export const MAIN_THREAD_ID = "main";
/** The id of the new thread tab, before its first message starts the thread. */
export const DRAFT_THREAD_ID = "draft";
