### Fixed

- OpenBot now starts the Codex app server again when it stops answering. Before, a hung Codex process stayed in use, and every agent turn and routine run failed until you stopped codex.exe yourself.
- When Codex does not answer, a message now fails with that reason. Before, it failed with "OpenBot could not register MCP servers in the Codex configuration", although `config.toml` was correct.
