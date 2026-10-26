### Added

- Add Magpie as a provider. Magpie is a local LLM gateway that you run with `magpie serve`. OpenBot
  finds it at the port in its settings file, lists its models and routing groups, and sends the
  requests of each conversation as one Magpie session. Magpie agents run in Claude Code, with no
  Claude account, so they need no Pi or OpenCode download. Settings > Providers > Magpie can start the
  gateway with OpenBot when it is on your PATH.
- Show Magpie in the list of local servers that OpenBot finds, beside Ollama and LM Studio.
