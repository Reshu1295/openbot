import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Variant = "base" | "patch";
type Kind = "build" | "secret" | "migration" | "deploy" | "unexpected";

interface Fixture {
  name: Variant;
  root: string;
  apiRoot: string;
  scriptPath: string;
  wranglerPath: string;
  sourceHash: string;
  copyHash: string;
}

interface Call {
  kind: Kind;
  executable: string;
  args: string[];
  argsWereArray: boolean;
  argsContainPayload: boolean;
  cwd: string | null;
  shell: boolean | null;
  stdio: string[];
  stdinEndCalls: number;
  stdinClosed: boolean;
  stdinPayloadPresent: boolean;
  stdinPayloadMatchesExpected: boolean;
  stdinHasOneTrailingNewline: boolean;
  cloudflareTokenPresent: boolean;
  cloudflareEnvironment: string | null;
  childExitCode: number;
}

interface PreloadReport {
  calls: Call[];
  errors: string[];
  argv: string[];
  cliExitCode: number;
  intercepted: boolean;
  delegated: false;
}

interface ReportCandidate {
  calls?: unknown;
  errors?: unknown;
  argv?: unknown;
  cliExitCode?: unknown;
  intercepted?: unknown;
  delegated?: unknown;
}

interface CallCandidate {
  kind?: unknown;
  executable?: unknown;
  args?: unknown;
  argsWereArray?: unknown;
  argsContainPayload?: unknown;
  cwd?: unknown;
  shell?: unknown;
  stdio?: unknown;
  stdinEndCalls?: unknown;
  stdinClosed?: unknown;
  stdinPayloadPresent?: unknown;
  stdinPayloadMatchesExpected?: unknown;
  stdinHasOneTrailingNewline?: unknown;
  cloudflareTokenPresent?: unknown;
  cloudflareEnvironment?: unknown;
  childExitCode?: unknown;
}

interface ChildResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  startError: string | null;
  stdout: string;
  stderr: string;
}

interface Action {
  kind: Kind;
  name?: string;
  exitCode: number;
}

interface Scenario {
  name: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
  buildExitCode: number;
  expectedError: string | null;
  baseActions: Action[];
  patchActions: Action[];
}

interface RunEvidence {
  variant: Variant;
  scenario: string;
  inputFingerprint: string;
  argv: string[];
  cliExitCode: number | null;
  processExitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stderr: string;
  errorMessages: string[];
  sequence: string[];
  calls: Call[];
  passed: boolean;
  failures: string[];
}

interface Check {
  name: string;
  passed: boolean;
  evidence: string;
}

interface Summary {
  status: "passed" | "failed";
  baseCommit: string;
  bunVersion: string;
  bunArchiveSha256: string;
  cliHashes: Record<string, { source: string; stagedCopy: string; matches: boolean }>;
  fixtureHashes: Record<string, string>;
  checks: Check[];
  runs: RunEvidence[];
  cliRunsStarted: boolean;
  stagingRemoved: boolean;
  failure?: string;
}

const BASE_COMMIT = "8822eb2c12602baecbd9b641fe8a4abfd2937ea0";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredSecrets = [
  "EMAIL_SMTP_PASSWORD",
  "SKILLS_ADMIN_TOKEN",
  "SITE_REPORT_HASH_SECRET",
  "REMOTE_TICKET_PRIVATE_JWK",
  "REMOTE_TICKET_PUBLIC_JWKS",
  "REMOTE_AUTH_WEBHOOK_SECRET",
];
const productionAnalytics = ["OPENPANEL_CLIENT_ID", "OPENPANEL_CLIENT_SECRET"];
const productionFullSecretOrder = [
  ...requiredSecrets,
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "BOAT_API_KEY",
  "BOAT_WEBHOOK_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "SERVER_CLAIMS_ADMIN_TOKEN",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_STATE_SECRET",
  "SLACK_ROUTE_PRIVATE_JWK",
  "SLACK_ROUTE_KEY_ID",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_STATE_SECRET",
  "DISCORD_ROUTE_PRIVATE_JWK",
  "DISCORD_ROUTE_KEY_ID",
  "TELEGRAM_BOT_ID",
  "TELEGRAM_BOT_USERNAME",
  ...productionAnalytics,
  "APNS_PRIVATE_KEY",
  "APNS_KEY_ID",
  "FCM_SERVICE_ACCOUNT",
];
const productionOmittedSecretOrder = [...requiredSecrets, ...productionAnalytics];
const testFullSecretOrder = [
  ...requiredSecrets,
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "BOAT_API_KEY",
  "BOAT_WEBHOOK_SECRET",
  "HOSTED_SERVER_TEMPLATE",
  "GITHUB_APP_PRIVATE_KEY",
  "SERVER_CLAIMS_ADMIN_TOKEN",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_STATE_SECRET",
  "SLACK_ROUTE_PRIVATE_JWK",
  "SLACK_ROUTE_KEY_ID",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_STATE_SECRET",
  "DISCORD_ROUTE_PRIVATE_JWK",
  "DISCORD_ROUTE_KEY_ID",
  "TELEGRAM_BOT_ID",
  "TELEGRAM_BOT_USERNAME",
  "HOSTED_SERVERS_ALLOWED_USER_IDS",
  "HOSTED_SERVERS_DEVELOPER_KEY",
  "APNS_PRIVATE_KEY",
  "APNS_KEY_ID",
  "FCM_SERVICE_ACCOUNT",
];

const effectsProbeSource = [
  'import { spawn } from "node:child_process";',
  "",
  "const mode = process.env.DPF_EFFECTS_MODE;",
  'const deploy = ["deploy", "--keep-vars", "--env", "test"];',
  'const commands = mode === "duplicate-deploy"',
  "  ? [deploy, deploy]",
  '  : [deploy, ["secret", "put", "CONTROL_SECRET", "--env", "test"]];',
  "for (const args of commands) {",
  '  const secret = args[0] === "secret";',
  '  const child = spawn("synthetic-wrangler", args, {',
  "    cwd: process.cwd(),",
  "    shell: false,",
  '    stdio: secret ? ["pipe", "ignore", "ignore"] : "ignore",',
  "  });",
  '  if (secret) child.stdin.end("expected-marker\\n");',
  '  await new Promise((resolve) => child.once("exit", resolve));',
  "}",
  'process.stdout.write("effects-control=complete\\n");',
].join("\n");

