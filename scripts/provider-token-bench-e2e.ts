// Measures the real tokens of each request that an OpenBot agent sends on a real provider CLI, and
// the tokens of the same prompts on the bare CLI (#3129, #3138). It uses the signed-in subscription
// of this computer, so keep the selection small. Runs the real agent service on a temporary profile
// and a temporary HOME. Only the sign-in files are copied into that HOME; the real CLI folders are
// never written. A provider that is not signed in there is skipped with the reason.
//
// Scenarios, each with a new agent on the cheapest listed model at low effort:
//   bare-cli         the three trivial prompts on the bare CLI, in one resumed session, from an empty
//                    folder. Antigravity has no signed-in bare CLI in a temporary HOME, so its bare
//                    run is the same ACP server that OpenBot starts, with no OpenBot prompt or tools.
//   chat-trivial     the three prompts in the agent's own chat, one at a time.
//   mcp-refresh      two chat turns, an MCP server added through the service as the settings panel
//                    does, and a third turn. A new provider session at turn 3 is the refresh.
//   channel-3-turns  three user messages to the Antigravity member of a two-member channel (to the
//                    Codex or OpenCode member when Antigravity is not available).
//
// `bun scripts/provider-token-bench-e2e.ts [--providers=codex,antigravity,opencode,claude]
//   [--scenarios=bare-cli,chat-trivial,mcp-refresh,channel-3-turns] [--compare=<old report.json>]`
// Writes .openbot-build/provider-token-bench/report.json. When a copied sign-in file changed (a token
// refresh), the temporary HOME stays and the report names it: the old token can be invalid now.
import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AGENT_PROVIDERS,
  type AgentModelOption,
  type AgentReasoningEffort,
  decodeUsageTokens,
  type McpServerConfig,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";

type Provider = (typeof AGENT_PROVIDERS)[number];
const BENCH_PROVIDERS = ["claude", "codex", "antigravity", "opencode", "grok"] as const;
type BenchProvider = (typeof BENCH_PROVIDERS)[number];
const SCENARIOS = ["bare-cli", "chat-trivial", "mcp-refresh", "channel-3-turns", "channel-long"] as const;
type Scenario = (typeof SCENARIOS)[number];
const PROMPTS = ["Reply with OK only.", "What is 2+2? Reply with the number only.", "Capital of France? One word."];
const TURN_TIMEOUT_MS = 6 * 60_000;
const TRANSIENT = /timed? ?out|overloaded|ECONNRESET|ECONNREFUSED|socket hang up|network|temporar|\b50[0-9]\b/iu;

const REPO = resolve(import.meta.dirname, "..");
const OUT = join(REPO, ".openbot-build/provider-token-bench");
const realHome = homedir();

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}
function listArgument<T extends string>(name: string, all: readonly T[]): T[] {
  const value = argument(name);
  if (!value) return [...all];
  const picked = value.split(",").map((entry) => entry.trim());
  const unknown = picked.filter((entry) => !all.some((known) => known === entry));
  if (unknown.length > 0) throw new Error(`Unknown --${name}: ${unknown.join(", ")}. Use: ${all.join(", ")}.`);
  return all.filter((known) => picked.includes(known));
}
const providers = listArgument("providers", BENCH_PROVIDERS);
const scenarios = listArgument("scenarios", SCENARIOS);
const comparePath = argument("compare");
// The CLIs read the real HOME, for a sign-in that a copied file cannot carry, such as the Keychain.
// Only for providers whose CLI writes nothing but its own sessions there; OpenBot's own data stays
// in the temporary profile.
const REAL_HOME_PROVIDERS: readonly BenchProvider[] = ["antigravity", "grok"];
const useRealHome = process.argv.includes("--real-home");
if (useRealHome && providers.some((provider) => !REAL_HOME_PROVIDERS.includes(provider)))
  throw new Error(`--real-home is only for --providers=${REAL_HOME_PROVIDERS.join(",")}.`);

/** The CLI on PATH, found before HOME changes. */
function which(command: string): string | null {
  const found = spawnSync("which", [command], { encoding: "utf8" });
  return found.status === 0 ? found.stdout.trim() || null : null;
}

