import { isDynamicRecord, isOneOf, isString } from "../runtime-values";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";

/**
 * Frozen optional context-usage-v1 contract: how full the context window of each agent is. It adds
 * `contextStates` and `threadContextStates` beside the frozen keys of the `snapshot` of a
 * `runtime-snapshot` event. Each item is an `AgentContextState` with only these keys, spelled as the rest
 * of that snapshot is (`botId`, see `current-agent-keys.ts`):
 *
 * - `botId`, `threadId`;
 * - `usage`: null, or `usedTokens`, `windowTokens`, `autoCompactAt`, `nativeManaged`, and optionally
 *   `estimated` and `categories` (`{ category, tokens }` rows of `CONTEXT_USAGE_V1_CATEGORIES`);
 * - `compaction`: null, or `id`, `startedAt`, `status`, and optionally `beforeTokens`, `afterTokens`
 *   and `expectedMs`.
 *
 * The host adds them only for a client that advertises the capability, on protocol 8, so the wire of
 * every released client stays as it was. Such a client shows no context meter for the host's agents. The
 * host sends only the agents that the member can see, and drops a category row that this list does not
 * name. A host without the capability never sends the fields, so a client accepts them whenever they are
 * present. A present value that the runtime snapshot decoder refuses fails closed. Widening any of it
 * needs a second capability string.
 */
export const TEAM_CONTEXT_USAGE_CAPABILITY = "context-usage-v1";

const CONTEXT_USAGE_V1_CATEGORIES = [
  "systemPrompt",
  "memoryFiles",
  "tools",
  "skills",
  "toolResults",
  "messages",
  "other",
] as const;

const STATE_KEYS = ["botId", "threadId", "usage", "compaction"] as const;
const USAGE_KEYS = ["usedTokens", "windowTokens", "autoCompactAt", "nativeManaged", "estimated"] as const;
const CATEGORY_KEYS = ["category", "tokens"] as const;
const COMPACTION_KEYS = ["id", "startedAt", "status", "beforeTokens", "afterTokens", "expectedMs"] as const;

function isJsonObject(value: TeamProtocolV8BaseJsonValue): value is TeamProtocolV8BaseJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pickKeys(value: TeamProtocolV8BaseJsonObject, keys: readonly string[]): TeamProtocolV8BaseJsonObject {
  const result: TeamProtocolV8BaseJsonObject = {};
  for (const key of keys) {
    const entry = value[key];
    if (entry !== undefined) result[key] = entry;
  }
  return result;
}

/** The keys of `value` that `keys` names. A value that is not an object goes as it is, for the decoder to refuse. */
function pick(value: TeamProtocolV8BaseJsonValue, keys: readonly string[]): TeamProtocolV8BaseJsonValue {
  return isJsonObject(value) ? pickKeys(value, keys) : value;
}

function v1Usage(usage: TeamProtocolV8BaseJsonValue): TeamProtocolV8BaseJsonValue {
  if (!isJsonObject(usage)) return usage;
  const picked = pickKeys(usage, USAGE_KEYS);
  const { categories } = usage;
  if (categories === undefined) return picked;
  picked.categories = Array.isArray(categories)
    ? categories
        .filter(
          (row) => !isJsonObject(row) || !isString(row.category) || isOneOf(CONTEXT_USAGE_V1_CATEGORIES, row.category),
        )
        .map((row) => pick(row, CATEGORY_KEYS))
    : categories;
  return picked;
}

function v1ContextStates(states: unknown): TeamProtocolV8BaseJsonValue {
  if (!Array.isArray(states)) throw new Error("Invalid context states.");
  const json: TeamProtocolV8BaseJsonValue[] = JSON.parse(JSON.stringify(states));
  return json.map((state) => {
    if (!isJsonObject(state)) return state;
    const picked = pickKeys(state, STATE_KEYS);
    if (state.usage !== undefined) picked.usage = v1Usage(state.usage);
    if (state.compaction !== undefined) picked.compaction = pick(state.compaction, COMPACTION_KEYS);
    return picked;
  });
}

/**
 * `projected` with the context states of the `runtime-snapshot` event `source`, both on the wire
 * vocabulary. Other events are unchanged.
 */
export function withRuntimeSnapshotContextUsage(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "runtime-snapshot" || !isDynamicRecord(source)) {
    return projected;
  }
  const snapshot = projected.snapshot;
  const fromSnapshot = source.snapshot;
  if (!isDynamicRecord(snapshot) || !isDynamicRecord(fromSnapshot)) return projected;
  const result: TeamProtocolV8BaseJsonObject = { ...snapshot };
  if (fromSnapshot.contextStates !== undefined) result.contextStates = v1ContextStates(fromSnapshot.contextStates);
  if (fromSnapshot.threadContextStates !== undefined) {
    result.threadContextStates = v1ContextStates(fromSnapshot.threadContextStates);
  }
  return { ...projected, snapshot: result };
}
