### Fixed

- Keep a new provider account, such as another Gemini account, when its sign-in works but its first
  usage reading fails. Before, OpenBot removed the account after the Google sign-in, so it looked as
  if OpenBot did not add the account. A Reconnect with the same failure now shows the account as
  connected, not as an error.