/** The newest Antigravity ACP server that OpenBot downloaded: OpenBot never runs `agy` itself. */
function managedAntigravityServer(): string | null {
  const configured = process.env.OPENBOT_ANTIGRAVITY_PATH?.trim();
  if (configured) return configured;
  const target = `${process.platform}-${process.arch}`;
  const base = join(realHome, "Library/Application Support/OpenBot/provider-runtimes/antigravity", target);
  if (!existsSync(base)) return null;
  const versions = readdirSync(base)
    .filter((entry) => /^\d+\.\d+\.\d+$/u.test(entry))
    .sort((a, b) => {
      const left = a.split(".").map(Number);
      const right = b.split(".").map(Number);
      for (let index = 0; index < 3; index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return 0;
    });
  const newest = versions.at(-1);
  if (!newest) return null;
  const manifest = JSON.parse(readFileSync(join(base, newest, "antigravity-package.json"), "utf8"));
  return typeof manifest.executable === "string" ? join(base, newest, manifest.executable) : null;
}

const executables: Record<BenchProvider, string | null> = {
  claude: process.env.OPENBOT_CLAUDE_PATH?.trim() || which("claude"),
  codex: process.env.OPENBOT_CODEX_PATH?.trim() || which("codex"),
  antigravity: managedAntigravityServer(),
  opencode: process.env.OPENBOT_OPENCODE_PATH?.trim() || which("opencode"),
  grok: process.env.OPENBOT_GROK_PATH?.trim() || which("grok"),
};

function cliVersion(provider: BenchProvider): string | null {
  const executable = executables[provider];
  if (!executable) return null;
  if (provider === "antigravity") {
    const manifest = join(dirname(dirname(executable)), "antigravity-package.json");
    return existsSync(manifest) ? String(JSON.parse(readFileSync(manifest, "utf8")).version) : null;
  }
  const result = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 30_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

const root = await mkdtemp(join(tmpdir(), "openbot-token-bench-"));
const userData = join(root, "user-data");
const home = join(root, "home");
const bareCwd = join(root, "bare-cwd");
mkdirSync(bareCwd, { recursive: true });

// Only the sign-in files, and the files that name the sign-in method. The real CLI folders stay
// untouched. The Antigravity ACP server reads its method from `antigravity-acp/settings.json`.
const AUTH_FILES = [
  ".codex/auth.json",
  ".gemini/oauth_creds.json",
  ".gemini/google_accounts.json",
  ".gemini/settings.json",
  ".gemini/antigravity-acp/settings.json",
  ".local/share/opencode/auth.json",
  ".grok/auth.json",
];
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const copiedAuth = new Map<string, string>();
mkdirSync(home, { recursive: true });
for (const file of useRealHome ? [] : AUTH_FILES) {
  const source = join(realHome, file);
  if (!existsSync(source)) continue;
  mkdirSync(dirname(join(home, file)), { recursive: true });
  copyFileSync(source, join(home, file));
  copiedAuth.set(file, sha(join(home, file)));
}

const cliVersions = Object.fromEntries(BENCH_PROVIDERS.map((provider) => [provider, cliVersion(provider)]));

// Before the service modules load: the stores and the provider CLIs read the home folder.
if (!useRealHome) {
  process.env.HOME = home;
  process.env.CODEX_HOME = join(home, ".codex");
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  process.env.XDG_DATA_HOME = join(home, ".local/share");
  process.env.XDG_CACHE_HOME = join(home, ".cache");
  process.env.XDG_STATE_HOME = join(home, ".local/state");
}
delete process.env.GEMINI_HOME;
delete process.env.CLAUDE_CONFIG_DIR;
for (const provider of BENCH_PROVIDERS) {
  const executable = executables[provider];
  if (executable) process.env[`OPENBOT_${provider.toUpperCase()}_PATH`] = executable;
}

const { AgentService } = await import("../src/backend/agent-service");
const { AgentStore } = await import("../src/backend/agent-store");
const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { MailboxStore } = await import("../src/backend/mailbox-store");
const { OpenBotDatabase } = await import("../src/backend/openbot-database");

interface Tokens {
  uncachedInput: number | null;
  cachedInput: number | null;
  cacheCreation: number | null;
  output: number | null;
}

interface TurnResult extends Tokens {
  turn: number;
  prompt: string;
  /** Model requests in the turn: OpenBot usage records, or the CLI's own count. Null when unknown. */
  requests: number | null;
  /** Provider sessions on the thread after the turn (OpenBot), or the CLI session id (bare). */
  sessions: number | null;
  sessionIds: string[];
  newSession: boolean;
  status: string;
  retried: boolean;
  answer?: string | null;
  error?: string;
  /** Tokens of another channel member during this turn. */
  otherMember?: Tokens & { requests: number };
  /** The provider's own id of the session that ran the turn, when OpenBot has no usage record of it. */
  providerSessionId?: string | null;
  /** Where the tokens come from when not from OpenBot's usage records, such as `grok usage`. */
  usageSource?: string;
  durationMs: number;
}

interface ScenarioResult {
  status: "ok" | "failed" | "skipped";
  reason?: string;
  model?: string;
  effort?: string;
  notes?: string[];
  turns: TurnResult[];
  /** Usage records of the scenario's agents that no measured turn holds. */
  unmeasured?: Tokens & { requests: number };
}

interface ProviderReport {
  status: "ran" | "skipped";
  reason?: string;
  executable: string | null;
  version: string | null;
  model?: string;
  effort?: string;
  scenarios: Partial<Record<Scenario, ScenarioResult>>;
}

interface OverheadRow extends Tokens {
  turn: number;
  totalInput: number | null;
}

interface Report {
  generatedAt: string;
  commit: string;
  dirty: boolean;
  cliVersions: Record<string, string | null>;
  selection: { providers: BenchProvider[]; scenarios: Scenario[] };
  providers: Partial<Record<BenchProvider, ProviderReport>>;
  /** OpenBot chat-trivial minus bare-cli, per turn. */
  overhead: Partial<Record<BenchProvider, OverheadRow[]>>;
  authFiles: Array<{ file: string; changed: boolean }>;
  keptHome?: string;
  notes: string[];
  error?: string;
}

const git = (args: string[]) => spawnSync("git", args, { cwd: REPO, encoding: "utf8" }).stdout.trim();
const report: Report = {
  generatedAt: new Date().toISOString(),
  commit: git(["rev-parse", "HEAD"]),
  dirty: git(["status", "--porcelain"]).length > 0,
  cliVersions,
  selection: { providers, scenarios },
  providers: {},
  overhead: {},
  authFiles: [],
  notes: [
    useRealHome
      ? "--real-home: the CLIs read the real HOME, with its sign-in, skills and settings. OpenBot's own data stays in a temporary profile."
      : "The temporary HOME has no skills, plugins, MCP servers or CLI settings, so this is the smallest case.",
    "Antigravity bare-cli runs the same ACP server as OpenBot with no OpenBot prompt or tools, not `agy -p`.",
    "Codex bare-cli reports one usage per turn; its request count is unknown.",
    "The bench agents have Full access: every approval is answered with accept.",
  ],
};

const unused = () => Effect.die(new Error("Not used by this benchmark."));
const browser: AgentBrowserHost = {
  listTabs: () => [],
  beginTakeover: unused,
  endTakeover: () => {},
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
};

async function waitFor<T>(label: string, read: () => T | null | undefined | false, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

const sum = (values: Array<number | null>): number | null =>
  values.some((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0);
function addTokens(list: Tokens[]): Tokens {
  return {
    uncachedInput: sum(list.map((entry) => entry.uncachedInput)),
    cachedInput: sum(list.map((entry) => entry.cachedInput)),
    cacheCreation: sum(list.map((entry) => entry.cacheCreation)),
    output: sum(list.map((entry) => entry.output)),
  };
}
const totalInput = (tokens: Tokens) => sum([tokens.uncachedInput, tokens.cachedInput, tokens.cacheCreation]);

// ---------------------------------------------------------------------------------------------
// Bare CLIs

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(executable: string, args: string[], timeoutMs = TURN_TIMEOUT_MS): Promise<Run> {
  return new Promise((done) => {
    const child = spawn(executable, args, { cwd: bareCwd, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr });
    });
    child.stdin.end();
  });
}

const jsonLines = (text: string) =>
  text.split("\n").flatMap((line) => {
    try {
      return line.trim().startsWith("{") ? [JSON.parse(line)] : [];
    } catch {
      return [];
    }
  });
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

interface BareTurn extends Tokens {
  durationMs?: number;
  sessionId: string | null;
  requests: number | null;
  answer: string | null;
  error?: string;
}

async function bareClaude(model: string, prompt: string, sessionId: string | null): Promise<BareTurn> {
  const executable = executables.claude ?? "claude";
  const args = ["-p", "--output-format", "json", "--model", model, ...(sessionId ? ["--resume", sessionId] : [])];
  const result = await run(executable, [...args, prompt]);
  const value = jsonLines(result.stdout).at(-1);
  const usage = value?.usage ?? {};
  return {
    sessionId: typeof value?.session_id === "string" ? value.session_id : sessionId,
    requests: num(value?.num_turns),
    uncachedInput: num(usage.input_tokens),
    cachedInput: num(usage.cache_read_input_tokens),
    cacheCreation: num(usage.cache_creation_input_tokens),
    output: num(usage.output_tokens),
    answer: typeof value?.result === "string" ? value.result : null,
    ...(value?.is_error || result.code !== 0 ? { error: String(value?.result ?? result.stderr).slice(0, 500) } : {}),
  };
}

async function bareCodex(model: string, effort: string, prompt: string, sessionId: string | null): Promise<BareTurn> {
  const executable = executables.codex ?? "codex";
  const common = ["--json", "--skip-git-repo-check", "--ignore-user-config", "-m", model];
  const config = ["-c", `model_reasoning_effort="${effort}"`];
  const args = sessionId
    ? ["exec", "resume", ...common, ...config, sessionId, prompt]
    : ["exec", ...common, ...config, prompt];
  const result = await run(executable, args);
  const events = jsonLines(result.stdout);
  const started = events.find((event) => event.type === "thread.started");
  const completed = events.findLast((event) => event.type === "turn.completed");
  const usage = completed?.usage ?? {};
  const input = num(usage.input_tokens);
  const cached = num(usage.cached_input_tokens);
  const written = num(usage.cache_write_input_tokens) ?? 0;
  const failure = events.find((event) => event.type === "turn.failed" || event.type === "error");
  return {
    sessionId: typeof started?.thread_id === "string" ? started.thread_id : sessionId,
    requests: null,
    // Codex input counts include the cached input and the cache writes.
    uncachedInput: input !== null && cached !== null ? input - cached - written : null,
    cachedInput: cached,
    cacheCreation: written,
    output: num(usage.output_tokens),
    answer:
      events.findLast((event) => event.type === "item.completed" && event.item?.type === "agent_message")?.item?.text ??
      null,
    ...(failure || !completed || result.code !== 0
      ? { error: JSON.stringify(failure ?? result.stderr.slice(-500)).slice(0, 500) }
      : {}),
  };
}

async function bareOpenCode(model: string, prompt: string, sessionId: string | null): Promise<BareTurn> {
  const executable = executables.opencode ?? "opencode";
  const args = ["run", "--format", "json", "-m", model, ...(sessionId ? ["-s", sessionId] : []), prompt];
  const result = await run(executable, args);
  const events = jsonLines(result.stdout);
  const steps = events.filter((event) => event.type === "step_finish");
  const tokens = steps.map((step) => step.part?.tokens ?? {});
  const failure = events.find((event) => event.type === "error");
  return {
    sessionId: events.find((event) => typeof event.sessionID === "string")?.sessionID ?? sessionId,
    requests: steps.length,
    // OpenCode `input` is the uncached input; reasoning is billed as output.
    uncachedInput: sum(tokens.map((entry) => num(entry.input))),
    cachedInput: sum(tokens.map((entry) => num(entry.cache?.read) ?? 0)),
    cacheCreation: sum(tokens.map((entry) => num(entry.cache?.write) ?? 0)),
    output: sum(tokens.map((entry) => sum([num(entry.output), num(entry.reasoning) ?? 0]))),
    answer: events
      .filter((event) => event.type === "text")
      .map((event) => event.part?.text ?? "")
      .join(""),
    ...(failure || steps.length === 0
      ? { error: JSON.stringify(failure ?? result.stderr.slice(-500)).slice(0, 500) }
      : {}),
  };
}

/** The first `usage` object anywhere in a Grok JSON answer, which names its fields in either case. */
function findUsage(value: unknown): DynamicRecord | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findUsage(entry);
      if (found) return found;
    }
    return null;
  }
  if (!isDynamicRecord(value)) return null;
  if (isDynamicRecord(value.usage)) return value.usage;
  for (const entry of Object.values(value)) {
    const found = findUsage(entry);
    if (found) return found;
  }
  return null;
}

