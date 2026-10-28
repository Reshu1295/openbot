### Fixed

- When an agent started a new ChatGPT session, for example after it moved to a backup model, the chat
  could show a red `paginated_threads is not supported yet` error. ChatGPT cannot read a session
  before it saves the first turn, and OpenBot now does not show this as an error.
