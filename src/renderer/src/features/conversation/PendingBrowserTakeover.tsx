import { BrowserTakeoverCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";
import type { BrowserTakeoverRequest } from "./conversation-types";

/** The browser takeover that an agent's turn waits for, as the card the person answers. */
export function PendingBrowserTakeover(props: { request: BrowserTakeoverRequest; agentName: string }) {
  const scope = useConversationViewScope();
  const runtime = conversationRuntime(scope.props);
  return (
    <BrowserTakeoverCard
      request={props.request}
      agentName={props.agentName}
      tab={scope.browserTakeoverTab()}
      preview={scope.browserTakeoverPreview().preview}
      previewStatus={scope.browserTakeoverPreview().status}
      onOpen={scope.openBrowserTakeoverTab}
      onComplete={() => scope.respondToBrowserTakeover("complete")}
      onCancel={() => scope.respondToBrowserTakeover("cancel")}
      onSignInLocally={scope.localSignIn.canStartForTakeover() ? scope.localSignIn.startForTakeover : undefined}
      signInBlocked={scope.localSignIn.blockedTakeover()}
      browserSecret={{
        loadPreview: runtime.browser.capturePreview,
        vaultSave: scope.props.server?.kind === "local",
        onRespond: runtime.agent.respondToBrowserSecret,
      }}
    />
  );
}
