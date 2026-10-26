// node --import tsx scripts/remote-agent-computer-use-e2e.ts [--url=http://localhost:6006]
// Without --url, start this worktree's official Storybook and stop its owned supervisor afterward.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";

const output = resolve(".openbot-build/remote-agent-computer-use-e2e");
const suppliedUrl = process.argv.find((value) => value.startsWith("--url="))?.slice(6);
const cases: string[] = [];
const errors: string[] = [];
const resourceErrors: string[] = [];
const pendingRequests = new Set<string>();
const captures: string[] = [];
let storybook: ChildProcess | undefined;
let app: ElectronApplication | undefined;
let page: Page | undefined;
let profile: string | undefined;
await mkdir(output, { recursive: true });

async function startStorybook(): Promise<string> {
  storybook = spawn("bun", ["scripts/dev-storybook.ts", "--no-open", "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
  const child = storybook;
  return new Promise<string>((done, fail) => {
    let logs = "";
    const deadline = setTimeout(() => fail(new Error("Storybook did not announce its URL.")), 90_000);
    const read = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      logs += text;
      const url = /Storybook: (http:\/\/localhost:\d+)/u.exec(logs)?.[1];
      if (url) {
        clearTimeout(deadline);
        done(url);
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("error", (error) => {
      clearTimeout(deadline);
      fail(error);
    });
    child.once("exit", () => {
      clearTimeout(deadline);
      fail(new Error("Storybook stopped before the UI check finished."));
    });
  });
}

async function hostValue(key: string, expected: string | number | boolean): Promise<void> {
  assert.ok(page);
  await page.waitForFunction(
    ({ key, expected }) => {
      const output = document.querySelector("output[aria-label='Synthetic host state']");
      return output && JSON.parse(output.textContent ?? "{}")[key] === expected;
    },
    { key, expected },
  );
}

try {
  const base = new URL(suppliedUrl ?? (await startStorybook()));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Use a local official Storybook server.");
  const readyBy = Date.now() + 90_000;
  while (true) {
    if (storybook?.exitCode !== null && storybook?.exitCode !== undefined) throw new Error("Storybook stopped.");
    const ready = await fetch(new URL("/index.json", base), { signal: AbortSignal.timeout(2_000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) break;
    if (Date.now() >= readyBy) throw new Error("Storybook did not serve its story index.");
    await new Promise<void>((done) => setTimeout(done, 100));
  }
  profile = await mkdtemp(join(tmpdir(), "openbot-remote-computer-use-"));
  const entry = join(profile, "fixture.cjs");
  await writeFile(
    entry,
    `const {app,BrowserWindow}=require("electron");app.setName("OpenBot remote Computer Use check");app.setPath("userData",${JSON.stringify(join(profile, "profile"))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1100,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadURL(${JSON.stringify(new URL("/iframe.html?id=settings-shared-agent-form--remote-agent&viewMode=story", base).href)});});app.on("window-all-closed",()=>app.quit());`,
  );
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && name !== "ELECTRON_RUN_AS_NODE") env[name] = value;
  }
  const executablePath =
    process.platform === "darwin"
      ? resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
      : resolve("node_modules/electron/dist", process.platform === "win32" ? "electron.exe" : "electron");
  const electronFlags = process.platform === "linux" ? ["--no-sandbox"] : [];
  app = await _electron.launch({ executablePath, args: [...electronFlags, entry], env });
  page = await app.firstWindow({ timeout: 15_000 });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") resourceErrors.push(message.text());
  });
  page.on("request", (request) => pendingRequests.add(request.url()));
  page.on("requestfinished", (request) => pendingRequests.delete(request.url()));
  page.on("requestfailed", (request) => {
    pendingRequests.delete(request.url());
    resourceErrors.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) resourceErrors.push(`${response.status()} ${response.url()}`);
  });
  const story = (name: string) =>
    new URL(`/iframe.html?id=settings-shared-agent-form--${name}&viewMode=story`, base).href;
  // A new Vite process first compiles the shared UI import graph. Wait for the story before testing actions.
  await page.getByRole("button", { name: /^Permissions\b/u }).waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: /^Permissions\b/u }).click();
  const computerUse = page.getByRole("switch", { name: "Computer Use", exact: true });
  assert.equal(await computerUse.count(), 0);
  await page
    .getByRole("complementary")
    .screenshot({ path: join(output, "before-remote-permissions.png"), animations: "disabled" });
  captures.push("before-remote-permissions.png");
  await page.goto(story("remote-computer-use"));
  await page.getByRole("button", { name: /^Permissions\b/u }).click();
  await computerUse.waitFor();
  assert.equal(await computerUse.isChecked(), false);
  await hostValue("hostComputerUse", false);
  await page
    .getByRole("complementary")
    .screenshot({ path: join(output, "after-remote-permissions.png"), animations: "disabled" });
  captures.push("after-remote-permissions.png");
  await computerUse.press("Space");
  await hostValue("hostComputerUse", true);
  assert.equal(await computerUse.isChecked(), true);
  await computerUse.press("Space");
  await hostValue("hostComputerUse", false);
  await hostValue("writes", 2);
  await hostValue("profileWrites", 0);
  const hostState = page.getByRole("status", { name: "Synthetic host state", exact: true });
  const saved = JSON.parse(await hostState.innerText());
  assert.deepEqual(saved.lastWrite, { agentId: "remote-a", computerUse: false });
  assert.equal(saved.lastServer, "sample-host");
  cases.push("An owner reads the remote value, enables and disables it, and uses only the scoped host-settings route.");
  const activePage = page;
  const control = (name: string) => activePage.getByRole("button", { name, exact: true });
  await control("Fail next host update").click();
  await computerUse.press("Space");
  await page.getByText("The sample host refused the update.", { exact: true }).waitFor();
  await hostValue("writes", 3);
  assert.equal(await computerUse.isChecked(), false);
  await hostValue("hostComputerUse", false);
  cases.push("A failed write shows the host error and restores the saved switch value.");
  await control("Use admin role").click();
  await computerUse.press("Space");
  await hostValue("hostComputerUse", true);
  cases.push("An administrator can change Computer Use through the same host route.");
  await computerUse.press("Space");
  await hostValue("hostComputerUse", false);
  const readsBeforeReload = JSON.parse(await hostState.innerText()).reads;
  await control("Reload host settings").click();
  await hostValue("reads", readsBeforeReload + 1);
  assert.equal(await computerUse.isChecked(), false);
  cases.push("Reloading host settings preserves the saved permission.");
  await control("Use member role").click();
  await computerUse.waitFor({ state: "hidden" });
  await hostValue("role", "member");
  await control("Use owner role").click();
  await computerUse.waitFor();
  await control("Toggle host capability").click();
  await computerUse.waitFor({ state: "hidden" });
  await control("Toggle host capability").click();
  await computerUse.waitFor();
  await hostValue("writes", 5);
  cases.push("Members and hosts without agent-host-settings-v1 have no editable Computer Use control.");
  await control("Hold next host read").click();
  await control("Switch sample agent").click();
  await page.getByRole("button", { name: /^Permissions\b/u }).click();
  await hostValue("agentId", "remote-b");
  await computerUse.waitFor({ state: "hidden" });
  await page
    .getByRole("complementary")
    .screenshot({ path: join(output, "pending-remote-permissions.png"), animations: "disabled" });
  captures.push("pending-remote-permissions.png");
  await control("Release held host reads").click();
  await computerUse.waitFor();
  assert.equal(await computerUse.isChecked(), true);
  cases.push("A pending first read hides the control until that agent's host value arrives.");
  await control("Hold next host read").click();
  await control("Switch sample agent").click();
  await page.getByRole("button", { name: /^Permissions\b/u }).click();
  await computerUse.waitFor({ state: "hidden" });
  await control("Switch sample agent").click();
  await page.getByRole("button", { name: /^Permissions\b/u }).click();
  await computerUse.waitFor();
  await control("Release held host reads").click();
  await hostValue("agentId", "remote-b");
  assert.equal(await computerUse.isChecked(), true);
  cases.push("A delayed reply for a previous agent does not replace the current agent's value.");
  await control("Fail next host read").click();
  await control("Switch sample agent").click();
  await page.getByRole("button", { name: /^Permissions\b/u }).click();
  await hostValue("agentId", "remote-a");
  await computerUse.waitFor({ state: "hidden" });
  await control("Reload host settings").click();
  await computerUse.waitFor();
  assert.equal(await computerUse.isChecked(), false);
  await hostValue("profileWrites", 0);
  cases.push("A failed first read leaves the control hidden; a successful retry restores it.");
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    `${JSON.stringify({ passed: true, cases, errors, resourceErrors, captures, harness: "official Storybook, real remote-agent controller and shared form, isolated Electron", realHostsUsed: false }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({ passed: true, cases, errors, captures })}\n`);
} catch (error) {
  await page
    ?.screenshot({ path: join(output, "failure.png"), animations: "disabled", timeout: 5_000 })
    .catch(() => undefined);
  await writeFile(
    join(output, "report.json"),
    `${JSON.stringify(
      {
        passed: false,
        cases,
        errors,
        resourceErrors,
        pendingRequests: [...pendingRequests],
        captures,
        failure: String(error),
        body: await page
          ?.locator("body")
          .innerText({ timeout: 1_000 })
          .catch(() => undefined),
      },
      null,
      2,
    )}\n`,
  );
  throw error;
} finally {
  try {
    await app?.close();
  } finally {
    try {
      if (storybook && storybook.exitCode === null && storybook.signalCode === null) {
        const child = storybook;
        const exited = new Promise<void>((done) => child.once("exit", () => done()));
        child.kill("SIGTERM");
        await exited;
      }
    } finally {
      if (profile) await rm(profile, { recursive: true, force: true });
    }
  }
}