const preloadSource = String.raw`import { createRequire, syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";

const expectedPayloads = JSON.parse(process.env.DPF_EXPECTED_PAYLOADS || "{}");
const expectedValues = Object.values(expectedPayloads).filter((value) => typeof value === "string");
const buildExitCode = Number(process.env.DPF_BUILD_EXIT_CODE || "0");
const reportPath = process.env.DPF_REPORT_PATH;
const calls = [];
const errors = [];
globalThis.__deployPreflightErrors = errors;
globalThis.__deployPreflightSanitize = (value) => {
  let result = String(value);
  for (const expected of expectedValues) {
    if (expected) result = result.split(expected).join("[fixture-value]");
  }
  return result;
};
globalThis.__deployPreflightWriteReport = (exitCode) => {
  if (!reportPath) return;
  writeFileSync(reportPath, JSON.stringify({
    calls,
    errors,
    argv: process.argv.slice(2),
    cliExitCode: exitCode,
    intercepted: true,
    delegated: false,
  }));
};
process.once("exit", (exitCode) => globalThis.__deployPreflightWriteReport(exitCode));
delete process.env.DPF_REPORT_PATH;
delete process.env.DPF_EXPECTED_PAYLOADS;
delete process.env.DPF_BUILD_EXIT_CODE;

function classify(args) {
  if (args[0] === "run" && args[1] === "build") return "build";
  if (args[0] === "secret" && args[1] === "put") return "secret";
  if (args[0] === "d1") return "migration";
  if (args[0] === "deploy") return "deploy";
  return "unexpected";
}

function fakeSpawn(executable, args, options) {
  const actualArgs = Array.isArray(args) ? args.map(String) : [];
  const argsContainPayload = actualArgs.some((argument) =>
    expectedValues.some((value) => value.length > 0 && argument.includes(value)),
  );
  const safeArgs = actualArgs.map((argument) => {
    let safe = argument;
    for (const value of expectedValues) {
      if (value) safe = safe.split(value).join("[fixture-value]");
    }
    return safe;
  });
  const spawnOptions = options && typeof options === "object" ? options : {};
  const stdio = Array.isArray(spawnOptions.stdio)
    ? spawnOptions.stdio.map(String)
    : typeof spawnOptions.stdio === "string"
      ? [spawnOptions.stdio]
      : [];
  const call = {
    kind: classify(actualArgs),
    executable: String(executable),
    args: safeArgs,
    argsWereArray: Array.isArray(args),
    argsContainPayload,
    cwd: typeof spawnOptions.cwd === "string" ? spawnOptions.cwd : null,
    shell: typeof spawnOptions.shell === "boolean" ? spawnOptions.shell : null,
    stdio,
    stdinEndCalls: 0,
    stdinClosed: false,
    stdinPayloadPresent: false,
    stdinPayloadMatchesExpected: false,
    stdinHasOneTrailingNewline: false,
    cloudflareTokenPresent: Object.hasOwn(spawnOptions.env || {}, "CLOUDFLARE_API_TOKEN"),
    cloudflareEnvironment:
      typeof spawnOptions.env?.CLOUDFLARE_ENV === "string" ? spawnOptions.env.CLOUDFLARE_ENV : null,
    childExitCode: 0,
  };
  const name = call.kind === "secret" ? actualArgs[2] : "";
  if (call.kind === "build") call.childExitCode = buildExitCode;
  const child = new EventEmitter();
  if (stdio[0] === "pipe") {
    child.stdin = {
      end(...inputArgs) {
        call.stdinEndCalls += 1;
        call.stdinClosed = true;
        const payload = inputArgs[0];
        call.stdinPayloadPresent = inputArgs.length > 0 && typeof payload === "string";
        const expected = expectedPayloads[name];
        call.stdinPayloadMatchesExpected =
          call.stdinPayloadPresent && typeof expected === "string" && payload === expected + "\n";
        call.stdinHasOneTrailingNewline =
          typeof payload === "string" && payload.endsWith("\n") && !payload.endsWith("\n\n");
      },
    };
  }
  calls.push(call);
  setImmediate(() => {
    child.emit("exit", call.childExitCode, null);
  });
  return child;
}

const childProcess = createRequire(import.meta.url)("node:child_process");
childProcess.spawn = fakeSpawn;
syncBuiltinESMExports();
`;

const probeSource = String.raw`import { spawn } from "node:child_process";

const source = "Bun.write(process.env.DPF_REAL_SPAWN_MARKER, 'delegated').then(() => process.exit(91))";
const child = spawn(process.execPath, ["-e", source], {
  shell: false,
  stdio: "ignore",
});
const code = await new Promise((resolve) => child.once("exit", resolve));
globalThis.__deployPreflightWriteReport(0);
process.stdout.write(code === 0 ? "interposition=blocked\n" : "interposition=failed\n");
if (code !== 0) process.exitCode = 1;
`;

const stdinProbeSource = String.raw`import { spawn } from "node:child_process";

const mode = process.env.DPF_PROBE_MODE;
const child = spawn("synthetic-wrangler", ["secret", "put", "CONTROL_SECRET"], {
  cwd: process.cwd(),
  shell: false,
  stdio: ["pipe", "ignore", "ignore"],
});
if (mode === "swap") child.stdin.end("different-marker\n");
else child.stdin.end();
const code = await new Promise((resolve) => child.once("exit", resolve));
globalThis.__deployPreflightWriteReport(0);
if (code !== 0) process.exitCode = 1;
process.stdout.write("stdin-control=complete\n");
`;

const loggerSource = String.raw`export function createOpenBotLogger() {
  return {
    info() {},
    error(_label, detail) {
      const errors = globalThis.__deployPreflightErrors;
      const message =
        detail && typeof detail === "object" && typeof detail.message === "string"
          ? detail.message
          : "CLI error did not contain a message";
      if (Array.isArray(errors)) errors.push(globalThis.__deployPreflightSanitize(message));
      globalThis.__deployPreflightWriteReport(1);
    },
  };
}
export function toLogValue(value) {
  return value instanceof Error ? { name: value.name, message: value.message } : value;
}
`;

