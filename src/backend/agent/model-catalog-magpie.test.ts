import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentProvider } from "../agent-client";
import { ClaudeAgentClient } from "../claude-client";
import { NO_MAGPIE_LINK } from "../magpie-link";
import { NO_PROVIDER_CREDENTIALS } from "../provider-drivers";
import { ModelCatalog } from "./model-catalog";

const MODELS = {
  data: [{ id: "codex/gpt-6-sol" }, { id: "auto/deepseek-v4.1-flash" }, { id: "claude/claude-opus-5-5" }],
};

const clients: ClaudeAgentClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await Effect.runPromise(client.stop());
});

/** The Magpie provider's client against a gateway that lists `MODELS`. */
function magpieClient(linkedModel: string | null): ClaudeAgentClient {
  const client = new ClaudeAgentClient(
    { executable: "claude", version: "2.1.310", source: "system" },
    () => {
      throw new Error("Claude Code must not start for a model list.");
    },
    undefined,
    5_000,
    () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      origin: () => Effect.succeed("http://127.0.0.1:3425"),
      configDirectory: "/data/magpie-claude",
      linkedModel: () => linkedModel,
      fetch: async () => new Response(JSON.stringify(MODELS), { status: 200 }),
    },
  );
  client.start();
  clients.push(client);
  return client;
}

function catalog(model: string | null): ModelCatalog {
  const client = magpieClient(model);
  return new ModelCatalog({
    client: (provider: AgentProvider) => (provider === "magpie" ? client : undefined),
    isSignedOut: () => false,
    credentials: { ...NO_PROVIDER_CREDENTIALS, magpieLink: () => ({ ...NO_MAGPIE_LINK, model }) },
    requestTimeoutMs: 1_000,
    recordProviderError: () => undefined,
  });
}

async function magpieIds(model: string | null): Promise<string[]> {
  const models = catalog(model);
  await Effect.runPromise(models.refresh());
  return models
    .list()
    .filter((option) => option.provider === "magpie")
    .map((option) => option.id);
}

describe("Magpie model catalogue", () => {
  it("puts the model that Magpie set for OpenBot first, so new agents start on it", async () => {
    expect((await magpieIds("auto/deepseek-v4.1-flash"))[0]).toBe("auto/deepseek-v4.1-flash");
    expect((await magpieIds("claude/claude-opus-5-5"))[0]).toBe("claude/claude-opus-5-5");
  });

  it("keeps the normal order without a model from Magpie, or with one the gateway does not list", async () => {
    const normal = await magpieIds(null);
    expect(normal).toHaveLength(3);
    expect(await magpieIds("gone/model")).toEqual(normal);
  });
});
