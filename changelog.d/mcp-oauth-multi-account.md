### Added

- Sign in to two accounts on one MCP server. Add the server twice and end each address with its own
  `#name`, such as `https://mcp.example.com/mcp#work` and `https://mcp.example.com/mcp#personal`.
  Each row keeps its own sign-in, and the server still receives the address without the `#name`.
  Before, both rows shared one sign-in, so signing in on one signed the other out.
