### Fixed

- Cursor turns fail less often with "Invalid model value". Cursor asks its server for the model
  list each time the model is set, and reports a failed request as an invalid model. OpenBot now
  sets the Cursor model only when it changes, not before every turn (#3800).
