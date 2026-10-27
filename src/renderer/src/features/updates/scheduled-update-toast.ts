import type { UpdateStatus } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js";
import { actionToast } from "../../action-toast";

const TOAST_ID = "scheduled-app-update";

// Closing the notice hides it. Its Cancel action cancels the scheduled restart.
export function createScheduledUpdateToast(options: {
  status: Accessor<UpdateStatus>;
  cancel: () => Promise<void>;
}): void {
  const restartNotice = createMemo(
    () => {
      const status = options.status();
      return status.phase !== "installing" ? (status.scheduledRestart ?? null) : null;
    },
    // Download progress and waiting agents do not reopen a notice that the user closed.
    { equals: (before, after) => before?.requestedBy === after?.requestedBy && before?.mode === after?.mode },
  );
  createEffect(restartNotice, (restart) => {
    if (!restart) {
      toast.dismiss(TOAST_ID);
      return;
    }
    const { t } = currentText();
    const title =
      restart.requestedBy === null
        ? t("update.scheduled.automaticTitle")
        : t("update.scheduled.title", { name: restart.requestedBy });
    toast(title, {
      id: TOAST_ID,
      description: restart.mode === "now" ? t("update.scheduled.now") : t("update.scheduled.whenIdle"),
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: t("update.scheduled.cancel"),
        onClick: () => {
          options.cancel().catch((error: unknown) => {
            const text = currentText();
            actionToast.error(text.errorMessage(error, text.t("update.scheduled.cancelFailed")), {
              report: { operation: "update", source: "action", cause_code: classifyFailure(error) },
            });
          });
        },
      },
    });
  });
  onCleanup(() => toast.dismiss(TOAST_ID));
}
