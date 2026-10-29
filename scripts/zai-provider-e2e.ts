// Drives the real key-only provider and Pi subprocess protocol, plus a local quota HTTP server.
// PI_CLI can select a real Pi executable for model discovery without making a model request.
// Writes .openbot-build/pi-sign-in-watch-e2e/zai.json; also runs from the existing Pi E2E lane.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { normalizeAccountUsage } from "../src/backend/agent/account-usage";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { requireProviderDriver } from "../src/backend/provider-drivers";
import { readZaiUsage } from "../src/backend/zai-usage";

export async function runZaiProviderE2e(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "openbot-zai-e2e-"));
  const out = resolve(import.meta.dirname, "../.openbot-build/pi-sign-in-watch-e2e");
  const reportName = process.env.PI_CLI ? "zai-real-pi.json" : "zai.json";
  const key = "example-zai-test-key";
  const fake = join(root, "pi");
  const log = join(root, "probe.json");
  const report: { passed: boolean; realPi: boolean; models: string[]; checks: string[] } = {
    passed: false,
    realPi: Boolean(process.env.PI_CLI),
    models: [],
    checks: [],
  };
  let status = 200;
  let payload: unknown = null;
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    assert.equal(request.url, "/api/monitor/usage/quota/limit");
    assert.equal(request.headers.authorization, key);
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = (url: string, init: RequestInit) => {
    assert.equal(url, "https://api.z.ai/api/monitor/usage/quota/limit");
    assert.equal(init.redirect, "error");
    return fetch(`http://127.0.0.1:${address.port}${new URL(url).pathname}`, init);
  };
  let savedKey: string | null = null;
  await writeFile(
    fake,
    `#!/usr/bin/env bun
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
let registered;
const path = process.argv[process.argv.indexOf("--extension") + 1];
if (path) {
  const extension = await import(path);
  extension.default({ registerProvider: (id, config) => { registered = { id, config }; } });
  writeFileSync(${JSON.stringify(log)}, JSON.stringify({ id: registered.id, baseUrl: registered.config.baseUrl, keyRemoved: !process.env.OPENBOT_PI_ZAI_API_KEY, headerMatches: registered.config.headers.Authorization === "Bearer " + ${JSON.stringify(key)} }));
}
const models = [{ provider: "zai", id: "glm-5.2", name: "GLM-5.2", reasoning: false }, { provider: "other", id: "other-model", name: "Other", reasoning: false }];
createInterface({ input: process.stdin }).on("line", line => {
  const command = JSON.parse(line);
  const data = command.type === "get_available_models" ? { models } : {};
  console.log(JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data }));
});
`,
  );
  await chmod(fake, 0o700);
  const client = requireProviderDriver("zai").createClient(
    { executable: process.env.PI_CLI || fake, version: "1.1.0", source: "system" },
    15_000,
    {
      apiKey: () => savedKey,
      customProviders: () => [],
      mcpServers: () => [],
      agentEnvironment: () => ({ PI_CODING_AGENT_DIR: join(root, "pi-profile") }),
      providerStateDirectory: root,
    },
  );
  client.start();
  try {
    const missing = await runCauseEffect(client.request("model/list", {}, (value) => value));
    assert.match(JSON.stringify(missing), /"data":\[\]/);
    report.checks.push("No key: no catalog or provider process");
    savedKey = key;
    const catalog = await runCauseEffect(client.request("model/list", {}, (value) => value));
    assert.ok(catalog && typeof catalog === "object" && "data" in catalog && Array.isArray(catalog.data));
    report.models = catalog.data.map((model: { model: string }) => model.model);
    assert.ok(report.models.length > 0 && report.models.every((id) => !id.includes("/")));
    assert.ok(report.models.includes("glm-5.2"));
    report.checks.push("Saved key: only Z.ai models, without a provider prefix");
    if (!process.env.PI_CLI) {
      const probe = JSON.parse(await readFile(log, "utf8"));
      assert.deepEqual(probe, {
        id: "zai",
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
        keyRemoved: true,
        headerMatches: true,
      });
      report.checks.push("Coding Plan endpoint and saved-key precedence; key removed from child environment");
    }
    const before = requests;
    assert.equal((await runCauseEffect(readZaiUsage(null, request))).rateLimits, null);
    assert.equal(requests, before);
    payload = {
      success: true,
      data: {
        limits: [
          { type: "CREDIT_LIMIT", unit: 6, number: 1, percentage: 60, nextResetTime: 1_800_500_000_000 },
          { type: "CREDIT_LIMIT", unit: 3, number: 5, percentage: 25, nextResetTime: 1_800_000_000_000 },
          { type: "TIME_LIMIT", percentage: 75 },
        ],
      },
    };
    const quota = normalizeAccountUsage(await runCauseEffect(readZaiUsage(key, request)));
    assert.equal(quota.limits[0]?.id, "zai");
    assert.equal(quota.limits[0]?.primary?.usedPercent, 25);
    assert.equal(quota.limits[0]?.primary?.resetsAt, 1_800_000_000);
    assert.equal(quota.limits[0]?.groups?.[1]?.primary?.resetsAt, null);
    assert.equal(quota.limits[0]?.primary?.windowDurationMins, 300);
    assert.equal(quota.limits[0]?.secondary?.usedPercent, 60);
    assert.equal(quota.limits[0]?.secondary?.windowDurationMins, 10_080);
    assert.equal(quota.limits[0]?.secondary?.resetsAt, 1_800_500_000);
    payload = {
      data: {
        limits: [
          { type: "TOKENS_LIMIT", unit: 6, number: 7, percentage: 40 },
          { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 15 },
        ],
      },
    };
    const legacy = normalizeAccountUsage(await runCauseEffect(readZaiUsage(key, request)));
    assert.equal(legacy.limits[0]?.primary?.usedPercent, 15);
    assert.equal(legacy.limits[0]?.secondary?.usedPercent, 40);
    payload = { data: { limits: [{ type: "TOKENS_LIMIT", percentage: 20 }] } };
    const old = normalizeAccountUsage(await runCauseEffect(readZaiUsage(key, request)));
    assert.equal(old.limits[0]?.primary?.usedPercent, 20);
    assert.equal(old.limits[0]?.secondary, null);
    payload = { data: { limits: [{ type: "CREDIT_LIMIT", unit: 6, percentage: 80 }] } };
    const weekly = normalizeAccountUsage(await runCauseEffect(readZaiUsage(key, request)));
    assert.equal(weekly.limits[0]?.primary, null);
    assert.equal(weekly.limits[0]?.secondary?.usedPercent, 80);
    payload = { data: { limits: [{ type: "CREDIT_LIMIT", unit: 99, number: 5, percentage: 80 }] } };
    assert.equal((await runCauseEffect(readZaiUsage(key, request))).rateLimits, null);
    report.checks.push(
      "Quota HTTP authentication, credit/token five-hour and weekly windows, unknown windows, MCP group and optional reset time",
    );
    for (const invalid of [
      null,
      {},
      { success: false, data: { limits: [] } },
      { data: { limits: [{ type: "TOKENS_LIMIT", percentage: "25" }] } },
    ]) {
      payload = invalid;
      assert.equal((await runCauseEffect(readZaiUsage(key, request))).rateLimits, null);
    }
    for (status = 401; status <= 403; status += 2) {
      assert.equal((await runCauseEffect(readZaiUsage(key, request))).rateLimits, null);
    }
    status = 500;
    await assert.rejects(() => runCauseEffect(readZaiUsage(key, request)), /Could not read Z.ai usage/);
    report.checks.push("Missing, malformed and refused quota stays unknown; server failure stays an error");
    savedKey = null;
    const removed = await runCauseEffect(client.request("model/list", {}, (value) => value));
    assert.match(JSON.stringify(removed), /"data":\[\]/);
    report.checks.push("Removed key: catalog unavailable again");
    report.passed = true;
  } finally {
    await runCauseEffect(client.stop());
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await mkdir(out, { recursive: true });
    await writeFile(join(out, reportName), `${JSON.stringify(report, null, 2)}\n`);
    await rm(root, { recursive: true, force: true });
  }
  process.stdout.write(`PASS ${join(out, reportName)}\n`);
}

if (import.meta.main) await runZaiProviderE2e();
