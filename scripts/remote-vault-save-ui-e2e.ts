// node --import tsx scripts/remote-vault-save-ui-e2e.ts [--url=http://localhost:6006]
// Without --url, start this worktree's official Storybook and stop its owned supervisor afterward.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";

const output = resolve(".openbot-build/remote-vault-save-ui-e2e");
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

async function responseValue(key: string, expected: string | number | boolean): Promise<void> {
  assert.ok(page);
  await page.waitForFunction(
    ({ key, expected }) => {
      const output = document.querySelector("output[aria-label='Response metadata']");
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
  profile = await mkdtemp(join(tmpdir(), "openbot-remote-vault-save-"));
  const entry = join(profile, "fixture.cjs");
  await writeFile(
    entry,
    `const {app,BrowserWindow}=require("electron");app.setName("OpenBot remote Vault save check");app.setPath("userData",${JSON.stringify(join(profile, "profile"))});app.whenReady().then(()=>{const w=new BrowserWindow({width:1100,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadURL(${JSON.stringify(new URL("/iframe.html?id=conversation-browsersecretcard--password&viewMode=story", base).href)});});app.on("window-all-closed",()=>app.quit());`,
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
    new URL(`/iframe.html?id=conversation-browsersecretcard--${name}&viewMode=story`, base).href;
  const form = page.getByRole("form", { name: "Secure authentication", exact: true });
  // Cold Vite compiles the shared UI graph before the first story appears.
  await form.waitFor({ timeout: 90_000 });
  assert.equal(await form.getByRole("checkbox").count(), 0);
  await form.screenshot({ path: join(output, "before-remote-password.png"), animations: "disabled" });
  captures.push("before-remote-password.png");
  await page.goto(story("server-vault-password"));
  const save = page.getByRole("checkbox", { name: "Save to server Vault", exact: true });
  await save.waitFor();
  assert.equal(await save.isChecked(), false);
  await page.getByText("Saved on this server and shared by all its agents.", { exact: true }).waitFor();
  await form.screenshot({ path: join(output, "after-remote-password.png"), animations: "disabled" });
  captures.push("after-remote-password.png");
  cases.push(
    "The old remote password card has no save action; the new server Vault option is unchecked and states its shared-agent scope.",
  );
  await page.goto(story("server-vault-consent"));
  const password = page.getByLabel("Password", { exact: true });
  const submit = page.getByRole("button", { name: "Submit", exact: true });
  await password.fill("sample-password-not-a-credential");
  await submit.click();
  await responseValue("count", 1);
  await responseValue("decision", "submit");
  await responseValue("hasSaveToVault", false);
  assert.equal(await password.inputValue(), "");
  cases.push("An unchecked submission sends no save flag and clears the password.");
  await password.fill("sample-password-not-a-credential");
  await save.press("Space");
  assert.equal(await save.isChecked(), true);
  await submit.click();
  await responseValue("count", 2);
  await responseValue("hasSaveToVault", true);
  await responseValue("saveToVault", true);
  assert.equal(await password.inputValue(), "");
  cases.push("Only an explicit checkbox selection adds saveToVault:true to a submitted password.");
  await page.getByRole("button", { name: "New password request", exact: true }).click();
  assert.equal(await save.isChecked(), false);
  cases.push("A new secure request resets server Vault consent to unchecked.");
  await page.getByRole("button", { name: "Fail next response", exact: true }).click();
  await password.fill("sample-password-not-a-credential");
  await save.press("Space");
  await submit.click();
  await responseValue("count", 3);
  await form.getByRole("alert").waitFor();
  assert.equal(await password.inputValue(), "");
  await form.screenshot({ path: join(output, "failed-remote-password.png"), animations: "disabled" });
  captures.push("failed-remote-password.png");
  cases.push("A failed response clears the password and shows a safe error.");
  await password.fill("sample-password-not-a-credential");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await responseValue("count", 4);
  await responseValue("decision", "cancel");
  await responseValue("hasSaveToVault", false);
  assert.equal(await password.inputValue(), "");
  await page.getByRole("button", { name: "New password request", exact: true }).click();
  await save.press("Space");
  await password.fill("sample-password-not-a-credential");
  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await responseValue("count", 5);
  await responseValue("decision", "takeover");
  await responseValue("hasSaveToVault", false);
  assert.equal(await password.inputValue(), "");
  cases.push("Cancellation and takeover clear the input and carry no save flag, even after consent.");
  await page.goto(story("local-vault-password"));
  const localSave = page.getByRole("checkbox", { name: "Save to Vault", exact: true });
  await localSave.waitFor();
  assert.equal(await localSave.isChecked(), true);
  cases.push("The existing local Vault option keeps its checked default.");
  await page.goto(story("one-time-code"));
  await form.waitFor();
  assert.equal(await form.getByRole("checkbox").count(), 0);
  cases.push("A one-time code offers no Vault save option.");
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "report.json"),
    `${JSON.stringify({ passed: true, cases, errors, resourceErrors, captures, harness: "official Storybook, real BrowserSecretCard and typed synthetic callback, isolated Electron", realCredentialsUsed: false }, null, 2)}\n`,
  );
  // Machine-readable: focused UI results for CI.
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
