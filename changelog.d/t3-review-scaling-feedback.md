### Changed

- Messages that you send while an agent works now start one next turn together, in their order.
  Before, each message started its own turn.
- Slack, Discord and Telegram conversations send the agent's messaging guidance and the saved
  facts of the server only in the first turn of a provider session, and again when a fact changes.
  This makes each later turn smaller.
