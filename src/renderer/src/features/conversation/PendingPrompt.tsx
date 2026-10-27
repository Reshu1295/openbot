import type { AgentPromptQuestion } from "@openbot/contracts/ipc";
import type { ConversationUiBlock } from "@openbot/contracts/ui-blocks";
import { QuestionPromptBubble } from "@openbot/ui/components/QuestionPromptBubble";
import type { AgentProfile } from "@openbot/ui/data";
import type { SendShortcut } from "@openbot/ui/features/conversation/send-shortcut";
import { Show } from "solid-js";
import type { PromptAnswerOptions } from "./conversation-types";
import { UiBlockPrompt } from "./UiBlockPrompt";

export interface PendingPromptProps {
  questions: AgentPromptQuestion[];
  /**
   * The block of the prompt's message draws it as a card. Until the block's message arrives, or when
   * the agent asked without one, the prompt's questions draw it.
   */
  block: ConversationUiBlock | undefined;
  agents: AgentProfile[];
  onSelectAgent: (agentId: string) => void;
  onOpenLink: (url: string) => void;
  sendShortcut?: SendShortcut | undefined;
  elementRef?: ((element: HTMLElement | undefined) => void) | undefined;
  onAnswer: (answers: Record<string, string[]>, options?: PromptAnswerOptions) => Promise<boolean>;
  /** The answer went through and the card shows it. */
  onResolutionPresented?: (() => void) | undefined;
}

/** The question that an agent's turn waits for, as the card the person answers. */
export function PendingPrompt(props: PendingPromptProps) {
  return (
    <Show
      when={props.block}
      fallback={
        <QuestionPromptBubble
          questions={props.questions}
          elementRef={(element) => props.elementRef?.(element)}
          sendShortcut={props.sendShortcut}
          onSubmit={props.onAnswer}
          onResolutionPresented={() => props.onResolutionPresented?.()}
        />
      }
    >
      {(block) => (
        <UiBlockPrompt
          block={block()}
          agents={props.agents}
          onSelectAgent={props.onSelectAgent}
          onOpenLink={props.onOpenLink}
          elementRef={props.elementRef}
          onAnswer={props.onAnswer}
          onAnswered={props.onResolutionPresented}
        />
      )}
    </Show>
  );
}
