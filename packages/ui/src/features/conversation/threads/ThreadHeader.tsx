import { Button, Plus } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";
import { ThreadMenu } from "./ThreadMenu";
import { ThreadTabs } from "./ThreadTabs";
import type { ThreadHeaderProps, ThreadRowMode } from "./thread-types";

/** Below this free width a full tab does not fit, and the tabs become one menu button. */
const COMPACT_BELOW = 200;
/** Below this free width the menu button has no space for a title. */
const MINIMAL_BELOW = 72;

function rowMode(free: number): ThreadRowMode {
  if (free < MINIMAL_BELOW) return "minimal";
  if (free < COMPACT_BELOW) return "compact";
  return "tabs";
}

function NewThreadButton(props: { disabled: boolean; onNew: () => void }) {
  const { t } = useText();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      class="agent-threads-icon-button no-drag"
      aria-label={t("conversation.threads.new")}
      title={t("conversation.threads.new")}
      disabled={props.disabled}
      onClick={() => props.onNew()}
    >
      <Plus aria-hidden="true" />
    </Button>
  );
}

/**
 * The tabs, "+" and the thread list. In a narrow header the tabs and the list button become one
 * button with the open thread, and "+" follows it. The heading group takes the free width of the
 * header whatever it holds, so its width decides the mode and the mode does not change it again.
 */
function ThreadRow(props: ThreadHeaderProps) {
  let row: HTMLDivElement | undefined;
  const [mode, setMode] = createSignal<ThreadRowMode>("tabs");
  onSettled(() => {
    const group = row?.parentElement;
    if (!row || !group) return;
    const measure = () => {
      if (!row) return;
      const buttons = row.querySelectorAll(".agent-threads-icon-button");
      const button = buttons[0]?.getBoundingClientRect().width ?? 0;
      // The free width without "+" and the list button, which the full row has.
      const free = group.getBoundingClientRect().right - row.getBoundingClientRect().left - 2 * (button + 3);
      setMode(rowMode(free));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    measure();
    return () => observer.disconnect();
  });
  return (
    <div ref={row} class="agent-threads-header" data-mode={mode()}>
      <Show when={mode() === "tabs"}>
        <ThreadTabs {...props} />
        <NewThreadButton disabled={!props.canStartNew} onNew={props.onNew} />
      </Show>
      <ThreadMenu {...props} mode={mode()} />
      <Show when={mode() !== "tabs"}>
        <NewThreadButton disabled={!props.canStartNew} onNew={props.onNew} />
      </Show>
    </div>
  );
}

/**
 * The threads of an agent, in the chat header. An agent with only its own chat shows only a "New
 * thread" button, so its header stays almost the same. From two threads, the open threads show as
 * tabs, with a menu of all threads.
 */
export function ThreadHeader(props: ThreadHeaderProps) {
  const single = () => props.tabs.length < 2 && props.threads.length < 2 && props.archived.length === 0;
  return (
    <Show when={!single()} fallback={<NewThreadButton disabled={!props.canStartNew} onNew={props.onNew} />}>
      <ThreadRow {...props} />
    </Show>
  );
}