async function bareGrok(model: string, prompt: string, sessionId: string | null): Promise<BareTurn> {
  const executable = executables.grok ?? "grok";
  const args = ["-p", prompt, "--output-format", "json", "-m", model, "--cwd", bareCwd];
  const result = await run(executable, [...args, ...(sessionId ? ["-r", sessionId] : [])]);
  const value = safeJson(result.stdout) ?? jsonLines(result.stdout).at(-1) ?? null;
  const usage = findUsage(value);
  const pick = (...names: string[]) => {
    for (const name of names) {
      const found = num(usage?.[name]);
      if (found !== null) return found;
    }
    return null;
  };
  const input = pick("input_tokens", "inputTokens", "prompt_tokens");
  const cached = pick("cache_read_input_tokens", "cachedReadTokens", "cachedInputTokens", "cached_tokens") ?? 0;
  const written = pick("cache_creation_input_tokens", "cachedWriteTokens", "cacheWriteTokens") ?? 0;
  // Anthropic-style counts keep cache reads out of `input_tokens`; ACP-style counts include them.
  const inputIncludesCache = usage !== null && ("inputTokens" in usage || "prompt_tokens" in usage);
  const text = value?.result ?? value?.text ?? value?.response;
  const id = value?.session_id ?? value?.sessionId;
  return {
    sessionId: typeof id === "string" ? id : sessionId,
    requests: null,
    uncachedInput: input === null ? null : inputIncludesCache ? input - cached - written : input,
    cachedInput: cached,
    cacheCreation: written,
    output: sum([
      pick("output_tokens", "outputTokens", "completion_tokens"),
      pick("reasoning_tokens", "thoughtTokens") ?? 0,
    ]),
    answer: typeof text === "string" ? text : null,
    ...(input === null
      ? { error: `No usage in the Grok answer: ${(result.stdout || result.stderr).slice(0, 600)}` }
      : {}),
  };
}

/** A minimal ACP client for the Antigravity server: no OpenBot prompt, no MCP servers. */
class BareAcp {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #pending = new Map<number, { done: (value: unknown) => void; fail: (error: Error) => void }>();
  #next = 1;
  #buffer = "";
  #text = "";
  stderr = "";

