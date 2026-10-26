import type { MagpieGatewaySettings } from "@openbot/contracts/ipc";
import type { ProviderMagpieGateway } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { createEffect, createStore } from "solid-js";

/** The Magpie gateway of this computer, for the Magpie page. Undefined while `enabled` is false. */
export function createProviderMagpieGateway(enabled: () => boolean): () => ProviderMagpieGateway | undefined {
  const [state, setState] = createStore<{ value: MagpieGatewaySettings | null; pending: boolean }>({
    value: null,
    pending: false,
  });

  createEffect(enabled, (on) => {
    if (!on) return;
    window.openbot.providerDetection.getMagpie().then(
      (value) =>
        setState((draft) => {
          draft.value = value;
        }),
      () => undefined,
    );
  });

  async function setAutoStart(autoStart: boolean): Promise<void> {
    if (state.pending) return;
    setState((draft) => {
      draft.pending = true;
    });
    try {
      const value = await window.openbot.providerDetection.setMagpieAutoStart(autoStart);
      setState((draft) => {
        draft.value = value;
      });
    } finally {
      setState((draft) => {
        draft.pending = false;
      });
    }
  }

  const magpie: ProviderMagpieGateway = {
    get value() {
      return state.value;
    },
    get pending() {
      return state.pending;
    },
    onAutoStartChange: (autoStart) => void setAutoStart(autoStart).catch(() => undefined),
  };
  return () => (enabled() ? magpie : undefined);
}
