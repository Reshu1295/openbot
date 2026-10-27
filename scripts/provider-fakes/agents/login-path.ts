// The harness starts with an absolute interpreter. Its child command exists only on the login PATH.
import { spawnSync } from "node:child_process";
import { serveFakeAcpAgent } from "../acp-agent";

let result = "";

serveFakeAcpAgent({
  initialize: (request, peer) =>
    peer.reply(request, {
      protocolVersion: 1,
      agentInfo: { name: "fake", version: "1.0.0" },
      agentCapabilities: {},
    }),
  "session/new": (request, peer) => {
    const child = spawnSync("openbot-login-path-node", ["-e", "process.stdout.write('MCP child started')"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (child.status !== 0) {
      peer.fail(request, { code: -32603, message: child.error?.message ?? child.stderr });
      return;
    }
    result = child.stdout;
    peer.reply(request, {
      sessionId: "login-path",
      models: { availableModels: [{ modelId: "fast", name: "Fast" }], currentModelId: "fast" },
    });
  },
  "session/prompt": (request, peer) => {
    peer.say(request.params.sessionId, result);
    peer.reply(request, { stopReason: "end_turn" });
  },
});
