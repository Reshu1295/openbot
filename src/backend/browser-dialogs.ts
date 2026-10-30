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

export type BrowserDialog =
  | { id: string; type: "alert" | "confirm"; message: string; origin: string }
  | { id: string; type: "alert" | "confirm"; handledBy: "user" }
  | { id: string; type: "beforeunload"; handledBy: "user"; status: "prevented" | "allowed" };

interface DialogOwner {
  threadId: string;
  turnId: string;
}

/** Owns agent dialog callbacks; human browser actions retain Electron's native handler. */
export class BrowserDialogs {
  readonly #contents: WebContents;
  readonly #listeners = new Set<(dialog: BrowserDialog) => void>();
  #pending:
    | {
        dialog: BrowserDialog;
        owner: DialogOwner;
        reply?: (accept: boolean, source: "agent_tool" | "app_cancel") => void;
        handoff?: () => void;
      }
    | undefined;
  #owner: DialogOwner | undefined;
  #observed: BrowserDialog | undefined;
  #active = 0;
  #cancelling = false;
  #handedOff = false;

  constructor(contents: WebContents, canInspect: () => boolean) {
    this.#contents = contents;
    // Electron 44 exposes native dialogs through this internal event; CDP still opens a native sheet.
    const native = contents.listeners("-run-dialog");
    if (native.length !== 1) {
      logger.warn("Browser dialog interception unavailable", { reason: "native_handler_layout" });
      return;
    }
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
        const agent = Boolean(this.#active && this.#owner && !this.#handedOff && canInspect());
        const managed = agent && (info.dialogType === "alert" || info.dialogType === "confirm");
        const cancelling = Boolean(
          !this.#handedOff && ((this.#active && this.#cancelling) || (agent && this.#pending)),
        );
        logger.info("Browser dialog opened", {
          webContentsId: contents.id,
          dialogId: id,
          type,
          handler: cancelling ? "app_cancel" : managed ? "agent" : "native",
        });
        const respond = (accepted: boolean, text: string, source: "agent_tool" | "native_handler" | "app_cancel") => {
          if (this.#pending?.dialog.id === id) this.#pending = undefined;
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
        const showNative = () => {
          if (this.#handedOff && this.#owner && (info.dialogType === "alert" || info.dialogType === "confirm"))
            this.#pending = {
              dialog: { id, type: info.dialogType, handledBy: "user" },
              owner: this.#owner,
            };
          for (const handler of native)
            handler.call(contents, info, (accepted: boolean, text: string) =>
              respond(accepted, text, "native_handler"),
            );
        };
        if (!agent || !this.#owner) {
          showNative();
          return;
        }
        if (info.dialogType !== "alert" && info.dialogType !== "confirm") {
          showNative();
          return;
        }
        const dialog: BrowserDialog = {
          id,
          type: info.dialogType === "alert" ? "alert" : "confirm",
          message: redactText(info.messageText).slice(0, 2_000),
          origin: URL.parse(info.frame.url)?.origin ?? "null",
        };
        this.#pending = {
          dialog,
          owner: this.#owner,
          reply: (accepted, source) => respond(accepted, "", source),
          handoff: showNative,
        };
        this.#notify(dialog);
      },
    );
    const clear = () => {
      if (this.#pending)
        logger.info("Browser dialog closed", { dialogId: this.#pending.dialog.id, source: "native_lifecycle" });
      this.#pending = undefined;
    };
    EventEmitter.prototype.on.call(contents, "-cancel-dialogs", clear);
    contents.once("destroyed", clear);
    contents.on("will-prevent-unload", (event) => {
      // Read the final native decision after all listeners, without changing navigation policy.
      queueMicrotask(() => {
        if (this.#active && this.#owner && !this.#handedOff && !this.#cancelling && canInspect())
          this.#notify({
            id: randomUUID(),
            type: "beforeunload",
            handledBy: "user",
            status: event.defaultPrevented ? "allowed" : "prevented",
          });
      });
    });
  }

  begin(): void {
    if (!this.#active) {
      this.#cancelling = false;
      if (!this.#pending && !this.#handedOff) this.#owner = undefined;
    }
    this.#observed = undefined;
    this.#active++;
  }
  own(owner: DialogOwner): void {
    if (this.#pending && !this.#pending.reply) throw new Error("This browser dialog requires native handling.");
    this.#owner = { threadId: owner.threadId, turnId: owner.turnId };
    this.#handedOff = false;
  }
  end(): void {
    this.#active--;
  }
  current(): BrowserDialog | undefined {
    return this.#pending?.dialog;
  }

  readonly wait = Effect.fn("BrowserDialogs.wait")(function* (this: BrowserDialogs) {
    return yield* Effect.callback<BrowserDialog>((resume) => {
      const dialog = this.current() ?? this.#observed;
      if (dialog) {
        resume(Effect.succeed(dialog));
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
    // Electron owns native cancellation; keep its identity for explicit Close.
    if (pending && !pending.reply) return;
    this.#pending = undefined;
    pending?.reply?.(false, "app_cancel");
  }

  cancelForClose(): void {
    const pending = this.#pending;
    this.cancel();
    // Electron's original listener owns the native sheet's AbortController.
    if (pending && !pending.reply)
      EventEmitter.prototype.emit.call(this.#contents, "-cancel-dialogs", { resetState: true });
  }

  handoff(owner: DialogOwner): void {
    const pending = this.#pending;
    if ((pending?.owner ?? this.#owner)?.threadId !== owner.threadId) return;
    if ((pending?.owner ?? this.#owner)?.turnId !== owner.turnId) return;
    this.#owner = pending?.owner ?? this.#owner;
    this.#handedOff = true;
    if (!pending?.handoff || (pending.dialog.type !== "alert" && pending.dialog.type !== "confirm")) return;
    this.#pending = {
      dialog: { id: pending.dialog.id, type: pending.dialog.type, handledBy: "user" },
      owner: pending.owner,
    };
    pending.handoff();
  }

  answer(id: string, accept: boolean, owner: DialogOwner): void {
    const pending = this.#pending;
    if (!pending?.reply || pending.dialog.id !== id) throw new Error("Browser dialog changed or closed.");
    this.own(owner);
    this.#pending = undefined;
    pending.reply(accept, "agent_tool");
  }

  #notify(dialog: BrowserDialog): void {
    this.#observed = dialog;
    for (const listener of this.#listeners) listener(dialog);
  }
}