  constructor(executable: string) {
    this.#child = spawn(executable, [], {
      cwd: bareCwd,
      env: { ...process.env, BROWSER: "true", AGY_ACP_FORCE_FILE_STORAGE: "1" },
    });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk: string) => this.#read(chunk));
    this.#child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-4000);
      // With no valid token the server waits for a browser sign-in that never comes.
      if (/Open the following link to authenticate/u.test(this.stderr))
        this.#failAll("The server asks for a browser sign-in.");
    });
    this.#child.on("close", () => this.#failAll(`ACP server exited. ${this.stderr}`));
  }

  #failAll(reason: string) {
    for (const pending of this.#pending.values()) pending.fail(new Error(reason));
    this.#pending.clear();
  }

  #write(message: DynamicRecord) {
    this.#child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }

  #read(chunk: string) {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      newline = this.#buffer.indexOf("\n");
      if (!line.startsWith("{")) continue;
      const message = JSON.parse(line);
      if (message.method && message.id !== undefined) {
        // The bare client grants nothing: no files, no terminal, no permission.
        if (message.method === "session/request_permission")
          this.#write({ id: message.id, result: { outcome: { outcome: "cancelled" } } });
        else this.#write({ id: message.id, error: { code: -32601, message: `Not supported: ${message.method}` } });
      } else if (message.method === "session/update") {
        const update = message.params?.update;
        if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text")
          this.#text += update.content.text;
      } else if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) pending?.fail(new Error(JSON.stringify(message.error)));
        else pending?.done(message.result);
      }
    }
  }

  request(method: string, params: DynamicRecord, timeoutMs = TURN_TIMEOUT_MS): Promise<DynamicRecord> {
    const id = this.#next++;
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        fail(new Error(`ACP ${method} timed out.`));
      }, timeoutMs);
      this.#pending.set(id, {
        done: (value) => {
          clearTimeout(timer);
          done(record(value));
        },
        fail: (error) => {
          clearTimeout(timer);
          fail(error);
        },
      });
      this.#write({ id, method, params });
    });
  }

  takeText(): string {
    const text = this.#text;
    this.#text = "";
    return text;
  }

  close() {
    this.#child.kill("SIGTERM");
  }
}

const record = (value: unknown): DynamicRecord => (isDynamicRecord(value) ? value : {});
const records = (value: unknown): DynamicRecord[] => (Array.isArray(value) ? value.map(record) : []);
/** The values of an ACP select option, flat or grouped. */
const selectValues = (option: DynamicRecord): string[] =>
  records(option.options).flatMap((entry) =>
    Array.isArray(entry.options) ? selectValues(entry) : isString(entry.value) ? [entry.value] : [],
  );

/** Opens a bare ACP session on `model` and `effort`. Returns the session and the listed model ids. */
async function openBareAcp(acp: BareAcp, model: string | null, effort: string | null) {
  await acp.request(
    "initialize",
    { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } },
    120_000,
  );
  const session = await acp.request("session/new", { cwd: bareCwd, mcpServers: [] }, 180_000);
  const sessionId = String(session.sessionId);
  const listed = records(record(session.models).availableModels).flatMap((entry) =>
    isString(entry.modelId) ? [entry.modelId] : [],
  );
  const configOptions = records(session.configOptions);
  const applied: string[] = [];
  for (const [category, value] of [
    ["model", model],
    ["thought_level", effort],
  ] as const) {
    if (!value) continue;
    const option = configOptions.find(
      (candidate) => candidate.category === category && selectValues(candidate).includes(value),
    );
    if (option) {
      await acp.request("session/set_config_option", { sessionId, configId: String(option.id), value }, 60_000);
      applied.push(`${category}=${value}`);
    } else if (category === "model" && listed.includes(value)) {
      await acp.request("session/set_model", { sessionId, modelId: value }, 60_000);
      applied.push(`model=${value}`);
    }
  }
  return { sessionId, listed, applied };
}

