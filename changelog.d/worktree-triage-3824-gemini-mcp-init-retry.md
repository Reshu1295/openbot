### Fixed

- Let Gemini continue when one MCP server that OpenBot gives it does not start, such as a server that asks for a sign-in. Before, each Gemini turn failed with "The MCP server '<name>' failed to initialize". Now OpenBot leaves the server out, tells you which server it left out, and sends the message again.