const fcmSource = String.raw`export function readFcmServiceAccount(value) {
  try {
    const account = JSON.parse(value);
    return account.project_id === "fixture-e2e" &&
      account.private_key === "synthetic:FCM_SERVICE_ACCOUNT"
      ? account
      : null;
  } catch {
    return null;
  }
}
`;

const dotenvxSource = String.raw`import { readFile } from "node:fs/promises";
export async function config(options) {
  const source = options.path
    ? await readFile(options.path, "utf8")
    : options.envs?.[0]?.value ?? "";
  for (const line of source.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator > 0) options.processEnv[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return { error: null };
}
`;

async function main(): Promise<void> {
  const sandboxRoot = sandboxArgument(process.argv.slice(2));
  const stagingRoot = resolve(join(sandboxRoot, "staging"));
  const resultPath = join(sandboxRoot, "deploy-preflight-round2.json");
  const summary: Summary = {
    status: "failed",
    baseCommit: BASE_COMMIT,
    bunVersion: process.env.DPF_BUN_VERSION ?? "unknown",
    bunArchiveSha256: process.env.DPF_BUN_ARCHIVE_SHA256 ?? "unknown",
    cliHashes: {},
    fixtureHashes: {
      preload: hashText(preloadSource),
      probe: hashText(probeSource),
      effectsProbe: hashText(effectsProbeSource),
      stdinProbe: hashText(stdinProbeSource),
      loggerStub: hashText(loggerSource),
      fcmStub: hashText(fcmSource),
      dotenvxStub: hashText(dotenvxSource),
    },
    checks: [],
    runs: [],
    cliRunsStarted: false,
    stagingRemoved: false,
  };
  try {
    if (!isWithin(sandboxRoot, stagingRoot)) throw new Error("Staging path escaped the owned sandbox.");
    await mkdir(stagingRoot, { recursive: true });
    const base = await stageFixture(stagingRoot, "base", await readBaseFiles());
    const patch = await stageFixture(stagingRoot, "patch", await readPatchFiles());
    const stdinProbe = join(stagingRoot, "stdin-probe.ts");
    const probe = join(stagingRoot, "probe-cli.ts");
    const effectsProbe = join(stagingRoot, "effects-probe.ts");
    await writeFile(stdinProbe, stdinProbeSource, "utf8");
    await writeFile(probe, probeSource, "utf8");
    await writeFile(effectsProbe, effectsProbeSource, "utf8");
    summary.cliHashes = {
      base: { source: base.sourceHash, stagedCopy: base.copyHash, matches: base.sourceHash === base.copyHash },
      patch: { source: patch.sourceHash, stagedCopy: patch.copyHash, matches: patch.sourceHash === patch.copyHash },
    };
    record(
      summary.checks,
      "base and patch CLI copies match exact source bytes",
      summary.cliHashes.base.matches && summary.cliHashes.patch.matches,
      "base=" + base.copyHash + "; patch=" + patch.copyHash,
    );

    const bun = process.execPath;
    const preload = join(stagingRoot, "block-spawn-preload.mjs");
    await writeFile(preload, preloadSource, "utf8");
    const env = processEnvironment(sandboxRoot);
    const interpositionPath = join(sandboxRoot, "interposition-probe.json");
    const markerPath = join(sandboxRoot, "unexpected-real-command.marker");
    if (existsSync(markerPath)) await rm(markerPath, { force: true });
    const interposition = await runProbe(
      bun,
      preload,
      probe,
      ["--env", "test"],
      stagingRoot,
      env,
      interpositionPath,
      {},
      {
        DPF_REAL_SPAWN_MARKER: markerPath,
      },
    );
    const interpositionReport = readReport(interpositionPath);
    const interpositionPassed =
      interposition.exitCode === 0 &&
      !interposition.signal &&
      !interposition.timedOut &&
      !interposition.startError &&
      interpositionReport.cliExitCode === interposition.exitCode &&
      interposition.stdout.includes("interposition=blocked") &&
      interpositionReport.intercepted &&
      !interpositionReport.delegated &&
      sameStrings(interpositionReport.argv, ["--env", "test"]) &&
      interpositionReport.calls.length === 1 &&
      interpositionReport.calls[0]?.executable === bun &&
      sameStrings(interpositionReport.calls[0]?.args ?? [], [
        "-e",
        "Bun.write(process.env.DPF_REAL_SPAWN_MARKER, 'delegated').then(() => process.exit(91))",
      ]) &&
      !existsSync(markerPath);
    const interpositionEvidence =
      "mini exit=" +
      String(interposition.exitCode) +
      "; recorded exit=" +
      String(interpositionReport.cliExitCode) +
      "; argv=" +
      JSON.stringify(interpositionReport.argv) +
      "; calls=" +
      String(interpositionReport.calls.length) +
      "; marker=" +
      String(existsSync(markerPath)) +
      "; output=" +
      interposition.stdout.trim();
    record(
      summary.checks,
      "preload blocks ESM spawn in a standalone entry before the original CLI runs",
      interpositionPassed,
      interpositionEvidence,
    );

    if (!interpositionPassed) {
      record(summary.checks, "CLI replay gate", false, "CLI was not started because interposition failed.");
    } else {
      const controlPayloads = { CONTROL_SECRET: "expected-marker" };
      const swapPath = join(sandboxRoot, "stdin-swapped-probe.json");
      const swapped = await runProbe(bun, preload, stdinProbe, [], stagingRoot, env, swapPath, controlPayloads, {
        DPF_PROBE_MODE: "swap",
      });
      const swapReport = readReport(swapPath);
      const swapCall = swapReport.calls[0];
      const swapCaught =
        swapped.exitCode === 0 &&
        !swapped.signal &&
        !swapped.timedOut &&
        !swapped.startError &&
        swapped.stdout.includes("stdin-control=complete") &&
        swapReport.calls.length === 1 &&
        swapCall?.stdinEndCalls === 1 &&
        swapCall.stdinClosed &&
        swapCall.stdinPayloadPresent &&
        !swapCall.stdinPayloadMatchesExpected &&
        !validInput(swapCall, controlPayloads.CONTROL_SECRET);
      record(
        summary.checks,
        "stdin negative control detects a swapped payload",
        swapCaught,
        "exit=" +
          String(swapped.exitCode) +
          "; payloadMatched=" +
          String(swapCall?.stdinPayloadMatchesExpected ?? false),
      );

      const omitPath = join(sandboxRoot, "stdin-omitted-probe.json");
      const omitted = await runProbe(bun, preload, stdinProbe, [], stagingRoot, env, omitPath, controlPayloads, {
        DPF_PROBE_MODE: "omit",
      });
      const omitReport = readReport(omitPath);
      const omitCall = omitReport.calls[0];
      const omitCaught =
        omitted.exitCode === 0 &&
        !omitted.signal &&
        !omitted.timedOut &&
        !omitted.startError &&
        omitted.stdout.includes("stdin-control=complete") &&
        omitReport.calls.length === 1 &&
        omitCall?.stdinEndCalls === 1 &&
        omitCall.stdinClosed &&
        !omitCall.stdinPayloadPresent &&
        !validInput(omitCall, controlPayloads.CONTROL_SECRET);
      record(
        summary.checks,
        "stdin negative control detects an omitted payload",
        omitCaught,
        "exit=" + String(omitted.exitCode) + "; payloadPresent=" + String(omitCall?.stdinPayloadPresent ?? false),
      );

      const effectControlsPassed =
        swapCaught && omitCaught
          ? await checkEffectRecorder(bun, preload, effectsProbe, stagingRoot, env, sandboxRoot, summary.checks)
          : false;
      if (!swapCaught || !omitCaught || !effectControlsPassed) {
        record(summary.checks, "CLI replay gate", false, "CLI was not started because a pre-replay control failed.");
      } else {
        summary.cliRunsStarted = true;
        for (const scenario of scenarios()) {
          const fingerprint = hashText(
            JSON.stringify({
              args: scenario.args,
              environment: Object.entries(scenario.environment).sort(([a], [b]) => a.localeCompare(b)),
              buildExitCode: scenario.buildExitCode,
            }),
          );
          const baseRun = await runCli(base, scenario, bun, preload, sandboxRoot, fingerprint);
          const patchRun = await runCli(patch, scenario, bun, preload, sandboxRoot, fingerprint);
          summary.runs.push(baseRun, patchRun);
          record(
            summary.checks,
            "paired replay: " + scenario.name,
            baseRun.passed && patchRun.passed && baseRun.inputFingerprint === patchRun.inputFingerprint,
            "argv=" +
              JSON.stringify(scenario.args) +
              "; input=" +
              fingerprint +
              "; base CLI/process exit=" +
              String(baseRun.cliExitCode) +
              "/" +
              String(baseRun.processExitCode) +
              " " +
              JSON.stringify(baseRun.sequence) +
              "; patch CLI/process exit=" +
              String(patchRun.cliExitCode) +
              "/" +
              String(patchRun.processExitCode) +
              " " +
              JSON.stringify(patchRun.sequence),
          );
        }
        const completeRuns = summary.runs.filter(
          (run) => run.scenario === "production-valid-complete" || run.scenario === "test-valid-complete",
        );
        record(
          summary.checks,
          "complete optional groups and synthetic FCM pass in both environments",
          completeRuns.length === 4 &&
            completeRuns.every(
              (run) =>
                run.passed &&
                run.calls.some(
                  (call) =>
                    call.kind === "secret" &&
                    call.args[2] === "FCM_SERVICE_ACCOUNT" &&
                    call.stdinPayloadMatchesExpected,
                ),
            ),
          "complete runs=" + String(completeRuns.length) + "; FCM parser=synthetic stub",
        );
        const laterBase = summary.runs.find(
          (run) => run.variant === "base" && run.scenario === "later-required-missing",
        );
        const laterPatch = summary.runs.find(
          (run) => run.variant === "patch" && run.scenario === "later-required-missing",
        );
        record(
          summary.checks,
          "baseline exposes early writes on later validation failure; patch has none",
          Boolean(
            laterBase &&
              laterPatch &&
              laterBase.processExitCode === 1 &&
              laterPatch.processExitCode === 1 &&
              laterBase.sequence.length > 0 &&
              laterPatch.sequence.length === 0 &&
              laterBase.errorMessages[0]?.includes("REMOTE_AUTH_WEBHOOK_SECRET is missing") &&
              laterPatch.errorMessages[0]?.includes("REMOTE_AUTH_WEBHOOK_SECRET is missing"),
          ),
          "base=" + JSON.stringify(laterBase?.sequence ?? []) + "; patch=" + JSON.stringify(laterPatch?.sequence ?? []),
        );
        const buildBase = summary.runs.find((run) => run.variant === "base" && run.scenario === "build-failure");
        const buildPatch = summary.runs.find((run) => run.variant === "patch" && run.scenario === "build-failure");
        record(
          summary.checks,
          "baseline mutates before a failed build; patch stops at the build",
          Boolean(
            buildBase &&
              buildPatch &&
              buildBase.processExitCode === 1 &&
              buildPatch.processExitCode === 1 &&
              buildBase.sequence.includes("migration") &&
              buildBase.sequence.includes("build(exit=1)") &&
              buildBase.sequence.indexOf("migration") < buildBase.sequence.indexOf("build(exit=1)") &&
              sameStrings(buildPatch.sequence, ["build(exit=1)"]),
          ),
          "base=" + JSON.stringify(buildBase?.sequence ?? []) + "; patch=" + JSON.stringify(buildPatch?.sequence ?? []),
        );
        const wrapper = await checkTestWrapper(base);
        record(
          summary.checks,
          "test wrapper accepts complete and rejects incomplete synthetic settings",
          wrapper.passed,
          wrapper.evidence,
        );
      }
    }
  } catch (error) {
    summary.failure = error instanceof Error ? error.message : "E2E harness failed.";
  } finally {
    try {
      if (existsSync(stagingRoot) && isWithin(sandboxRoot, stagingRoot)) {
        await rm(stagingRoot, { recursive: true, force: true });
      }
      summary.stagingRemoved = !existsSync(stagingRoot);
    } catch {
      summary.stagingRemoved = false;
      summary.failure = "Owned staging directory cleanup failed.";
    }
  }

  if (!summary.stagingRemoved) summary.failure = "Owned staging directory remains.";
  summary.status =
    summary.failure === undefined && summary.stagingRemoved && summary.checks.every((check) => check.passed)
      ? "passed"
      : "failed";
  await writeFile(resultPath, JSON.stringify(summary, null, 2), "utf8");
  process.stdout.write(
    JSON.stringify({
      status: summary.status,
      cliRunsStarted: summary.cliRunsStarted,
      checks: summary.checks.map((check) => ({ name: check.name, passed: check.passed })),
      failure: summary.failure ?? null,
      stagingRemoved: summary.stagingRemoved,
    }) + "\n",
  );
  if (summary.status !== "passed") process.exitCode = 1;
}

