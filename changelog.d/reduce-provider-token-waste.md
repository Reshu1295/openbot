### Fixed

- Gemini (Antigravity) agents in a channel get only the messages they have not read. Before, each channel turn sent the complete channel history again into the same session, so usage grew with each message. Long channel sessions are now also compacted.
- A change to MCP servers or skills keeps the conversations of Claude agents. Before, each Claude agent started a new session on its next turn, with a summary of the history and no prompt cache.
- Agents in a channel report their result with fewer model requests. Before, an agent such as Grok searched for the channel tools first, and each search step sent the whole conversation again.
- An "always allow" approval for an MCP tool keeps the conversations of Codex agents. Before, each Codex agent that used that server started a new session on its next turn.
