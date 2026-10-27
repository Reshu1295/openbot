### Fixed

- A Pi agent keeps its OpenBot tools after OpenBot restarts. Before, each restart gave the tools new names, and after some restarts the agent called old names and got "Tool ... not found" for each OpenBot tool. A Pi chat that already shows this error recovers in a new chat.
- A Pi agent whose session file was moved or deleted starts a new session. Before, each turn stopped with "The Pi session file is not available on this computer."
