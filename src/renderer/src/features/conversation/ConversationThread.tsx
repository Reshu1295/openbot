import type { AgentMessage } from "@openbot/ui/data";
import { AgentThreadView } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import { DRAFT_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { createProjection, Show } from "solid-js";
import { toAgentMessages } from "../../app-message-projection";
import { ConversationBrowserTakeover } from "./ConversationBrowserTakeover";
import { useConversationController } from "./conversation-controller-context";
import { threadDraftKey } from "./conversation-keys";
import { useConversationViewScope } from "./conversation-scope";
import type { ConversationThreads } from "./conversation-types";
import { currentConversationTarget } from "./stores/composer-store";

/** The open side thread of the agent, in the place of the agent's own chat and its message box. */
export function ConversationThread() {
  const { props, openExternalMessageUrl, previewAttachment, attachmentAction, browserTakeoverResolution } =
    useConversationViewScope();
  const { threadDrafts, setThreadDrafts } = useConversationController();
  /** Reconciled by id, so a stream chunk redraws only the message that changed. */
  const messages = createProjection<AgentMessage[]>(
    () => {
      const conversation = props.threads?.conversation;
      return conversation ? toAgentMessages(conversation.messages, props.agent?.id) : [];
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
  const draftKey = () => {
    const target = currentConversationTarget(props);
    return target && threadDraftKey(target, props.threads?.open?.id ?? DRAFT_THREAD_ID);
  };
  const draft = () => {
    const key = draftKey();
    return key ? (threadDrafts()[key] ?? "") : "";
  };
  const setDraft = (key: string | undefined, text: string) => {
    if (!key) return;
    setThreadDrafts((current) => {
      if (text) return { ...current, [key]: text };
      if (!(key in current)) return current;
      const { [key]: _removed, ...next } = current;
      return next;
    });
  };
  // The first message of a new thread starts the thread and opens it, so the key is read before the send.
  const send = async (threads: ConversationThreads, text: string) => {
    const key = draftKey();
    const sent = await threads.onSend(text);
    if (sent) setDraft(key, "");
    return sent;
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
          draft={draft()}
          onDraftChange={(text) => setDraft(draftKey(), text)}
          onSend={(text) => send(current().threads, text)}
          onStop={() => current().threads.onStop()}
          onOpenLink={(url) => void openExternalMessageUrl(url)}
          onPreview={(attachment) => void previewAttachment(attachment)}
          onAttachmentAction={attachmentAction}
          approval={current().threads.approval}
          onRespondApproval={(decision) => current().threads.onRespondApproval(decision)}
          attention={props.browserTakeover || browserTakeoverResolution() ? <ConversationBrowserTakeover /> : undefined}
        />
      )}
    </Show>
  );
}
