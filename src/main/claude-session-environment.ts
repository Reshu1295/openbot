/**
 * Variables that a Claude Code session sets for the commands it runs. When an agent starts OpenBot
 * with `open -a OpenBot` from such a command, the app gets them, and every agent and tool inherits
 * them from this process. A Claude agent then runs as a child of that other session: the SDK keeps
 * an inherited `CLAUDE_CODE_ENTRYPOINT`, so each new session writes its prompt cache again (#3415).
 * User settings such as `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK` or `CLAUDE_CONFIG_DIR`
 * stay.
 */
const CLAUDE_CODE_SESSION_VARIABLES = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_BRIDGE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_CHROME_MCP_ORG_DENIED",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EVAL_INTERVIEW_SESSION",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
]);
/** The desktop host and background sessions of Claude Code set these for the session they start. */
const CLAUDE_CODE_SESSION_PREFIXES = ["CLAUDE_CODE_HOST_", "CLAUDE_BG_"];

/** Removes the variables of a Claude Code session that started this process. */
export function removeClaudeCodeSessionEnvironment(environment: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(environment)) {
    if (
      CLAUDE_CODE_SESSION_VARIABLES.has(name) ||
      CLAUDE_CODE_SESSION_PREFIXES.some((prefix) => name.startsWith(prefix)) ||
      (name === "AI_AGENT" && environment.AI_AGENT?.startsWith("claude-code"))
    ) {
      delete environment[name];
    }
  }
}
