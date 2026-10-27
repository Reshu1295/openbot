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
  const groups: AccountRateLimitGroupResult[] = [];
  for (const limit of decoded.value.data.limits) {
    // Z.ai calls the model quota TOKENS_LIMIT and the monthly MCP quota TIME_LIMIT.
    if (limit.type !== "TOKENS_LIMIT" && limit.type !== "TIME_LIMIT") continue;
    groups.push({
      name: limit.type === "TOKENS_LIMIT" ? "GLM" : "MCP",
      models: [],
      primary: {
        usedPercent: Math.max(0, Math.min(100, limit.percentage)),
        windowDurationMins: limit.type === "TOKENS_LIMIT" ? 300 : null,
        resetsAt: resetSeconds(limit.nextResetTime),
      },
      secondary: null,
    });
  }
  const model = groups.find((group) => group.name === "GLM");
  if (!model) return NO_USAGE;
  return {
    rateLimits: { limitId: "zai", primary: model.primary, secondary: null },
    rateLimitsByLimitId: null,
    groups,
  } satisfies AccountRateLimitsReadResult;
});
