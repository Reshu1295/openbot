### Fixed

- Queued messages no longer show Steer for Gemini, OpenCode, Cursor, Cline and custom agents. These
  providers cannot take a message into a running turn, so Steer always failed. The message still
  starts when the turn ends.
