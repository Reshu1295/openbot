// The `opencode acp` of `opencode-free-limit-e2e.ts`. OpenCode 2.1.4 fails a prompt on a spent free
// model with `-32603` "Internal error: Free usage limit reached. …" and `provider.free-limit` in
// `data.errorName`. A second model fails with the same words and another `errorName`, so the check
// can tell the kind from the text. This fake fails each prompt in that way.
import { serveFakeAcpAgent } from "../acp-agent";

const FREE_MODEL = "opencode/deepseek-v4.1-flash-free";
const OTHER_MODEL = "opencode/other-model";
const FREE_LIMIT_TEXT =
  "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models.";

let count = 0;
serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] }),
  "session/new": (request, peer) => {
    count += 1;
    peer.reply(request, {
      sessionId: `s-${process.pid}-${count}`,
      models: {
        availableModels: [
          { modelId: FREE_MODEL, name: "DeepSeek V4.1 Flash Free" },
          { modelId: OTHER_MODEL, name: "Other" },
        ],
        currentModelId: process.env.FAKE_CURRENT_MODEL ?? FREE_MODEL,
      },
    });
  },
  "session/prompt": (request, peer) =>
    peer.fail(request, {
      code: -32603,
      message: `Internal error: ${FREE_LIMIT_TEXT}`,
      data: {
        service: "session",
        errorName: process.env.FAKE_CURRENT_MODEL === OTHER_MODEL ? "provider.other" : "provider.free-limit",
      },
    }),
});