async function readBaseFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const path of [
    "scripts/deploy-auth-api.ts",
    "scripts/development-environment.ts",
    "scripts/development-secrets.ts",
  ]) {
    files.set(
      path,
      execFileSync("git", ["show", BASE_COMMIT + ":" + path], {
        cwd: projectRoot,
        maxBuffer: 1024 * 1024,
      }),
    );
  }
  return files;
}

async function readPatchFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const path of [
    "scripts/deploy-auth-api.ts",
    "scripts/development-environment.ts",
    "scripts/development-secrets.ts",
  ]) {
    files.set(path, await readFile(join(projectRoot, path)));
  }
  return files;
}

async function stageFixture(stagingRoot: string, name: Variant, files: Map<string, Uint8Array>): Promise<Fixture> {
  const root = join(stagingRoot, name);
  for (const [path, source] of files) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
  }
  const scriptPath = join(root, "scripts", "deploy-auth-api.ts");
  const source = files.get("scripts/deploy-auth-api.ts");
  if (!source) throw new Error("CLI source missing from fixture.");
  const copyHash = hash(await readFile(scriptPath));
  const apiRoot = join(root, "apps", "auth-api");
  const beam = join(apiRoot, "src", "vendor", "laser-flow", "LandingLaserFlow.tsx");
  const fcmModule = join(apiRoot, "src", "server", "android-notification-relay.ts");
  await mkdir(dirname(beam), { recursive: true });
  await mkdir(dirname(fcmModule), { recursive: true });
  await writeFile(beam, "\n", "utf8");
  await writeFile(fcmModule, fcmSource, "utf8");
  await writePackage(join(root, "node_modules", "@openbot", "logging"), loggerSource);
  await writePackage(join(root, "node_modules", "@dotenvx", "dotenvx"), dotenvxSource);
  return {
    name,
    root,
    apiRoot,
    scriptPath,
    wranglerPath: join(root, "node_modules", ".bin", "wrangler.exe"),
    sourceHash: hash(source),
    copyHash,
  };
}

