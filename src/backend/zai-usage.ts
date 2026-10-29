// Z.ai's official usage plugin reads this endpoint with the Coding Plan key as Authorization:
// https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs
import { sourceText } from "@openbot/i18n/source";
import { Effect, Option, Schema } from "effect";
import type { AccountRateLimitGroupResult, AccountRateLimitsReadResult } from "./protocol";
import { providerFailure } from "./provider-client-effects";

const QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };
const Quota = Schema.Struct({
  type: Schema.String,
  percentage: Schema.Finite,
  unit: Schema.optional(Schema.Finite),
  number: Schema.optional(Schema.Finite),
  nextResetTime: Schema.optional(Schema.NullOr(Schema.Finite)),
});
const QuotaResponse = Schema.Struct({
  success: Schema.optional(Schema.Boolean),
  data: Schema.Struct({ limits: Schema.Array(Quota) }),
});

// A missing reset stays unknown. Z.ai's timestamp, when present, is Unix milliseconds.
function resetSeconds(value: number | null | undefined): number | null {
  return value != null && value > 0 ? value / 1_000 : null;
}

// Owns the Coding Plan quota request. It never sends the key to a redirect or logs a response body.
export const readZaiUsage = Effect.fn("Zai.readUsage")(function* (
  apiKey: string | null,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  if (!apiKey) return NO_USAGE;
  const body = yield* Effect.tryPromise({
    try: async (signal): Promise<unknown> => {
      const response = await request(QUOTA_URL, {
        headers: { Authorization: apiKey, "Accept-Language": "en-US,en" },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw new Error(`Z.ai usage returned HTTP ${response.status}.`);
      return response.json();
    },
    catch: () => providerFailure(new Error(sourceText("error.provider.zaiUsageFailed"))),
  });
  const decoded = Schema.decodeUnknownOption(QuotaResponse)(body);
  if (Option.isNone(decoded) || decoded.value.success === false) return NO_USAGE;
  let primary: AccountRateLimitGroupResult["primary"] = null;
  let secondary: AccountRateLimitGroupResult["secondary"] = null;
  const groups: AccountRateLimitGroupResult[] = [];
  for (const limit of decoded.value.data.limits) {
    const window = {
      usedPercent: Math.max(0, Math.min(100, limit.percentage)),
      windowDurationMins: null,
      resetsAt: resetSeconds(limit.nextResetTime),
    };
    if (limit.type === "TIME_LIMIT") {
      groups.push({ name: "MCP", models: [], primary: window, secondary: null });
      continue;
    }
    if (limit.type !== "TOKENS_LIMIT" && limit.type !== "CREDIT_LIMIT") continue;
    // The monitor API uses unit 3 for hours and unit 6 for the weekly window. Older
    // token responses omit the window fields and describe only the five-hour quota.
    if ((limit.unit === 3 && limit.number === 5) || (limit.type === "TOKENS_LIMIT" && limit.unit == null))
      primary = { ...window, windowDurationMins: 300 };
    else if (limit.unit === 6) secondary = { ...window, windowDurationMins: 10_080 };
  }
  if (!primary && !secondary) return NO_USAGE;
  if (groups.length) groups.unshift({ name: "GLM", models: [], primary, secondary });
  return {
    rateLimits: { limitId: "zai", primary, secondary },
    rateLimitsByLimitId: null,
    ...(groups.length ? { groups } : {}),
  } satisfies AccountRateLimitsReadResult;
});
