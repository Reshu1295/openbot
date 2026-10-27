### Added

- The Vault keeps API keys. Add a key with its variable name, such as `OPENAI_API_KEY`, in Server
  settings › Vault › New item › API key. Every agent on the server finds it with `list_api_keys` and
  reads it from a private file in its commands, so the key does not go into the chat. Only the user
  can add, change or delete a Vault API key. An owner or admin of a joined server can manage its API
  keys from the desktop app or the web app when the server has this version.
