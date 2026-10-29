import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { Effect } from "effect";
import type { WebContents, WebFrameMain } from "electron";

const logger = createOpenBotLogger("browser-dialogs");

interface NativeDialog {
  dialogType: string;
  messageText: string;
  frame: Pick<WebFrameMain, "url">;
}

export interface BrowserDialog {
  id: string;
  type: "alert" | "confirm";
  message: string;
  origin: string;
}

/** Owns agent dialog callbacks; human browser actions retain Electron's native handler. */
export class BrowserDialogs {
  readonly #listeners = new Set<(dialog: BrowserDialog) => void>();
  #pending:
    | { dialog: BrowserDialog; reply: (accept: boolean, source: "agent_tool" | "app_cancel") => void }
    | undefined;
  #active = 0;
  #cancelling = false;

  constructor(contents: WebContents, canInspect: () => boolean) {
    // Electron 44 exposes native dialogs through this internal event; CDP still opens a native sheet.
    const native = contents.listeners("-run-dialog");
    if (native.length !== 1) throw new Error("Native browser dialog handler is unavailable.");
    contents.removeAllListeners("-run-dialog");
    EventEmitter.prototype.on.call(
      contents,
      "-run-dialog",
      (info: NativeDialog, reply: (accept: boolean, text: string) => void) => {
        const id = randomUUID();
        const startedAt = performance.now();
        const type = ["alert", "confirm", "prompt", "beforeunload"].includes(info.dialogType)
          ? info.dialogType
          : "other";
        const agent = Boolean(
          this.#active && canInspect() && (info.dialogType === "confirm" || info.dialogType === "alert"),
        );
        const cancelling = Boolean((this.#active && this.#cancelling) || (agent && this.#pending));
        logger.info("Browser dialog opened", {
          webContentsId: contents.id,
          dialogId: id,
          type,
          handler: cancelling ? "app_cancel" : agent ? "agent" : "native",
        });
        const respond = (accepted: boolean, text: string, source: "agent_tool" | "native_handler" | "app_cancel") => {
          reply(accepted, text);
          logger.info("Browser dialog answered", {
            webContentsId: contents.id,
            dialogId: id,
            type,
            accepted,
            source,
            durationMs: Math.round(performance.now() - startedAt),
          });
        };
        if (cancelling) {
          respond(false, "", "app_cancel");
          return;
        }
        if (!agent) {
          for (const handler of native)
            handler.call(contents, info, (accepted: boolean, text: string) =>
              respond(accepted, text, "native_handler"),
            );
          return;
        }
        const dialog: BrowserDialog = {
          id,
          type: info.dialogType === "alert" ? "alert" : "confirm",
          message: redactText(info.messageText).slice(0, 2_000),
          origin: URL.parse(info.frame.url)?.origin ?? "null",
        };
        this.#pending = { dialog, reply: (accepted, source) => respond(accepted, "", source) };
        for (const listener of this.#listeners) listener(dialog);
      },
    );
    const clear = () => {
      if (this.#pending)
        logger.info("Browser dialog closed", { dialogId: this.#pending.dialog.id, source: "native_lifecycle" });
      this.#pending = undefined;
    };
    EventEmitter.prototype.on.call(contents, "-cancel-dialogs", clear);
    contents.once("destroyed", clear);
  }

  begin(): void {
    if (!this.#active) this.#cancelling = false;
    this.#active++;
  }
  end(): void {
    this.#active--;
  }
  current(): BrowserDialog | undefined {
    return this.#pending?.dialog;
  }

  readonly wait = Effect.fn("BrowserDialogs.wait")(function* (this: BrowserDialogs) {
    return yield* Effect.callback<BrowserDialog>((resume) => {
      if (this.#pending) {
        resume(Effect.succeed(this.#pending.dialog));
        return;
      }
      const listener = (dialog: BrowserDialog) => resume(Effect.succeed(dialog));
      this.#listeners.add(listener);
      return Effect.sync(() => {
        this.#listeners.delete(listener);
      });
    });
  });

  cancel(): void {
    this.#cancelling = true;
    const pending = this.#pending;
    this.#pending = undefined;
    pending?.reply(false, "app_cancel");
  }

  answer(id: string, accept: boolean): void {
    const pending = this.#pending;
    if (!pending || pending.dialog.id !== id) throw new Error("Browser dialog changed or closed.");
    this.#pending = undefined;
    pending.reply(accept, "agent_tool");
  }
}
