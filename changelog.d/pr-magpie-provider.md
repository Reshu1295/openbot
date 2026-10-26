### Added

- Add Magpie as a provider. Magpie is a local LLM gateway that you run with `magpie serve`. OpenBot
  finds it at the port in its settings file, lists its models and routing groups, and sends the
  requests of each conversation as one Magpie session. Magpie agents run in Claude Code, with no
  Claude account, so they need no Pi or OpenCode download. Settings > Providers > Magpie can start the
  gateway with OpenBot when it is on your PATH.
- Show Magpie in the list of local servers that OpenBot finds, beside Ollama and LM Studio.
- Let Magpie set the model of OpenBot's Magpie agents. A Magpie agent plugin can write the address,
  key and model to `~/.config/openbot/magpie.json`, and OpenBot reads them within a few seconds. New
  Magpie agents start on that model, and Settings > Providers > Magpie shows it as "Set in Magpie".
  Agents that you already have keep their model. When Magpie removes them, OpenBot finds the gateway
  itself again.
