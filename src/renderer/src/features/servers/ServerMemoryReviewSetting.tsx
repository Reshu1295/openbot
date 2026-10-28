import {
  MEMORY_REVIEW_INTERVALS,
  type MemoryReviewInterval,
  type MemoryReviewPreference,
  type OpenBotDesktopApi,
} from "@openbot/contracts/ipc";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";

/** The memory review calls of this computer. The desktop reaches them through main. */
export type MemoryReviewCalls = Pick<OpenBotDesktopApi, "getMemoryReviewPreference" | "setMemoryReviewPreference">;

export interface ServerMemoryReviewOptions {
  /** The calls of a client with no `window.openbot`, such as a preview. */
  calls?: MemoryReviewCalls;
}

/**
 * Server Settings > General: how many completed turns of one conversation pass between two
 * background memory reviews of this computer's agents, or Off. It is an app setting, so only the
 * local server shows it.
 */
export function ServerMemoryReviewSetting(
  props: ServerMemoryReviewOptions & {
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage } = useText();
  const calls = (): MemoryReviewCalls => props.calls ?? window.openbot;
  const [preference, setPreference] = createSignal<MemoryReviewPreference | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  onSettled(() => {
    calls()
      .getMemoryReviewPreference()
      .then(setPreference, (error: unknown) =>
        setLoadError(errorMessage(error, t("server.settings.memoryReviewLoadFailed"))),
      );
  });

  const label = (interval: MemoryReviewInterval | null) =>
    interval === null
      ? ""
      : interval === 0
        ? t("server.settings.memoryReviewOff")
        : t("server.settings.memoryReviewTurns", { count: interval });

  function choose(interval: MemoryReviewInterval | null): void {
    const current = preference();
    if (interval === null || !current || interval === current.interval) return;
    void props.run("memoryReview", async () => {
      setPreference(await calls().setMemoryReviewPreference({ interval }));
    });
  }

  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-memory-review-label">{t("server.settings.memoryReview")}</ItemTitle>
        <ItemDescription>{loadError() ?? t("server.settings.memoryReviewDescription")}</ItemDescription>
      </ItemContent>
      <Show when={preference()}>
        {(current) => (
          <ItemActions>
            <Select<MemoryReviewInterval>
              options={[...MEMORY_REVIEW_INTERVALS]}
              value={current().interval}
              disabled={props.disabled}
              placement="bottom-end"
              onChange={choose}
              itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
            >
              <SelectTrigger size="sm" aria-labelledby="server-settings-memory-review-label">
                <SelectValue<MemoryReviewInterval>>{(state) => label(state.selectedOption() ?? null)}</SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.menuMount} />
            </Select>
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}
