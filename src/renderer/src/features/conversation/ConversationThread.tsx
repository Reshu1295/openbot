import { supportedAttachmentExtensions } from "@openbot/contracts/attachment-files";
import { canPreviewAttachment } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { classifyFailure } from "@openbot/telemetry";
import { Input } from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { contextUsageView } from "@openbot/ui/features/conversation/ContextUsage";
import { AgentThreadView } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import { useText } from "@openbot/ui/text";
import { createMemo, createProjection, createSignal, Loading, lazy, Show } from "solid-js";
import { actionToast } from "../../action-toast";
import { toAgentMessages } from "../../app-message-projection";
import { deviceSendShortcut } from "../../send-shortcut-preference";
import { ConversationBrowserTakeover } from "./ConversationBrowserTakeover";
import { messagePromptRequestKey, promptRequestKey } from "./conversation-keys";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationThreads } from "./conversation-types";

const PendingPrompt = lazy(() => import("./PendingPrompt").then((module) => ({ default: module.PendingPrompt })));

/** A thread takes files only from this computer, which reads every supported type. */
const THREAD_ATTACHMENT_ACCEPT = supportedAttachmentExtensions({ eml: true, media: true, zip: true, mp4: true })
  .map((extension) => `.${extension}`)
  .join(",");

/** The open side thread of the agent, in the place of the agent's own chat and its message box. */
export function ConversationThread() {
  const {
    props,
    openExternalMessageUrl,
    previewAttachment,
    attachmentAction,
    browserTakeoverResolution,
    installedSkills,
    installedSkillsLoadFailed,
    mcpServers,
    threadComposer,
  } = useConversationViewScope();
  const { t, errorMessage } = useText();
  const [picker, setPicker] = createSignal<HTMLInputElement>();
  /** A failed answer shows here, where the person answered, and not in the agent's own chat. */
  const failureToast = (fallback: AppTextKey) => ({
    onError: (error: unknown) => {
      actionToast.error(errorMessage(error, t(fallback)), {
        report: { operation: "turn", source: "action", cause_code: classifyFailure(error) },
      });
    },
  });
  /** The waiting question, by its request: a new copy of the same question keeps the card and what it holds. */
  const promptKey = createMemo(() => {
    const prompt = props.threads?.prompt;
    return prompt ? promptRequestKey(prompt.turnId, prompt.requestId) : null;
  });
  /** The takeover card, or its result, shows when the conversation's takeover is of this thread. */
  const takeoverShown = () => props.browserTakeover !== undefined || browserTakeoverResolution() !== null;
  /** Rebuilt only when a card comes or goes, so a card keeps what the person entered. */
  const hasAttention = createMemo(() => takeoverShown() || promptKey() !== null);
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
  /** Each thread keeps its unsent text while the agent works, and when another thread or chat opens. */
  const draft = () => {
    const key = threadComposer.openDraftKey();
    return key ? threadComposer.draft(key) : undefined;
  };
  // The preload imports the picked files, and the view routes them to the open thread.
  const openPicker = () => {
    const input = picker();
    if (!input) return;
    input.value = "";
    input.click();
  };
  /** The cards that the thread waits for: its browser takeover, and its question as a form. */
  const attention = (threads: () => ConversationThreads) => {
    if (!hasAttention()) return undefined;
    return (
      <>
        <ConversationBrowserTakeover />
        <Show when={promptKey()} keyed>
          <Loading>
            <PendingPrompt
              questions={threads().prompt?.questions ?? []}
              block={threads().promptUiBlock}
              agents={props.agents}
              onSelectAgent={props.onSelectAgent}
              onOpenLink={(url) => void openExternalMessageUrl(url)}
              sendShortcut={deviceSendShortcut(props.platform)}
              onAnswer={(answers, options) =>
                threads().onAnswerPrompt(answers, options ?? failureToast("uiBlock.error.answerFailed"))
              }
            />
          </Loading>
        </Show>
      </>
    );
  };
  return (
    <Show when={view()}>
      {(current) => (
        <>
          <Show when={current().threads.acceptsFiles}>
            <Input
              ref={setPicker}
              type="file"
              accept={THREAD_ATTACHMENT_ACCEPT}
              multiple
              hidden
              tabindex={-1}
              data-openbot-attachment-picker="true"
            />
          </Show>
          <AgentThreadView
            task={current().threads.open ?? null}
            limit={current().threads.limit}
            agent={current().agent}
            agents={props.agents}
            messages={messages}
            skills={installedSkills()}
            skillsLoadFailed={installedSkillsLoadFailed()}
            mcpServers={mcpServers()}
            draft={draft()?.text ?? ""}
            draftAttachments={draft()?.attachments}
            onDraftChange={(text) => threadComposer.setText(threadComposer.openDraftKey(), text)}
            onPasteFiles={threadComposer.pasteFiles}
            onOpenDraftAttachment={(attachment) =>
              canPreviewAttachment(attachment)
                ? void previewAttachment(attachment)
                : attachmentAction(attachment, "open")
            }
            onAttachFiles={current().threads.acceptsFiles ? openPicker : undefined}
            onSend={(text) => threadComposer.send(current().threads, text)}
            onStop={() => current().threads.onStop()}
            onOpenLink={(url) => void openExternalMessageUrl(url)}
            onPreview={(attachment) => void previewAttachment(attachment)}
            onAttachmentAction={attachmentAction}
            approval={current().threads.approval}
            onRespondApproval={(decision) =>
              current().threads.onRespondApproval(decision, failureToast("prompt.approval.answerFailed"))
            }
            context={contextUsageView(current().threads.contextState)}
            onCompactContext={current().threads.onCompactContext}
            waitsForAnswer={promptKey() !== null || props.browserTakeover !== undefined}
            attention={attention(() => current().threads)}
          />
        </>
      )}
    </Show>
  );
}
