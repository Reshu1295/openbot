import type { AgentEvent, AgentRuntimeSnapshot, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import { reconcilePendingRequests } from "@openbot/team-client/runtime-attention";

/**
 * A question that an agent waits on. The `prompt` event carries the whole request, and a runtime
 * snapshot carries the same questions in its shorter bounds; both are enough to draw the form.
 */
export type PendingPrompt = AgentRuntimeSnapshot["pendingPrompts"][number];

function sameRequest(left: string | number, right: string | number) {
  return String(left) === String(right);
}

function withoutRequest(current: readonly PendingPrompt[], requestId: string | number) {
  const next = current.filter((item) => !sameRequest(item.requestId, requestId));
  return next.length === current.length ? current : next;
}

/**
 * Folds one host event into the questions that one server waits on. A snapshot is the current state,
 * so it replaces the list; an event names one request.
 *
 * The phone keeps this list because a question is a request of the host, not a message of the chat:
 * its message can be in another thread than the open chat, or absent from the page the phone holds,
 * and the person must still be able to answer it. The desktop renders the same requests.
 */
export function reducePendingPrompts(
  current: readonly PendingPrompt[],
  event: AgentEvent | TeamRealtimeEvent,
): readonly PendingPrompt[] {
  switch (event.type) {
    case "runtime-snapshot": {
      const next = reconcilePendingRequests<PendingPrompt>(
        current,
        event.snapshot.pendingPrompts,
        event.snapshot.attentionComplete,
      );
      return next.length === current.length && next.every((item, index) => item === current[index]) ? current : next;
    }
    case "prompt":
      return [
        ...withoutRequest(current, event.requestId),
        {
          requestId: event.requestId,
          agentId: event.agentId,
          threadId: event.threadId,
          turnId: event.turnId,
          questions: event.questions,
        },
      ];
    case "agent-input-resolved":
      return event.kind === "prompt" ? withoutRequest(current, event.requestId) : current;
    case "turn-completed": {
      const next = current.filter((item) => item.agentId !== event.agentId || item.turnId !== event.turnId);
      return next.length === current.length ? current : next;
    }
    default:
      return current;
  }
}

/** Removes one answered or stale question from the questions of its server. */
export function dropPrompt(
  byServer: Record<string, readonly PendingPrompt[]>,
  serverId: string,
  requestId: string | number,
): Record<string, readonly PendingPrompt[]> {
  const current = byServer[serverId];
  if (!current) return byServer;
  const next = withoutRequest(current, requestId);
  return next === current ? byServer : { ...byServer, [serverId]: next };
}
