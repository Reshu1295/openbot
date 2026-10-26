// Watches the file that Magpie writes when the user connects OpenBot on Magpie's Agents page (see
// `../backend/magpie-link.ts`). OpenBot makes the folder and an empty `{}` file at start, so Magpie
// finds OpenBot, and never writes the keys that Magpie owns. Each change is read again after a short
// pause, because Magpie can write the file in more than one step.

import { type FSWatcher, watch } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { Effect } from "effect";
import {
  MAGPIE_LINK_MAX_BYTES,
  type MagpieLink,
  magpieLinkPath,
  NO_MAGPIE_LINK,
  parseMagpieLink,
  sameMagpieLink,
} from "../backend/magpie-link";

/** The pause after the last change before the file is read again. */
const DEBOUNCE_MS = 300;
/** Without a file watch (a network home folder, for example), the file is read at this interval. */
const POLL_MS = 3_000;

export interface MagpieLinkWatcherDependencies {
  /** Defaults to `~/.config/openbot/magpie.json`. */
  path?: string;
  /** Tells about each change of the values after the first read. */
  onChange?: (link: MagpieLink) => void;
}

/** One instance lives in main. `get()` is the last valid read; it is never older than a few seconds. */
export class MagpieLinkWatcher {
  readonly #path: string;
  readonly #onChange: ((link: MagpieLink) => void) | undefined;
  #link: MagpieLink = NO_MAGPIE_LINK;
  #watcher: FSWatcher | null = null;
  #poll: ReturnType<typeof setInterval> | null = null;
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #closed = false;
  /** The first read sets the values without a change event: nothing has read them yet. */
  #started = false;

  constructor(dependencies: MagpieLinkWatcherDependencies = {}) {
    this.#path = dependencies.path ?? magpieLinkPath(homedir());
    this.#onChange = dependencies.onChange;
  }

  get path(): string {
    return this.#path;
  }

  get(): MagpieLink {
    return this.#link;
  }

  /** Makes the folder and an empty file when they are missing, reads the file, and starts to watch. */
  start(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      yield* ensureMagpieLinkFile(this.#path);
      yield* this.reload();
      this.#started = true;
      if (this.#closed) return;
      this.#watch();
    });
  }

  /** Reads the file again. A missing, large or broken file gives no values. Never fails. */
  reload(): Effect.Effect<MagpieLink> {
    return readMagpieLink(this.#path).pipe(
      Effect.map((link) => {
        if (this.#closed || sameMagpieLink(link, this.#link)) return this.#link;
        this.#link = link;
        if (this.#started) this.#onChange?.(link);
        return link;
      }),
    );
  }

  close(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#closed = true;
      this.#watcher?.close();
      this.#watcher = null;
      if (this.#poll) clearInterval(this.#poll);
      this.#poll = null;
      if (this.#debounce) clearTimeout(this.#debounce);
      this.#debounce = null;
    });
  }

  #schedule(): void {
    if (this.#closed) return;
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      void Effect.runPromise(this.reload());
    }, DEBOUNCE_MS);
  }

  /** Watches the folder, not the file: an editor or Magpie can replace the file with a new one. */
  #watch(): void {
    const name = basename(this.#path);
    try {
      this.#watcher = watch(dirname(this.#path), { persistent: false }, (_event, changed) => {
        if (changed === null || changed === name) this.#schedule();
      });
      this.#watcher.on("error", () => {
        this.#watcher?.close();
        this.#watcher = null;
        this.#startPolling();
      });
    } catch {
      this.#startPolling();
    }
  }

  #startPolling(): void {
    if (this.#closed || this.#poll) return;
    this.#poll = setInterval(() => void Effect.runPromise(this.reload()), POLL_MS);
    this.#poll.unref?.();
  }
}

/** Makes the folder, and a `{}` file when there is none. An existing file is never written. */
export const ensureMagpieLinkFile = Effect.fn("MagpieLink.ensureFile")(function* (path: string) {
  yield* Effect.tryPromise(() => mkdir(dirname(path), { recursive: true })).pipe(Effect.ignore);
  // `wx`: the write fails when the file exists, so a file that Magpie wrote stays as it is.
  yield* Effect.tryPromise(() => writeFile(path, "{}\n", { encoding: "utf8", flag: "wx" })).pipe(Effect.ignore);
});

/** The values in the file. A missing, large or broken file gives no values. Never fails. */
export const readMagpieLink = Effect.fn("MagpieLink.read")(function* (path: string) {
  const info = yield* Effect.tryPromise(() => stat(path)).pipe(Effect.catch(() => Effect.succeed(null)));
  if (!info?.isFile() || info.size > MAGPIE_LINK_MAX_BYTES) return NO_MAGPIE_LINK;
  const text = yield* Effect.tryPromise(() => readFile(path, "utf8")).pipe(Effect.catch(() => Effect.succeed(null)));
  return text === null ? NO_MAGPIE_LINK : parseMagpieLink(text);
});