async function bareAntigravity(model: string, effort: string): Promise<{ turns: BareTurn[]; notes: string[] }> {
  const acp = new BareAcp(executables.antigravity ?? "");
  try {
    const { sessionId, applied } = await openBareAcp(acp, model, effort);
    const turns: BareTurn[] = [];
    for (const prompt of PROMPTS) {
      const startedAt = Date.now();
      const result = await acp.request("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] });
      const usage = record(result.usage);
      const input = num(usage.inputTokens);
      const cached = num(usage.cachedReadTokens) ?? 0;
      const written = num(usage.cachedWriteTokens) ?? 0;
      turns.push({
        sessionId,
        requests: null,
        // ACP `inputTokens` include the cache reads and writes; Gemini bills thinking as output.
        uncachedInput: input === null ? null : input - cached - written,
        cachedInput: cached,
        cacheCreation: written,
        output: sum([num(usage.outputTokens), num(usage.thoughtTokens) ?? 0]),
        answer: acp.takeText(),
        durationMs: Date.now() - startedAt,
        ...(input === null ? { error: `No usage in the prompt result: ${JSON.stringify(result).slice(0, 300)}` } : {}),
      });
    }
    return { turns, notes: [`Session settings applied: ${applied.join(", ") || "none"}.`] };
  } finally {
    acp.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Preflight: no model request where the CLI has a sign-in check.

async function preflight(provider: BenchProvider): Promise<string | null> {
  const executable = executables[provider];
  if (!executable || !existsSync(executable)) return `No executable found (${executable ?? "not on PATH"}).`;
  if (provider === "claude") {
    const result = await run(executable, ["auth", "status"], 60_000);
    const status = safeJson(result.stdout);
    return status?.loggedIn === true
      ? null
      : `Not signed in with a temporary HOME (claude auth status: loggedIn=${String(status?.loggedIn)}). The macOS Claude sign-in is in the login Keychain, which a temporary HOME does not reach.`;
  }
  if (provider === "codex") {
    const result = await run(executable, ["login", "status"], 60_000);
    return result.code === 0 ? null : `Not signed in: ${(result.stderr || result.stdout).trim().slice(0, 300)}`;
  }
  if (provider === "grok") {
    const result = await run(executable, ["models"], 120_000);
    return result.code === 0 ? null : `grok models failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`;
  }
  if (provider === "opencode") {
    const result = await run(executable, ["models"], 120_000);
    return result.code === 0
      ? null
      : `opencode models failed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`;
  }
  const acp = new BareAcp(executable);
  try {
    const { listed } = await openBareAcp(acp, null, null);
    return listed.length > 0 ? null : "The Antigravity ACP server listed no models: not signed in.";
  } catch (error) {
    return `The Antigravity ACP server did not open a session: ${String(error).slice(0, 400)}`;
  } finally {
    acp.close();
  }
}

function safeJson(text: string): DynamicRecord | null {
  try {
    return record(JSON.parse(text));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// OpenBot service

const MODEL_PREFERENCE: Record<BenchProvider, RegExp[]> = {
  claude: [/haiku/iu],
  codex: [/^gpt-6-luna$/u, /luna/iu, /mini/iu],
  antigravity: [/flash-lite/iu, /flash/iu],
  opencode: [/^opencode\/big-pickle$/u, /-free$/u],
  grok: [/fast/iu, /mini/iu],
};

function cheapestModel(provider: BenchProvider, models: AgentModelOption[]): AgentModelOption | null {
  const listed = models.filter((model) => model.provider === provider);
  for (const pattern of MODEL_PREFERENCE[provider]) {
    const match = listed.find((model) => pattern.test(model.id));
    if (match) return match;
  }
  return listed[0] ?? null;
}
const lowEffort = (model: AgentModelOption): AgentReasoningEffort =>
  model.supportedReasoningEfforts.includes("low") ? "low" : model.defaultReasoningEffort;

const available: BenchProvider[] = [];
for (const provider of providers) {
  const reason = await preflight(provider);
  report.providers[provider] = {
    status: reason ? "skipped" : "ran",
    ...(reason ? { reason } : {}),
    executable: executables[provider],
    version: cliVersions[provider] ?? null,
    scenarios: {},
  };
  if (!reason) available.push(provider);
  process.stdout.write(`preflight ${provider}: ${reason ?? "ok"}\n`);
}

const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, home, database);
const mailbox = new MailboxStore(userData, store.sharedRoot, store.database);
const preferred: Provider = available[0] ?? "codex";
const agents = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: preferred,
  offProviders: AGENT_PROVIDERS.filter((provider) => !available.some((on) => on === provider)),
  // Nobody answers an approval here. An ACP agent asks before it calls an OpenBot tool, such as
  // channel_result, and its turn would wait for good. The agents work in a temporary workspace.
  approvalAutomation: { autoApproves: () => true },
});
let connection: DatabaseSync | null = null;
const sqlite = () => {
  connection ??= new DatabaseSync(database.path);
  return connection;
};
const closeReader = () => connection?.close();

interface RecordRow extends Tokens {
  key: string;
  agentId: string;
  sessionId: string;
  threadId: string | null;
  turnId: string;
}

function agentRecords(agentId: string): RecordRow[] {
  return sqlite()
    .prepare(
      `SELECT r.agent_id, r.record_id, r.session_id, r.turn_id, r.tokens_json, s.thread_id
       FROM agent_usage_records r LEFT JOIN projection_provider_sessions s ON s.id = r.session_id
       WHERE r.agent_id = ? ORDER BY r.recorded_at, r.rowid`,
    )
    .all(agentId)
    .map((row) => {
      const tokens = decodeUsageTokens(JSON.parse(String(row.tokens_json)));
      return {
        key: `${String(row.agent_id)}:${String(row.record_id)}`,
        agentId: String(row.agent_id),
        sessionId: String(row.session_id),
        threadId: typeof row.thread_id === "string" ? row.thread_id : null,
        turnId: String(row.turn_id),
        uncachedInput: tokens.uncachedInput,
        cachedInput: tokens.cachedInput,
        cacheCreation: tokens.cacheCreation,
        output: tokens.output,
      };
    });
}

/** The provider's own id of the thread's active session. */
const activeProviderSessionId = (threadId: string): string | null => {
  const row = sqlite()
    .prepare(
      "SELECT external_session_id FROM projection_provider_sessions WHERE thread_id = ? AND state = 'active' ORDER BY rowid DESC LIMIT 1",
    )
    .get(threadId);
  return row ? String(row.external_session_id) : null;
};

/**
 * Grok gives OpenBot no token counts, so its turns are read from `grok usage <session>`: the CLI's
 * own record of each turn of the session. `inputTokens` include the cache reads; reasoning is output.
 */
async function grokSessionTurns(sessionId: string): Promise<Array<Tokens & { requests: number | null }> | null> {
  const result = await run(executables.grok ?? "grok", ["usage", sessionId], 60_000);
  const value = safeJson(result.stdout);
  if (!value || !Array.isArray(value.turns)) return null;
  return records(value.turns).map((turn) => {
    const input = num(turn.inputTokens);
    const cached = num(turn.cachedReadTokens) ?? 0;
    const written = num(turn.cacheCreationTokens) ?? 0;
    return {
      requests: num(turn.modelCalls),
      uncachedInput: input === null ? null : input - cached - written,
      cachedInput: cached,
      cacheCreation: written,
      output: sum([num(turn.outputTokens), num(turn.reasoningTokens) ?? 0]),
    };
  });
}

/** Fills the Grok turns of a scenario from `grok usage`, in the order each session ran them. */
async function fillGrokUsage(result: ScenarioResult): Promise<void> {
  const bySession = new Map<string, TurnResult[]>();
  for (const turn of result.turns) {
    if (!turn.providerSessionId) continue;
    bySession.set(turn.providerSessionId, [...(bySession.get(turn.providerSessionId) ?? []), turn]);
  }
  for (const [sessionId, turns] of bySession) {
    const recorded = await grokSessionTurns(sessionId);
    if (!recorded) {
      result.notes = [...(result.notes ?? []), `grok usage gave no turns for session ${sessionId}.`];
      continue;
    }
    if (recorded.length !== turns.length)
      result.notes = [
        ...(result.notes ?? []),
        `Session ${sessionId}: grok usage has ${recorded.length} turns for ${turns.length} bench turns; matched in order.`,
      ];
    turns.forEach((turn, index) => {
      const entry = recorded[index];
      if (!entry) return;
      Object.assign(turn, entry, { usageSource: "grok usage" });
    });
  }
}

const sessionsOnThread = (threadId: string) =>
  Number(
    sqlite().prepare("SELECT COUNT(*) AS count FROM projection_provider_sessions WHERE thread_id = ?").get(threadId)
      ?.count ?? 0,
  );

const idle = (agentId: string) =>
  agents
    .listQueue(agentId)
    .deliveries.every((delivery) => !["queued", "starting", "running"].includes(delivery.status));

async function settle(deliveryId: string) {
  return waitFor(
    "the delivery to end",
    () => {
      const delivery = mailbox.getDelivery(deliveryId)?.delivery;
      return delivery && ["completed", "failed", "interrupted"].includes(delivery.status) ? delivery : null;
    },
    TURN_TIMEOUT_MS,
  );
}

/** New usage records since `before`, after the agent is idle and the turn's usage is written. */
async function newRecords(agentId: string, before: Set<string>, turnId: string | null) {
  await waitFor("the agent to be idle", () => idle(agentId), TURN_TIMEOUT_MS);
  await waitFor(
    "the turn's usage records",
    () => agentRecords(agentId).some((row) => !before.has(row.key) && (turnId === null || row.turnId === turnId)),
    30_000,
  ).catch(() => undefined);
  return agentRecords(agentId).filter((row) => !before.has(row.key));
}

interface TurnContext {
  agentId: string;
  threadId: () => string | null;
  seenSessions: Set<string>;
}

function turnResult(
  turn: number,
  prompt: string,
  rows: RecordRow[],
  context: TurnContext,
  status: string,
  startedAt: number,
  retried: boolean,
  error: string | null,
): TurnResult {
  const threadId = rows.find((row) => row.threadId)?.threadId ?? context.threadId();
  // A provider that reports no usage leaves no record, so the thread's active session names the turn.
  const providerSessionId = rows.length === 0 && threadId ? activeProviderSessionId(threadId) : null;
  const sessionIds = providerSessionId ? [providerSessionId] : [...new Set(rows.map((row) => row.sessionId))];
  const newSession = turn > 1 && sessionIds.some((id) => !context.seenSessions.has(id));
  for (const id of sessionIds) context.seenSessions.add(id);
  return {
    ...(providerSessionId ? { providerSessionId } : {}),
    turn,
    prompt,
    requests: rows.length,
    ...addTokens(rows),
    sessions: threadId ? sessionsOnThread(threadId) : null,
    sessionIds,
    newSession,
    status,
    retried,
    ...(error ? { error } : {}),
    durationMs: Date.now() - startedAt,
  };
}

/** One chat turn. A transient failure runs once more. */
async function chatTurn(context: TurnContext, turn: number, prompt: string, firstDelivery?: string) {
  const startedAt = Date.now();
  const before = new Set(agentRecords(context.agentId).map((row) => row.key));
  let retried = false;
  let deliveryId = firstDelivery;
  for (;;) {
    if (!deliveryId) {
      const receipt = await runCauseEffect(agents.sendMessage({ agentId: context.agentId, text: prompt }));
      deliveryId = receipt.deliveries[0]?.id;
      if (!deliveryId) throw new Error("The message has no delivery.");
    }
    const delivery = await settle(deliveryId);
    if (delivery.status !== "completed" && !retried && TRANSIENT.test(delivery.error ?? "")) {
      retried = true;
      deliveryId = undefined;
      continue;
    }
    const rows = await newRecords(context.agentId, before, delivery.turnId ?? null);
    return turnResult(turn, prompt, rows, context, delivery.status, startedAt, retried, delivery.error ?? null);
  }
}

let agentCount = 0;
async function newChatAgent(provider: BenchProvider, model: AgentModelOption, firstPrompt: string) {
  agentCount += 1;
  const agent = await runCauseEffect(
    agents.createAgent({
      name: `Bench ${agentCount}`,
      description: "Answers briefly.",
      avatarSeed: `bench-${agentCount}`,
      avatarHue: null,
      initialMessage: firstPrompt,
      provider,
      model: model.id,
      reasoningEffort: lowEffort(model),
    }),
  );
  const deliveryId = await waitFor("the first delivery", () => agents.listQueue(agent.id).deliveries[0]?.id, 30_000);
  const context: TurnContext = {
    agentId: agent.id,
    threadId: () => store.list().find((candidate) => candidate.id === agent.id)?.threadId ?? null,
    seenSessions: new Set(),
  };
  return { agent, deliveryId, context };
}

function unmeasured(agentIds: string[], measured: Set<string>) {
  const rows = agentIds.flatMap((agentId) => agentRecords(agentId)).filter((row) => !measured.has(row.key));
  return { requests: rows.length, ...addTokens(rows) };
}

async function chatTrivial(provider: BenchProvider, model: AgentModelOption): Promise<ScenarioResult> {
  const { agent, deliveryId, context } = await newChatAgent(provider, model, PROMPTS[0] ?? "");
  const turns: TurnResult[] = [];
  const measured = new Set<string>();
  for (const [index, prompt] of PROMPTS.entries()) {
    const before = new Set(agentRecords(agent.id).map((row) => row.key));
    turns.push(await chatTurn(context, index + 1, prompt, index === 0 ? deliveryId : undefined));
    for (const row of agentRecords(agent.id)) if (!before.has(row.key)) measured.add(row.key);
  }
  return {
    status: "ok",
    model: model.id,
    effort: agent.reasoningEffort,
    turns,
    unmeasured: unmeasured([agent.id], measured),
  };
}

const MCP_SERVER = `const rl = require("node:readline").createInterface({ input: process.stdin });
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    // A started server leaves a mark: the provider gave the session the new set.
    if (process.env.BENCH_MCP_MARK) require("node:fs").appendFileSync(process.env.BENCH_MCP_MARK, "initialize\\n");
    return write({ id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "bench-empty", version: "1.0.0" } } });
  }
  if (message.method === "tools/list") return write({ id: message.id, result: { tools: [] } });
  write({ id: message.id, error: { code: -32601, message: "Method not found" } });
});
`;

async function mcpRefresh(provider: BenchProvider, model: AgentModelOption): Promise<ScenarioResult> {
  const { agent, deliveryId, context } = await newChatAgent(provider, model, PROMPTS[0] ?? "");
  const turns: TurnResult[] = [];
  const measured = new Set<string>();
  const notes: string[] = [];
  const serverFile = join(root, "bench-empty-mcp.cjs");
  const markFile = join(root, `bench-empty-mcp-${provider}.log`);
  let savedId: string | null = null;
  writeFileSync(serverFile, MCP_SERVER);
  const config: McpServerConfig = {
    // A draft has no id: the store makes one.
    id: "",
    name: "bench_empty",
    transport: "stdio",
    enabled: true,
    command: which("node") ?? process.execPath,
    args: [serverFile],
    env: [{ key: "BENCH_MCP_MARK", value: markFile }],
    envPassthrough: [],
    workingDirectory: "",
    url: "",
    headers: [],
  };
  try {
    for (const [index, prompt] of PROMPTS.entries()) {
      if (index === 2) {
        const saved = await runCauseEffect(agents.saveMcpServer({ config }));
        savedId = saved.find((entry) => entry.name === config.name)?.id ?? null;
        notes.push("Added the stdio MCP server bench_empty (no tools) through saveMcpServer before turn 3.");
      }
      const before = new Set(agentRecords(agent.id).map((row) => row.key));
      turns.push(await chatTurn(context, index + 1, prompt, index === 0 ? deliveryId : undefined));
      for (const row of agentRecords(agent.id)) if (!before.has(row.key)) measured.add(row.key);
    }
  } finally {
    if (savedId) await runCauseEffect(agents.removeMcpServer({ mcpServerId: savedId })).catch(() => undefined);
  }
  const starts = existsSync(markFile) ? readFileSync(markFile, "utf8").split("\n").filter(Boolean).length : 0;
  notes.push(
    `The added MCP server answered initialize ${starts} time(s): ${starts > 0 ? "the turn-3 session has the new set" : "the turn-3 session did not start it"}.`,
  );
  return {
    status: "ok",
    model: model.id,
    effort: agent.reasoningEffort,
    notes,
    turns,
    unmeasured: unmeasured([agent.id], measured),
  };
}

async function bareCli(provider: BenchProvider, model: AgentModelOption): Promise<ScenarioResult> {
  const effort = lowEffort(model);
  const notes: string[] = [];
  let bare: BareTurn[] = [];
  if (provider === "antigravity") {
    const result = await bareAntigravity(model.id, effort);
    bare = result.turns;
    notes.push(...result.notes);
  } else {
    const bareTurn = (prompt: string, sessionId: string | null): Promise<BareTurn> =>
      provider === "claude"
        ? bareClaude(model.id, prompt, sessionId)
        : provider === "codex"
          ? bareCodex(model.id, effort, prompt, sessionId)
          : provider === "grok"
            ? bareGrok(model.id, prompt, sessionId)
            : bareOpenCode(model.id, prompt, sessionId);
    let sessionId: string | null = null;
    for (const prompt of PROMPTS) {
      const startedAt = Date.now();
      let attempt = await bareTurn(prompt, sessionId);
      if (attempt.error && TRANSIENT.test(attempt.error)) {
        notes.push(`Retried a transient error: ${attempt.error.slice(0, 200)}`);
        attempt = await bareTurn(prompt, sessionId);
      }
      bare.push({ ...attempt, durationMs: Date.now() - startedAt });
      sessionId = attempt.sessionId ?? sessionId;
    }
  }
  const first = bare[0]?.sessionId ?? null;
  const turns = bare.map(
    (entry, index): TurnResult => ({
      turn: index + 1,
      prompt: PROMPTS[index] ?? "",
      requests: entry.requests,
      uncachedInput: entry.uncachedInput,
      cachedInput: entry.cachedInput,
      cacheCreation: entry.cacheCreation,
      output: entry.output,
      sessions: null,
      sessionIds: entry.sessionId ? [entry.sessionId] : [],
      newSession: index > 0 && entry.sessionId !== first,
      status: entry.error ? "failed" : "completed",
      retried: false,
      answer: entry.answer,
      ...(entry.error ? { error: entry.error } : {}),
      durationMs: entry.durationMs ?? 0,
    }),
  );
  return {
    status: turns.some((turn) => turn.error) ? "failed" : "ok",
    model: model.id,
    effort: provider === "opencode" || provider === "claude" || provider === "grok" ? "CLI default" : effort,
    notes,
    turns,
  };
}

/**
 * The members that the messages go to: each ACP provider that is available, as each gets the channel
 * packet its own way, else the first other available provider.
 */
const CHANNEL_TARGETS = ["antigravity", "grok", "codex", "opencode", "claude"] as const;
const CHANNEL_ACP_TARGETS: readonly BenchProvider[] = ["antigravity", "grok"];
const CHANNEL_OTHERS = ["claude", "codex", "opencode", "grok", "antigravity"] as const;

/**
 * Five messages of about 8,000 characters each, all different, so that a channel packet that repeats
 * the earlier messages shows in the tokens of each later turn.
 */
const LONG_PROMPTS = Array.from({ length: 5 }, (_, message) => {
  const lines = Array.from(
    { length: 110 },
    (_, line) => `Note ${message + 1}.${line + 1}: river ${message * 110 + line} flows north past station ${line * 7}.`,
  );
  return `Context for the record:\n${lines.join("\n")}\n\nReply with OK only.`;
});

async function channelTurns(
  target: BenchProvider,
  models: Map<BenchProvider, AgentModelOption>,
  prompts: readonly string[] = PROMPTS,
): Promise<ScenarioResult> {
  const agModel = models.get(target);
  if (!agModel) return { status: "skipped", reason: `${target} is not available.`, turns: [] };
  const otherProvider = CHANNEL_OTHERS.find((provider) => provider !== target && models.has(provider)) ?? null;
  const notes: string[] =
    target === "antigravity" ? [] : [`Antigravity is not available, so the messages go to the ${target} member.`];
  const profile = async (provider: BenchProvider, model: AgentModelOption, name: string) => {
    agentCount += 1;
    return runCauseEffect(
      agents.createAgentProfile({
        name,
        description: "Answers briefly.",
        avatarSeed: `bench-${agentCount}`,
        avatarHue: null,
        provider,
        model: model.id,
        reasoningEffort: lowEffort(model),
      }),
    );
  };
  const ag = await profile(target, agModel, "Bench Target");
  const otherModel = otherProvider ? models.get(otherProvider) : undefined;
  const other = otherProvider && otherModel ? await profile(otherProvider, otherModel, "Bench Other") : null;
  notes.push(
    other
      ? `Members: ${target} (lead, recipient, ${agModel.id}) and ${otherProvider} (${otherModel?.id}).`
      : `Members: ${target} only; no other provider is available.`,
  );
  const channelId = randomUUID();
  const actor = { id: "local", name: "Bench" };
  await runCauseEffect(
    agents.channels.command(
      {
        type: "save",
        operationId: randomUUID(),
        channelId,
        draft: {
          name: "Bench",
          title: "",
          instructions: "Keep each answer short.",
          members: [{ agentId: ag.id }, ...(other ? [{ agentId: other.id }] : [])],
          leadAgentId: ag.id,
        },
      },
      actor,
    ),
  );
  const ids = [ag.id, ...(other ? [other.id] : [])];
  const context: TurnContext = {
    agentId: ag.id,
    threadId: () => agents.channels.store.context(channelId, ag.id).threadId,
    seenSessions: new Set(),
  };
  const measured = new Set<string>();
  const turns: TurnResult[] = [];
  const terminal = ["completed", "failed", "interrupted"];
  for (const [index, prompt] of prompts.entries()) {
    const startedAt = Date.now();
    const before = new Set(ids.flatMap((agentId) => agentRecords(agentId).map((row) => row.key)));
    const assignmentsBefore = agents.channels.store.assignments(channelId).length;
    await runCauseEffect(
      agents.channels.command(
        {
          type: "send",
          operationId: randomUUID(),
          channelId,
          text: prompt,
          recipientAgentId: ag.id,
          replyToMessageId: null,
          attachmentDraftIds: [],
        },
        actor,
      ),
    );
    await waitFor(
      "the channel work to end",
      () => {
        const assignments = agents.channels.store.assignments(channelId);
        return (
          assignments.length > assignmentsBefore &&
          assignments.every((assignment) => terminal.includes(assignment.state)) &&
          ids.every(idle)
        );
      },
      TURN_TIMEOUT_MS,
    );
    const assignments = agents.channels.store.assignments(channelId).slice(assignmentsBefore);
    const agTurnId = assignments.find((assignment) => assignment.agentId === ag.id)?.turnId ?? null;
    const agRows = await newRecords(ag.id, before, agTurnId);
    const otherRows = other ? agentRecords(other.id).filter((row) => !before.has(row.key)) : [];
    for (const row of [...agRows, ...otherRows]) measured.add(row.key);
    const states = assignments.map(
      (assignment) => `${assignment.agentId === ag.id ? "ag" : "other"}:${assignment.state}`,
    );
    const result = turnResult(index + 1, prompt, agRows, context, states.join(","), startedAt, false, null);
    if (other) result.otherMember = { requests: otherRows.length, ...addTokens(otherRows) };
    turns.push(result);
  }
  return {
    status: "ok",
    model: agModel.id,
    effort: ag.reasoningEffort,
    notes,
    turns,
    unmeasured: unmeasured(ids, measured),
  };
}

// ---------------------------------------------------------------------------------------------
// Compare

const FIELDS = ["requests", "uncachedInput", "cachedInput", "cacheCreation", "output"] as const;

function compare(old: Report, current: Report): string {
  const rows: string[][] = [["provider", "scenario", "turn", ...FIELDS.map((field) => `${field} old>new (delta)`)]];
  for (const provider of BENCH_PROVIDERS) {
    const scenarioMap = current.providers[provider]?.scenarios ?? {};
    for (const scenario of SCENARIOS) {
      const now = scenarioMap[scenario];
      const was = old.providers[provider]?.scenarios?.[scenario];
      if (!now && !was) continue;
      const count = Math.max(now?.turns.length ?? 0, was?.turns.length ?? 0);
      for (let index = 0; index < count; index += 1) {
        const a = was?.turns[index];
        const b = now?.turns[index];
        rows.push([
          provider,
          scenario,
          String(index + 1) + (b?.newSession ? "*" : ""),
          ...FIELDS.map((field) => {
            const left = a?.[field] ?? null;
            const right = b?.[field] ?? null;
            const delta = left !== null && right !== null ? right - left : null;
            return `${left ?? "-"}>${right ?? "-"} (${delta === null ? "-" : delta > 0 ? `+${delta}` : delta})`;
          }),
        ]);
      }
    }
  }
  const widths = (rows[0] ?? []).map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length)));
  return `${rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ")).join("\n")}\n* = new provider session\n`;
}