async function writePackage(path: string, source: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }), "utf8");
  await writeFile(join(path, "index.js"), source, "utf8");
}

async function runProbe(
  bun: string,
  preload: string,
  script: string,
  cliArgs: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  reportPath: string,
  payloads: Record<string, string>,
  extraEnvironment: NodeJS.ProcessEnv = {},
): Promise<ChildResult> {
  await rm(reportPath, { force: true });
  return runProcess(bun, ["--preload", preload, script, ...cliArgs], cwd, {
    ...env,
    ...extraEnvironment,
    DPF_REPORT_PATH: reportPath,
    DPF_EXPECTED_PAYLOADS: JSON.stringify(payloads),
    DPF_BUILD_EXIT_CODE: "0",
  });
}

async function checkEffectRecorder(
  bun: string,
  preload: string,
  effectsProbe: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  sandboxRoot: string,
  checks: Check[],
): Promise<boolean> {
  const payloads = { CONTROL_SECRET: "expected-marker" };
  const singleDeploy: Action[] = [{ kind: "deploy", exitCode: 0 }];
  let allPassed = true;
  for (const mode of ["late-secret", "duplicate-deploy"] as const) {
    const reportPath = join(sandboxRoot, mode + "-effects-control.json");
    const child = await runProbe(bun, preload, effectsProbe, [], cwd, env, reportPath, payloads, {
      DPF_EFFECTS_MODE: mode,
    });
    const report = readReport(reportPath);
    const expectedActions: Action[] =
      mode === "late-secret"
        ? [
            { kind: "deploy", exitCode: 0 },
            { kind: "secret", name: "CONTROL_SECRET", exitCode: 0 },
          ]
        : [
            { kind: "deploy", exitCode: 0 },
            { kind: "deploy", exitCode: 0 },
          ];
    const completed =
      child.exitCode === 0 &&
      !child.signal &&
      !child.timedOut &&
      !child.startError &&
      child.stderr.length === 0 &&
      child.stdout.includes("effects-control=complete") &&
      report.cliExitCode === child.exitCode &&
      report.intercepted &&
      !report.delegated;
    const validSequenceRejected = !sameActions(report.calls, singleDeploy);
    const payloadMatches = mode !== "late-secret" || validInput(report.calls[1], payloads.CONTROL_SECRET);
    const passed =
      completed &&
      report.calls.length === 2 &&
      report.calls.every((call) => call.childExitCode === 0) &&
      sameActions(report.calls, expectedActions) &&
      validSequenceRejected &&
      payloadMatches;
    allPassed = allPassed && passed;
    record(
      checks,
      mode === "late-secret"
        ? "report includes a completed effect after deploy and exact sequence rejects the extra"
        : "report includes both completed deploys and exact sequence rejects the duplicate",
      passed,
      "process/recorded exit=" +
        String(child.exitCode) +
        "/" +
        String(report.cliExitCode) +
        "; calls=" +
        String(report.calls.length) +
        "; sequence=" +
        report.calls
          .map((call) => (call.kind === "secret" ? call.kind + ":" + String(call.args[2]) : call.kind))
          .join("->") +
        "; valid single-deploy sequence rejected=" +
        String(validSequenceRejected),
    );
  }
  return allPassed;
}

