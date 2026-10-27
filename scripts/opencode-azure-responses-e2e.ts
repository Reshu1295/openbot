// Checks that a custom provider on an Azure OpenAI or Azure AI Foundry v1 endpoint can run an agent
// turn (#3460). Builds the OpenCode config layer with `openCodeConfigEnv` for each endpoint, then runs
// the real OpenCode CLI with that layer against a fake Azure server on loopback (only the base URL
// changes), and reads the requests that OpenCode sends. Like Azure, the fake refuses a request to
// `/chat/completions` that has function tools and `reasoning_effort`, and accepts it at `/responses`.
// `--standalone` (OpenCode 2) keeps each run off the shared background service. Cases: the Azure hosts,
// which must use the `@ai-sdk/openai` adapter and send the turn to `/openai/v1/responses`; the
// OpenAI-compatible adapter that such an endpoint used before, which Azure refuses; and another
// host, which keeps the OpenAI-compatible adapter.
// `bun scripts/opencode-azure-responses-e2e.ts [<opencode binary>]`. Without an argument it uses
// `OPENBOT_OPENCODE_PATH`. Writes .openbot-build/opencode-azure-responses-e2e/report.json.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { openCodeConfigEnv } from "../src/backend/opencode-config";

const OUT = resolve(import.meta.dirname, "../.openbot-build/opencode-azure-responses-e2e");
const binaryArgument = process.argv[2] ?? process.env.OPENBOT_OPENCODE_PATH;
if (!binaryArgument) throw new Error("Give the OpenCode binary as the first argument or in OPENBOT_OPENCODE_PATH.");
const binary: string = binaryArgument;

const PROVIDER = "azure-foundry";
const MODEL = "gpt-6-luna";
/** A reasoning variant, so that the turn carries a reasoning effort as an agent turn does. */
const VARIANT = "high";
const API_KEY = "azure-test-key";
const AZURE_REFUSAL = `Function tools with reasoning_effort are not supported for ${MODEL} in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.`;
const root = await mkdtemp(join(tmpdir(), "openbot-opencode-azure-"));

/** The fields of a model request that Azure checks. Responses sends `reasoning.effort`. */
const modelRequestSchema = z.object({
  tools: z.array(z.object({ type: z.string() })).optional(),
  reasoning_effort: z.string().optional(),
  reasoning: z.object({ effort: z.string().optional() }).optional(),
});
type ModelRequest = z.infer<typeof modelRequestSchema>;

function parseModelRequest(raw: string): ModelRequest | null {
  return raw ? modelRequestSchema.parse(JSON.parse(raw)) : null;
}

interface CapturedRequest {
  readonly path: string;
  readonly authorization: string | null;
  readonly body: ModelRequest | null;
  readonly status: number;
}
const requests: CapturedRequest[] = [];