// ---------------------------------------------------------------------------------------------
// Run

try {
  await runCauseEffect(agents.initialize());
  const models = new Map<BenchProvider, AgentModelOption>();
  for (const provider of available) {
    const providerReport = report.providers[provider];
    if (!providerReport) continue;
    const model = await waitFor(
      `the ${provider} models`,
      () => cheapestModel(provider, agents.listModels()),
      180_000,
    ).catch(() => null);
    if (!model) {
      providerReport.status = "skipped";
      providerReport.reason = "OpenBot listed no model for this provider.";
      continue;
    }
    models.set(provider, model);
    providerReport.model = model.id;
    providerReport.effort = lowEffort(model);
  }
  const runScenario = async (provider: BenchProvider, scenario: Scenario, work: () => Promise<ScenarioResult>) => {
    const providerReport = report.providers[provider];
    if (!providerReport) return;
    process.stdout.write(`run ${provider} ${scenario}\n`);
    try {
      const result = await work();
      if (provider === "grok" && scenario !== "bare-cli") await fillGrokUsage(result);
      providerReport.scenarios[scenario] = result;
    } catch (error) {
      providerReport.scenarios[scenario] = {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        turns: [],
      };
    }
  };
  for (const [provider, model] of models) {
    // The bare run goes first, before OpenBot writes any provider setting into the temporary HOME.
    if (scenarios.includes("bare-cli")) await runScenario(provider, "bare-cli", () => bareCli(provider, model));
    if (scenarios.includes("chat-trivial"))
      await runScenario(provider, "chat-trivial", () => chatTrivial(provider, model));
    if (scenarios.includes("mcp-refresh"))
      await runScenario(provider, "mcp-refresh", () => mcpRefresh(provider, model));
  }
  const acpTargets = CHANNEL_ACP_TARGETS.filter((provider) => models.has(provider));
  const fallbackTarget = CHANNEL_TARGETS.find((provider) => models.has(provider));
  const channelTargets = acpTargets.length > 0 ? acpTargets : fallbackTarget ? [fallbackTarget] : [];
  if (scenarios.includes("channel-3-turns"))
    for (const target of channelTargets)
      await runScenario(target, "channel-3-turns", () => channelTurns(target, models));
  if (scenarios.includes("channel-long"))
    for (const target of channelTargets)
      await runScenario(target, "channel-long", () => channelTurns(target, models, LONG_PROMPTS));

  for (const provider of models.keys()) {
    const chat = report.providers[provider]?.scenarios["chat-trivial"];
    const bare = report.providers[provider]?.scenarios["bare-cli"];
    if (!chat || !bare) continue;
    report.overhead[provider] = chat.turns.map((turn, index) => {
      const base = bare.turns[index];
      const minus = (left: number | null, right: number | null | undefined) =>
        left !== null && right !== null && right !== undefined ? left - right : null;
      const row = {
        uncachedInput: minus(turn.uncachedInput, base?.uncachedInput),
        cachedInput: minus(turn.cachedInput, base?.cachedInput),
        cacheCreation: minus(turn.cacheCreation, base?.cacheCreation),
        output: minus(turn.output, base?.output),
      };
      return { turn: turn.turn, ...row, totalInput: minus(totalInput(turn), base ? totalInput(base) : null) };
    });
  }
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  await runCauseEffect(agents.stop()).catch(() => {});
  closeReader();
  database.close();
  for (const [file, hash] of copiedAuth) {
    const path = join(home, file);
    report.authFiles.push({ file, changed: !existsSync(path) || sha(path) !== hash });
  }
  const authChanged = report.authFiles.some((entry) => entry.changed);
  if (authChanged) report.keptHome = home;
  mkdirSync(OUT, { recursive: true });
  const reportPath = join(OUT, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  // A refreshed token can make the old one invalid, so its only copy stays for the developer.
  if (!authChanged) await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.error ? "FAIL" : "DONE"} ${reportPath}\n`);
  if (authChanged)
    process.stdout.write(`A sign-in file changed. The temporary HOME stays at ${home}; nothing was copied back.\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  if (comparePath) process.stdout.write(compare(JSON.parse(readFileSync(comparePath, "utf8")), report));
}
