### Fixed

- An OpenCode agent on a custom provider with an Azure OpenAI or Azure AI Foundry v1 base URL, such as
  `https://<resource>.openai.azure.com/openai/v1`, now answers. Before, each turn failed, because Azure
  refuses function tools with a reasoning effort on `/chat/completions`. OpenBot now sends these turns
  to `/responses`.
