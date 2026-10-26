import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type MagpieLink, NO_MAGPIE_LINK } from "../backend/magpie-link";
import { MagpieGateway } from "./magpie-gateway";
import { MagpieLinkWatcher } from "./magpie-link-watcher";

const folders: string[] = [];
const watchers: MagpieLinkWatcher[] = [];

afterEach(async () => {
  for (const watcher of watchers.splice(0)) await Effect.runPromise(watcher.close());
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function linkPath(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "openbot-magpie-link-"));
  folders.push(home);
  return join(home, ".config", "openbot", "magpie.json");
}

function watcher(path: string, onChange?: () => void): MagpieLinkWatcher {
  const created = new MagpieLinkWatcher({ path, ...(onChange ? { onChange } : {}) });
  watchers.push(created);
  return created;
}

const CONNECTED: MagpieLink = {
  model: "auto/deepseek-v4.1-flash",
  baseUrl: "http://127.0.0.1:4100",
  apiKey: "magpie-openbot",
};

describe("Magpie link watcher", () => {
  it("makes the folder and an empty object file, so Magpie finds OpenBot", async () => {
    const path = await linkPath();
    const link = watcher(path);
    await Effect.runPromise(link.start());
    expect(await readFile(path, "utf8")).toBe("{}\n");
    expect(link.get()).toEqual(NO_MAGPIE_LINK);
  });

  it("never writes a file that exists, and reads it at start without a change event", async () => {
    const path = await linkPath();
    await Effect.runPromise(watcher(path).start());
    const text = `${JSON.stringify(CONNECTED)}\n`;
    await writeFile(path, text);
    const onChange = vi.fn();
    const link = watcher(path, onChange);
    await Effect.runPromise(link.start());
    expect(await readFile(path, "utf8")).toBe(text);
    expect(link.get()).toEqual(CONNECTED);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("follows a connect and a disconnect, and tells about each change once", async () => {
    const path = await linkPath();
    const onChange = vi.fn();
    const link = watcher(path, onChange);
    await Effect.runPromise(link.start());
    await writeFile(path, JSON.stringify(CONNECTED));
    await vi.waitFor(() => expect(link.get()).toEqual(CONNECTED), { timeout: 5_000 });
    await Effect.runPromise(link.reload());
    expect(onChange).toHaveBeenCalledTimes(1);
    await writeFile(path, "{}");
    await vi.waitFor(() => expect(link.get()).toEqual(NO_MAGPIE_LINK), { timeout: 5_000 });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("gives no values for a broken or large file", async () => {
    const path = await linkPath();
    const link = watcher(path);
    await Effect.runPromise(link.start());
    await writeFile(path, "{not json");
    expect(await Effect.runPromise(link.reload())).toEqual(NO_MAGPIE_LINK);
    await writeFile(path, JSON.stringify({ ...CONNECTED, pad: "x".repeat(70_000) }));
    expect(await Effect.runPromise(link.reload())).toEqual(NO_MAGPIE_LINK);
  });
});

describe("Magpie gateway with a link", () => {
  it("uses Magpie's address, key and model while they are set, and discovery after a disconnect", async () => {
    let current = CONNECTED;
    const requests: { url: string; authorization: string | null }[] = [];
    const gateway = new MagpieGateway({
      preference: { get: () => ({ autoStart: false }) },
      location: { platform: "linux", home: "/home/u", env: {} },
      readSettings: async () => '{"port": 3999}',
      link: () => current,
      fetch: async (url, init) => {
        requests.push({ url, authorization: new Headers(init.headers).get("authorization") });
        return new Response(JSON.stringify({ data: [{ id: "auto/deepseek-v4.1-flash" }] }), { status: 200 });
      },
    });
    expect(await Effect.runPromise(gateway.origin())).toBe("http://127.0.0.1:4100");
    expect((await Effect.runPromise(gateway.status())).linkedModel).toBe("auto/deepseek-v4.1-flash");
    await Effect.runPromise(gateway.models());
    expect(requests.at(-1)).toEqual({
      url: "http://127.0.0.1:4100/v1/models",
      authorization: "Bearer magpie-openbot",
    });

    current = NO_MAGPIE_LINK;
    expect(await Effect.runPromise(gateway.origin())).toBe("http://127.0.0.1:3999");
    expect((await Effect.runPromise(gateway.status())).linkedModel).toBeNull();
  });
});
