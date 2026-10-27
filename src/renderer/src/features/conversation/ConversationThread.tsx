import type { AgentMessage } from "@openbot/ui/data";
import { AgentThreadView } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import { createMemo, createProjection, Loading, lazy, Show } from "solid-js";
import { toAgentMessages } from "../../app-message-projection";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { messagePromptRequestKey, promptRequestKey } from "./conversation-keys";
import { useConversationViewScope } from "./conversation-scope";

const PendingPrompt = lazy(() => import("./PendingPrompt").then((module) => ({ default: module.PendingPrompt })));

/** The open side thread of the agent, in the place of the agent's own chat and its message box. */
export function ConversationThread() {
  const { props, openExternalMessageUrl, previewAttachment, attachmentAction } = useConversationViewScope();
  /** The waiting question, by its request: a new copy of the same question keeps the card and what it holds. */
  const promptKey = createMemo(() => {
    const prompt = props.threads?.prompt;
    return prompt ? promptRequestKey(prompt.turnId, prompt.requestId) : null;
  });
  /**
   * Reconciled by id, so a stream chunk redraws only the message that changed. As in the agent's own
   * chat, an open question shows only as its card.
   */
  const messages = createProjection<AgentMessage[]>(
    () => {
      const conversation = props.threads?.conversation;
      if (!conversation) return [];
      const requestKey = promptKey();
      const shown = conversation.messages.filter(
        (message) =>
          message.questionPrompt?.resolution !== null &&
          (!requestKey || messagePromptRequestKey(message) !== requestKey),
      );
      return toAgentMessages(shown, props.agent?.id);
    },
    [],
    { key: "id" },
  );
  const view = () => {
    const agent = props.agent;
    const threads = props.threads;
    return agent && threads ? { agent, threads } : undefined;
  };
  return (
    <Show when={view()}>
      {(current) => (
        <AgentThreadView
          task={current().threads.open ?? null}
          limit={current().threads.limit}
          agent={current().agent}
          agents={props.agents}
          messages={messages}
          onSend={(text) => current().threads.onSend(text)}
          onStop={() => current().threads.onStop()}
          onOpenLink={(url) => void openExternalMessageUrl(url)}
          onPreview={(attachment) => void previewAttachment(attachment)}
          onAttachmentAction={attachmentAction}
          approval={current().threads.approval}
          onRespondApproval={(decision) => current().threads.onRespondApproval(decision)}
          waitsForAnswer={promptKey() !== null}
          prompt={
            <Show when={promptKey()} keyed>
              <Loading>
                <PendingPrompt
                  questions={current().threads.prompt?.questions ?? []}
                  block={current().threads.promptUiBlock}
                  agents={props.agents}
                  onSelectAgent={props.onSelectAgent}
                  onOpenLink={(url) => void openExternalMessageUrl(url)}
                  sendShortcut={deviceSendShortcut(props.platform)}
                  onAnswer={(answers, options) => current().threads.onAnswerPrompt(answers, options)}
                />
              </Loading>
            </Show>
          }
        />
      )}
    </Show>
  );
}
