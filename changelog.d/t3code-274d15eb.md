### Fixed

- Gemini no longer fills the memory of a computer or server over hours of use. Before, each Gemini chat and each model list refresh kept a helper process of about 100 MB until Gemini stopped, so a 4 GB server often held new messages for low memory. Now each Gemini chat runs in a process of its own, and OpenBot ends that process when the chat has been idle for 10 minutes, when more than two chats are idle, or when memory is low. The next message continues the same chat.