async function runCli(
  fixture: Fixture,
  scenario: Scenario,
  bun: string,
  preload: string,
  sandboxRoot: string,
  fingerprint: string,
): Promise<RunEvidence> {
  const reportPath = join(sandboxRoot, fixture.name + "-" + scenario.name + ".json");
  const payloads = payloadsFor(scenario.environment);
  const env: NodeJS.ProcessEnv = {
    ...processEnvironment(sandboxRoot),
    ...scenario.environment,
    DPF_REPORT_PATH: reportPath,
    DPF_EXPECTED_PAYLOADS: JSON.stringify(payloads),
    DPF_BUILD_EXIT_CODE: String(scenario.buildExitCode),
  };
  await rm(reportPath, { force: true });
  const child = await runProcess(bun, ["--preload", preload, fixture.scriptPath, ...scenario.args], fixture.root, env);
  const report = readReport(reportPath);
  const actions = fixture.name === "base" ? scenario.baseActions : scenario.patchActions;
  const sanitizedChild = child;
  const failures = validateRun(fixture, scenario, actions, sanitizedChild, report, payloads);
  let safeStderr = sanitizedChild.stderr;
  for (const value of Object.values(payloads)) {
    if (value) safeStderr = safeStderr.split(value).join("[fixture-value]");
  }
  safeStderr = safeStderr.split(sandboxRoot).join("[sandbox]").split(projectRoot).join("[worktree]").slice(0, 2000);
  return {
    variant: fixture.name,
    scenario: scenario.name,
    inputFingerprint: fingerprint,
    argv: report.argv,
    cliExitCode: report.cliExitCode,
    processExitCode: sanitizedChild.exitCode,
    signal: sanitizedChild.signal,
    timedOut: sanitizedChild.timedOut,
    stderr: safeStderr.trim(),
    errorMessages: report.errors,
    sequence: report.calls.map((call) =>
      call.kind === "secret"
        ? "secret:" + String(call.args[2])
        : call.kind === "build"
          ? "build(exit=" + String(call.childExitCode) + ")"
          : call.kind,
    ),
    calls: report.calls,
    passed: failures.length === 0,
    failures,
  };
}

function validateRun(
  fixture: Fixture,
  scenario: Scenario,
  actions: Action[],
  child: ChildResult,
  report: PreloadReport,
  payloads: Record<string, string>,
): string[] {
  const failures: string[] = [];
  const expectedExit = scenario.expectedError || scenario.buildExitCode !== 0 ? 1 : 0;
  if (report.cliExitCode !== expectedExit) failures.push("original CLI exit code differs");
  if (child.exitCode !== report.cliExitCode) failures.push("process exit code differs from the recorded CLI exit code");
  if (child.signal) failures.push("CLI process ended by signal");
  if (child.timedOut) failures.push("CLI process timed out");
  if (child.startError) failures.push("CLI process did not start");
  if (child.stderr.length > 0) failures.push("CLI process wrote stderr");
  if (!report.intercepted || report.delegated) failures.push("command interception was not verified");
  if (!sameStrings(report.argv, scenario.args)) failures.push("CLI argv differs from paired arguments");
  if (report.errors.length !== (scenario.expectedError ? 1 : 0)) failures.push("CLI error count differs");
  if (scenario.expectedError && !report.errors[0]?.includes(scenario.expectedError)) {
    failures.push("CLI error does not match expected failure");
  }
  if (!sameActions(report.calls, actions)) failures.push("effect count or order differs");

  for (let index = 0; index < report.calls.length; index += 1) {
    const call = report.calls[index];
    const action = actions[index];
    if (!call || !action) continue;
    const expectedArgs = expectedArguments(action, scenario.args);
    const executable = action.kind === "build" ? process.execPath : fixture.wranglerPath;
    const stdio = action.kind === "secret" ? ["pipe", "inherit", "inherit"] : ["inherit", "inherit", "inherit"];
    if (call.executable !== executable) failures.push("command executable differs");
    if (call.cwd !== fixture.apiRoot) failures.push("command cwd differs");
    if (call.shell !== false) failures.push("shell option differs");
    if (!call.argsWereArray || !sameStrings(call.args, expectedArgs)) failures.push("arguments or flags differ");
    if (!sameStrings(call.stdio, stdio)) failures.push("stdio differs");
    if (call.childExitCode !== action.exitCode) failures.push("synthetic command result differs");
    if (call.argsContainPayload) failures.push("fixture payload appeared in arguments");
    if (action.kind === "build") {
      const expectedEnvironment = sameStrings(scenario.args, ["--env", "test"]) ? "test" : null;
      if (call.cloudflareEnvironment !== expectedEnvironment) {
        failures.push("build environment differs");
      }
    } else {
      if (call.cloudflareTokenPresent) failures.push("Wrangler received a token");
      if (action.kind === "secret") {
        const expected = secretValue(action.name ?? "", scenario.environment);
        if (call.stdinEndCalls !== 1 || !call.stdinClosed) failures.push("stdin was not ended and closed once");
        if (!call.stdinPayloadPresent) failures.push("stdin payload is missing");
        if (!call.stdinPayloadMatchesExpected || typeof expected !== "string")
          failures.push("secret/payload association differs");
        if (!call.stdinHasOneTrailingNewline) failures.push("stdin newline differs");
        if (typeof expected === "string" && call.args.includes(expected))
          failures.push("payload appeared in arguments");
      } else if (call.stdinEndCalls !== 0) {
        failures.push("unexpected stdin on a non-secret command");
      }
    }
  }
  if (Object.values(payloads).some((value) => value.length === 0)) failures.push("empty synthetic payload");
  return failures;
}

function expectedArguments(action: Action, scenarioArgs: string[]): string[] {
  if (action.kind === "build") return ["run", "build"];
  if (action.kind === "secret") return ["secret", "put", action.name ?? "", ...scenarioArgs];
  if (action.kind === "migration") return ["d1", "migrations", "apply", "DB", "--remote", ...scenarioArgs];
  if (action.kind === "deploy") return ["deploy", "--keep-vars", ...scenarioArgs];
  return [];
}

function sameActions(actual: Call[], expected: Action[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((call, index) => {
      const action = expected[index];
      return (
        Boolean(action) &&
        call.kind === action.kind &&
        (action.kind !== "secret" || call.args[2] === action.name) &&
        call.childExitCode === action.exitCode
      );
    })
  );
}

function successActions(variant: Variant, secretNames: string[], buildExit = 0): Action[] {
  const build: Action = { kind: "build", exitCode: buildExit };
  const secrets = secretNames.map((name) => ({ kind: "secret" as const, name, exitCode: 0 }));
  const migration: Action = { kind: "migration", exitCode: 0 };
  const deploy: Action = { kind: "deploy", exitCode: 0 };
  return variant === "base"
    ? [...secrets, migration, build, ...(buildExit === 0 ? [deploy] : [])]
    : [build, ...(buildExit === 0 ? secrets : []), ...(buildExit === 0 ? [migration, deploy] : [])];
}

