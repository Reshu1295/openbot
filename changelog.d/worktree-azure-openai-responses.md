### Fixed

- A custom provider on an Azure OpenAI or Azure AI Foundry v1 endpoint
  (`https://<resource>.openai.azure.com/openai/v1`) runs agent turns in OpenCode. Before, each turn
  failed with "Function tools with reasoning_effort are not supported".
