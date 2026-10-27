### Fixed

- A chat with queued messages no longer slows down OpenBot. Before, each queue change wrote the
  queued messages to the database again and sent the whole chat to each connected device, and the
  queued messages went out of the chat and came back.