function failureActions(variant: Variant, names: string[]): Action[] {
  return variant === "base" ? names.map((name) => ({ kind: "secret" as const, name, exitCode: 0 })) : [];
}

function successScenario(name: string, args: string[], environment: NodeJS.ProcessEnv, secrets: string[]): Scenario {
  return {
    name,
    args,
    environment,
    buildExitCode: 0,
    expectedError: null,
    baseActions: successActions("base", secrets),
    patchActions: successActions("patch", secrets),
  };
}

function failureScenario(
  name: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  error: string,
  priorSecrets: string[],
): Scenario {
  return {
    name,
    args,
    environment,
    buildExitCode: 0,
    expectedError: error,
    baseActions: failureActions("base", priorSecrets),
    patchActions: [],
  };
}

function scenarios(): Scenario[] {
  const prodFull = environmentFor("production", true);
  const prodOmitted = environmentFor("production", false);
  const testFull = environmentFor("test", true);
  const testOmitted = environmentFor("test", false);
  const missingLater = { ...prodOmitted };
  delete missingLater.REMOTE_AUTH_WEBHOOK_SECRET;
  const incompleteSlack = { ...prodOmitted, SLACK_CLIENT_ID: fixtureValue("SLACK_CLIENT_ID") };
  const wrongStripe = { ...prodOmitted, STRIPE_SECRET_KEY: "sk_test_fixture_wrong_mode" };
  const invalidFcm = { ...prodOmitted, FCM_SERVICE_ACCOUNT: "invalid synthetic account" };
  const invalidAllowlist = { ...testFull, HOSTED_SERVERS_TEST_ALLOW_LIST: "*" };
  const missingFirst = { ...prodOmitted };
  delete missingFirst.EMAIL_SMTP_PASSWORD;

  return [
    successScenario("production-valid-complete", [], prodFull, productionFullSecretOrder),
    successScenario("production-valid-omitted", [], prodOmitted, productionOmittedSecretOrder),
    successScenario("test-valid-complete", ["--env", "test"], testFull, testFullSecretOrder),
    successScenario("test-valid-omitted", ["--env", "test"], testOmitted, requiredSecrets),
    failureScenario(
      "later-required-missing",
      [],
      missingLater,
      "REMOTE_AUTH_WEBHOOK_SECRET is missing",
      requiredSecrets.slice(0, 5),
    ),
    failureScenario("optional-group-incomplete", [], incompleteSlack, "Set all of SLACK_CLIENT_ID", requiredSecrets),
    failureScenario("stripe-mode-invalid", [], wrongStripe, "STRIPE_SECRET_KEY is not a live key", requiredSecrets),
    failureScenario(
      "fcm-invalid",
      [],
      invalidFcm,
      "FCM_SERVICE_ACCOUNT is not a Firebase service account key file",
      [],
    ),
    failureScenario(
      "test-allowlist-invalid",
      ["--env", "test"],
      invalidAllowlist,
      "HOSTED_SERVERS_TEST_ALLOW_LIST must name accounts",
      testFullSecretOrder.slice(0, testFullSecretOrder.indexOf("HOSTED_SERVERS_ALLOWED_USER_IDS")),
    ),
    failureScenario("required-first-missing", [], missingFirst, "EMAIL_SMTP_PASSWORD is missing", []),
    {
      name: "build-failure",
      args: [],
      environment: prodFull,
      buildExitCode: 1,
      expectedError: "Auth API build failed with code 1",
      baseActions: successActions("base", productionFullSecretOrder, 1),
      patchActions: successActions("patch", productionFullSecretOrder, 1),
    },
  ];
}

function environmentFor(target: "production" | "test", completeOptional: boolean): NodeJS.ProcessEnv {
  const names = [...requiredSecrets];
  if (completeOptional) {
    names.push(
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "BOAT_API_KEY",
      "BOAT_WEBHOOK_SECRET",
      ...(target === "test" ? ["HOSTED_SERVER_TEMPLATE"] : []),
      "GITHUB_APP_PRIVATE_KEY",
      "SERVER_CLAIMS_ADMIN_TOKEN",
      "SLACK_CLIENT_ID",
      "SLACK_CLIENT_SECRET",
      "SLACK_STATE_SECRET",
      "SLACK_ROUTE_PRIVATE_JWK",
      "SLACK_ROUTE_KEY_ID",
      "DISCORD_CLIENT_ID",
      "DISCORD_CLIENT_SECRET",
      "DISCORD_STATE_SECRET",
      "DISCORD_ROUTE_PRIVATE_JWK",
      "DISCORD_ROUTE_KEY_ID",
      "TELEGRAM_BOT_ID",
      "TELEGRAM_BOT_USERNAME",
      ...(target === "test" ? ["HOSTED_SERVERS_TEST_ALLOW_LIST", "HOSTED_SERVERS_DEVELOPER_KEY"] : []),
      "APNS_PRIVATE_KEY",
      "APNS_KEY_ID",
      "FCM_SERVICE_ACCOUNT",
    );
  }
  if (target === "production") names.push(...productionAnalytics);
  const env: NodeJS.ProcessEnv = {};
  for (const name of names) {
    if (name === "STRIPE_SECRET_KEY") {
      env[name] = target === "production" ? "sk_live_fixture_STRIPE_SECRET_KEY" : "sk_test_fixture_STRIPE_SECRET_KEY";
    } else if (name === "FCM_SERVICE_ACCOUNT") {
      env[name] = JSON.stringify({ project_id: "fixture-e2e", private_key: "synthetic:FCM_SERVICE_ACCOUNT" });
    } else if (name === "HOSTED_SERVERS_TEST_ALLOW_LIST") {
      env[name] = "fixture-account-01";
    } else {
      env[name] = fixtureValue(name);
    }
  }
  env.CLOUDFLARE_API_TOKEN = "synthetic-token-fixture";
  return env;
}

function fixtureValue(name: string): string {
  return "synthetic:" + name;
}

