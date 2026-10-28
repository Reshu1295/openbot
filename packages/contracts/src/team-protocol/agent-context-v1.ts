import { INPUT_LIMITS } from "../input-limits";
import { isIdentifier } from "../ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "../runtime-values";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

/**
 * Frozen optional agent-context-v1 contract for protocol 7 and 8 runtime-snapshot events.
 * contextStates and threadContextStates carry the host's context counts and compaction state.
 * Each row uses botId and threadId. There is no prompt, message, path or provider session ID.
 * Hosts send the fields only to peers that advertise the capability. Missing fields keep the
 * released behavior; malformed present fields fail closed. New fields need another capability.
 */
export const AGENT_CONTEXT_CAPABILITY = "agent-context-v1";

const CATEGORIES = ["systemPrompt", "memoryFiles", "tools", "skills", "toolResults", "messages", "other"] as const;
const invalid = () => new Error("Invalid agent context state.");

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw invalid();
  return value;
}

function usage(value: unknown): TeamProtocolV7BaseJsonObject | null {
  if (value === null) return null;
  if (!isDynamicRecord(value) || !isBoolean(value.nativeManaged)) throw invalid();
  const usedTokens = count(value.usedTokens);
  const windowTokens = count(value.windowTokens);
  const autoCompactAt = value.autoCompactAt === null ? null : count(value.autoCompactAt);
  if (windowTokens === 0 || (autoCompactAt !== null && autoCompactAt > 1)) throw invalid();
  const result: TeamProtocolV7BaseJsonObject = {
    usedTokens,
    windowTokens,
    autoCompactAt,
    nativeManaged: value.nativeManaged,
  };
  if (value.estimated !== undefined) {
    if (!isBoolean(value.estimated)) throw invalid();
    result.estimated = value.estimated;
  }
  if (value.categories !== undefined) {
    if (!Array.isArray(value.categories) || value.categories.length > CATEGORIES.length) throw invalid();
    const seen = new Set<string>();
    result.categories = value.categories.map((row) => {
      if (!isDynamicRecord(row) || !isOneOf(CATEGORIES, row.category) || seen.has(row.category)) throw invalid();
      seen.add(row.category);
      return { category: row.category, tokens: count(row.tokens) };
    });
  }
  return result;
}

function compaction(value: unknown): TeamProtocolV7BaseJsonObject | null {
  if (value === null) return null;
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.id) ||
    !isOneOf(["running", "completed", "failed"] as const, value.status)
  )
    throw invalid();
  const result: TeamProtocolV7BaseJsonObject = {
    id: value.id,
    startedAt: count(value.startedAt),
    status: value.status,
  };
  for (const key of ["beforeTokens", "afterTokens", "expectedMs"] as const) {
    if (value[key] !== undefined) result[key] = count(value[key]);
  }
  return result;
}

function states(value: unknown, maximum: number): TeamProtocolV7BaseJsonObject[] {
  if (!Array.isArray(value) || value.length > maximum) throw invalid();
  return value.map((row) => {
    if (!isDynamicRecord(row) || !isIdentifier(row.botId) || !isIdentifier(row.threadId)) throw invalid();
    return {
      botId: row.botId,
      threadId: row.threadId,
      usage: usage(row.usage),
      compaction: compaction(row.compaction),
    };
  });
}

/** Add only the frozen context fields to a base wire event, on both send and receive paths. */
export function withAgentContext(projected: TeamProtocolV7BaseJsonValue, source: unknown): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "runtime-snapshot" || !isDynamicRecord(source))
    return projected;
  const snapshot = projected.snapshot;
  const from = source.snapshot;
  if (!isDynamicRecord(snapshot) || !isDynamicRecord(from)) return projected;
  const result: TeamProtocolV7BaseJsonObject = { ...snapshot };
  for (const key of ["contextStates", "threadContextStates"] as const) {
    const maximum = key === "contextStates" ? INPUT_LIMITS.agents : INPUT_LIMITS.agents * INPUT_LIMITS.agentTasks;
    if (from[key] !== undefined) result[key] = states(from[key], maximum);
  }
  return { ...projected, snapshot: result };
}
