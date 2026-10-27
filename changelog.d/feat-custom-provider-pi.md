### Changed

- Custom endpoints are now a provider of their own. Their agents run in Pi, not in OpenCode, so
  OpenCode settings and sign-in do not change them. At start, OpenBot moves the agents and the
  default model that use a custom endpoint model on OpenCode to the new provider. The model stays
  the same.
- Team members on a version before Team API v8 no longer see the host's custom endpoint agents.