function payloadsFor(environment: NodeJS.ProcessEnv): Record<string, string> {
  const payloads: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && name !== "CLOUDFLARE_API_TOKEN") payloads[name] = value;
  }
  if (environment.HOSTED_SERVERS_TEST_ALLOW_LIST) {
    payloads.HOSTED_SERVERS_ALLOWED_USER_IDS = environment.HOSTED_SERVERS_TEST_ALLOW_LIST;
  }
  return payloads;
}

function secretValue(name: string, environment: NodeJS.ProcessEnv): string | undefined {
  return name === "HOSTED_SERVERS_ALLOWED_USER_IDS" ? environment.HOSTED_SERVERS_TEST_ALLOW_LIST : environment[name];
}

async function checkTestWrapper(fixture: Fixture): Promise<{ passed: boolean; evidence: string }> {
  const wrapper = await import(pathToFileURL(join(fixture.root, "scripts", "development-environment.ts")).href);
  const path = join(fixture.root, "apps", "auth-api", ".env.production");
  const values = environmentFor("test", true);
  await writeEnvironmentFile(path, values);
  let accepted = false;
  try {
    await wrapper.loadTestDeploymentEnvironment(fixture.root, {});
    accepted = true;
  } catch {}

  const incomplete = { ...values };
  delete incomplete.SLACK_CLIENT_SECRET;
  await writeEnvironmentFile(path, incomplete);
  let rejected = false;
  try {
    await wrapper.loadTestDeploymentEnvironment(fixture.root, {});
  } catch {
    rejected = true;
  }
  return {
    passed: accepted && rejected,
    evidence: "complete accepted=" + String(accepted) + "; incomplete Slack rejected=" + String(rejected),
  };
}

async function writeEnvironmentFile(path: string, values: NodeJS.ProcessEnv): Promise<void> {
  const lines = Object.entries(values)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => name + "=" + value);
  await writeFile(path, lines.join("\n") + "\n", "utf8");
}
async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<ChildResult> {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let startError: string | null = null;
    let settled = false;
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30_000);
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({
        exitCode,
        signal,
        timedOut,
        startError,
        stdout: stdout.slice(0, 4_000),
        stderr: stderr.slice(0, 4_000),
      });
    };
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.once("error", () => {
      startError = "Portable Bun child could not start.";
      finish(null, null);
    });
    child.once("close", (code, signal) => finish(code, signal));
  });
}

function readReport(path: string): PreloadReport {
  if (!existsSync(path)) return emptyReport();
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return emptyReport();
  }
  if (!isReportCandidate(value)) return emptyReport();
  const calls = value.calls;
  const errors = value.errors;
  const argv = value.argv;
  const cliExitCode = value.cliExitCode;
  const intercepted = value.intercepted;
  if (
    !Array.isArray(calls) ||
    !calls.every(isCall) ||
    !Array.isArray(errors) ||
    !errors.every(isString) ||
    !Array.isArray(argv) ||
    !argv.every(isString) ||
    typeof cliExitCode !== "number" ||
    typeof intercepted !== "boolean" ||
    value.delegated !== false
  ) {
    return emptyReport();
  }
  return {
    calls,
    errors,
    argv,
    cliExitCode,
    intercepted,
    delegated: false,
  };
}

function isCall(value: unknown): value is Call {
  if (!isCallCandidate(value)) return false;
  return (
    ["build", "secret", "migration", "deploy", "unexpected"].includes(String(value.kind)) &&
    typeof value.executable === "string" &&
    Array.isArray(value.args) &&
    value.args.every(isString) &&
    typeof value.argsWereArray === "boolean" &&
    typeof value.argsContainPayload === "boolean" &&
    (typeof value.cwd === "string" || value.cwd === null) &&
    (typeof value.shell === "boolean" || value.shell === null) &&
    Array.isArray(value.stdio) &&
    value.stdio.every(isString) &&
    typeof value.stdinEndCalls === "number" &&
    typeof value.stdinClosed === "boolean" &&
    typeof value.stdinPayloadPresent === "boolean" &&
    typeof value.stdinPayloadMatchesExpected === "boolean" &&
    typeof value.stdinHasOneTrailingNewline === "boolean" &&
    typeof value.cloudflareTokenPresent === "boolean" &&
    (typeof value.cloudflareEnvironment === "string" || value.cloudflareEnvironment === null) &&
    typeof value.childExitCode === "number"
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function emptyReport(): PreloadReport {
  return { calls: [], errors: [], argv: [], cliExitCode: -1, intercepted: false, delegated: false };
}

function validInput(call: Call | undefined, expected: string): boolean {
  return Boolean(
    call &&
      call.kind === "secret" &&
      call.stdinEndCalls === 1 &&
      call.stdinClosed &&
      call.stdinPayloadPresent &&
      call.stdinPayloadMatchesExpected &&
      call.stdinHasOneTrailingNewline &&
      !call.argsContainPayload &&
      !call.args.includes(expected),
  );
}

function record(checks: Check[], name: string, passed: boolean, evidence: string): void {
  checks.push({ name, passed, evidence });
}

function processEnvironment(sandboxRoot: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    TEMP: sandboxRoot,
    TMP: sandboxRoot,
    USERPROFILE: sandboxRoot,
    APPDATA: join(sandboxRoot, "AppData", "Roaming"),
    LOCALAPPDATA: join(sandboxRoot, "AppData", "Local"),
    NODE_OPTIONS: "--max-old-space-size=2048",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    BUN_INSTALL_CACHE_DIR: join(sandboxRoot, "bun-cache"),
  };
  for (const name of ["PATH", "SystemRoot", "WINDIR", "PATHEXT", "ComSpec"]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  return environment;
}

function isReportCandidate(value: unknown): value is ReportCandidate {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCallCandidate(value: unknown): value is CallCandidate {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isWithin(parent: string, child: string): boolean {
  const normalizedParent = resolve(parent)
    .replace(/[\\/]+$/u, "")
    .toLowerCase();
  const normalizedChild = resolve(child).toLowerCase();
  return normalizedChild.startsWith(normalizedParent + "\\") || normalizedChild.startsWith(normalizedParent + "/");
}

function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameStrings(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function sandboxArgument(args: string[]): string {
  const index = args.indexOf("--sandbox-root");
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error("Pass --sandbox-root with the owned sandbox directory.");
  return resolve(value);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "E2E failed.";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  });
}
