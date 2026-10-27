### Fixed

- A Pi agent keeps its OpenBot tools after OpenBot restarts. Before, a chat that was opened after a restart lost every OpenBot tool, and each restart gave the tools new names, so the agent could call old names and get "Tool ... not found". A Pi chat that already shows this error gets its tools again at its next turn.
- A Pi agent whose session file was moved or deleted starts a new session. Before, each turn stopped with "The Pi session file is not available on this computer."