function sse(response: ServerResponse, events: readonly (readonly [string | null, unknown])[]): void {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const [event, data] of events)
    response.write(
      `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
    );
  response.end();
}

function hasTools(body: ModelRequest | null): boolean {
  return (body?.tools?.length ?? 0) > 0;
}

/** Chat Completions sends `reasoning_effort`; Responses sends `reasoning.effort`. */
function hasReasoning(body: ModelRequest | null): boolean {
  const effort = body?.reasoning_effort ?? body?.reasoning?.effort;
  return effort !== undefined && effort !== "none";
}

function record(request: IncomingMessage, body: ModelRequest | null, status: number): void {
  const authorization = request.headers.authorization ?? null;
  requests.push({ path: request.url ?? "", authorization, body, status });
}

function answerResponses(response: ServerResponse): void {
  const base = { id: "resp_1", object: "response", created_at: 0, model: MODEL };
  const item = { type: "message", id: "msg_1", role: "assistant", status: "completed" };
  const usage = {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 11,
  };
  sse(response, [
    ["response.created", { type: "response.created", response: { ...base, status: "in_progress" } }],
    [
      "response.output_item.added",
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    ],
    [
      "response.output_text.delta",
      {
        type: "response.output_text.delta",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        delta: "ok",
        logprobs: [],
      },
    ],
    [
      "response.output_item.done",
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { ...item, content: [{ type: "output_text", text: "ok", annotations: [] }] },
      },
    ],
    [
      "response.completed",
      {
        type: "response.completed",
        response: { ...base, status: "completed", incomplete_details: null, usage },
      },
    ],
  ]);
}

function answerChat(response: ServerResponse): void {
  const chunk = (delta: unknown, finish: string | null) => ({
    id: "c1",
    object: "chat.completion.chunk",
    created: 0,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  sse(response, [
    [null, chunk({ role: "assistant", content: "ok" }, null)],
    [null, { ...chunk({}, "stop"), usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }],
    [null, "[DONE]"],
  ]);
}

function answer(request: IncomingMessage, response: ServerResponse, raw: string): void {
  const path = request.url ?? "";
  const body = parseModelRequest(raw);
  if (path.endsWith("/responses")) {
    record(request, body, 200);
    answerResponses(response);
    return;
  }
  if (path.endsWith("/chat/completions")) {
    if (path.startsWith("/openai/v1/") && hasTools(body) && hasReasoning(body)) {
      record(request, body, 400);
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: { message: AZURE_REFUSAL, type: "invalid_request_error", param: "reasoning_effort", code: null },
        }),
      );
      return;
    }
    record(request, body, 200);
    answerChat(response);
    return;
  }
  record(request, body, 404);
  response.writeHead(404).end();
}

const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", () => answer(request, response, body));
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object", "the fake server has no port");
const origin = `http://127.0.0.1:${address.port}`;

/**
 * The layer OpenBot sends for one endpoint, with only the base URL moved to the fake server: the
 * configured path stays, so an Azure endpoint keeps `/openai/v1`. `npm` replaces the adapter for the
 * case that shows what the adapter of earlier versions sent.
 */
function configFor(
  baseUrl: string,
  npm?: string,
): { readonly npm: string; readonly baseURL: string; readonly content: string } {
  const env = openCodeConfigEnv(
    {},
    () => [
      {
        id: PROVIDER,
        name: "Azure Foundry",
        baseUrl,
        apiKey: API_KEY,
        models: [{ id: MODEL, name: "Luna" }],
        headers: [],
      },
    ],
    null,
  );
  const content = env.OPENCODE_CONFIG_CONTENT;
  assert.ok(content, "no OpenCode config layer");
  const config = JSON.parse(content);
  const entry = config.provider[PROVIDER];
  const sent = { npm: entry.npm, baseURL: entry.options.baseURL };
  entry.options.baseURL = `${origin}${new URL(entry.options.baseURL).pathname}`;
  if (npm) entry.npm = npm;
  // OpenCode offers a reasoning variant only for a model that it knows can reason.
  entry.models[MODEL] = { ...entry.models[MODEL], reasoning: true, tool_call: true };
  return { ...sent, content: JSON.stringify(config) };
}

async function runOpenCode(
  content: string,
  name: string,
): Promise<{ readonly code: number | null; readonly stderr: string }> {
  const home = join(root, name);
  mkdirSync(home, { recursive: true });
  const child = spawn(binary, ["run", "--standalone", "--model", `${PROVIDER}/${MODEL}#${VARIANT}`, "Say ok."], {
    cwd: home,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local/share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local/state"),
      OPENCODE_CONFIG_CONTENT: content,
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise<number | null>((done) => child.on("close", done));
  return { code, stderr: stderr.slice(-2000) };
}

interface CaseReport {
  readonly name: string;
  readonly configuredBaseUrl: string;
  readonly npm: string;
  readonly sentBaseUrl: string;
  readonly requests: readonly { readonly path: string; readonly status: number }[];
  readonly tools: boolean;
  readonly reasoning: boolean;
  readonly exitCode: number | null;
}
const cases: CaseReport[] = [];
const report: { binary: string; model: string; cases: CaseReport[]; result?: "pass" | "fail"; error?: string } = {
  binary,
  model: MODEL,
  cases,
};
try {
  const checks = [
    {
      name: "azure-openai",
      baseUrl: "https://example-resource.openai.azure.com/openai/v1",
      npm: "@ai-sdk/openai",
      path: "/openai/v1/responses",
      status: 200,
    },
    {
      name: "azure-ai-foundry",
      baseUrl: "https://example-resource.services.ai.azure.com/openai/v1/",
      npm: "@ai-sdk/openai",
      path: "/openai/v1/responses",
      status: 200,
    },
    {
      name: "azure-cognitive-services",
      baseUrl: "https://example-resource.cognitiveservices.azure.com/openai/v1",
      npm: "@ai-sdk/openai",
      path: "/openai/v1/responses",
      status: 200,
    },
    {
      name: "azure-chat-route",
      baseUrl: "https://example-resource.openai.azure.com/openai/v1",
      override: "@ai-sdk/openai-compatible",
      npm: "@ai-sdk/openai",
      path: "/openai/v1/chat/completions",
      status: 400,
    },
    {
      name: "other-host",
      baseUrl: "https://llm.example.com/v1",
      npm: "@ai-sdk/openai-compatible",
      path: "/v1/chat/completions",
      status: 200,
    },
  ] as const;
  for (const item of checks) {
    const config = configFor(item.baseUrl, "override" in item ? item.override : undefined);
    assert.equal(config.npm, item.npm, `${item.name}: adapter`);
    assert.equal(config.baseURL, item.baseUrl, `${item.name}: base URL`);
    const before = requests.length;
    const run = await runOpenCode(config.content, item.name);
    const sent = requests.slice(before);
    // OpenCode also asks the model for a session title, with no tools. The agent turn has tools.
    const turn = sent.filter((request) => request.path === item.path && hasTools(request.body));
    assert.ok(turn.length > 0, `${item.name}: no turn with tools to ${item.path} (exit ${run.code}): ${run.stderr}`);
    const tools = turn.some((request) => hasTools(request.body));
    const reasoning = turn.some((request) => hasReasoning(request.body));
    for (const request of turn) {
      assert.equal(request.status, item.status, `${item.name}: status of ${request.path}`);
      assert.equal(request.authorization, `Bearer ${API_KEY}`, `${item.name}: authorization`);
    }
    if (item.status === 200) {
      assert.equal(run.code, 0, `${item.name}: OpenCode exit code: ${run.stderr}`);
      assert.ok(
        sent.every((request) => request.status === 200),
        `${item.name}: a request failed: ${JSON.stringify(sent.map(({ path, status }) => ({ path, status })))}`,
      );
    } else {
      assert.ok(reasoning, `${item.name}: the turn has no reasoning effort`);
      assert.notEqual(run.code, 0, `${item.name}: OpenCode passed with the refused route`);
    }
    if (item.npm === "@ai-sdk/openai") assert.ok(reasoning, `${item.name}: the turn has no reasoning effort`);
    cases.push({
      name: item.name,
      configuredBaseUrl: item.baseUrl,
      npm: "override" in item ? item.override : config.npm,
      sentBaseUrl: config.baseURL,
      requests: sent.map(({ path, status }) => ({ path, status })),
      tools,
      reasoning,
      exitCode: run.code,
    });
  }
  report.result = "pass";
} catch (error) {
  report.result = "fail";
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  server.close();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`PASS opencode-azure-responses-e2e: ${join(OUT, "report.json")}\n`);
