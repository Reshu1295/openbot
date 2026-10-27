### Added

- Right-click an agent in the sidebar and choose "New thread" to open its chat with a new thread.

### Changed

- The agent's name in the chat header opens the agent's main chat while a thread is open. In the main chat it opens
  the agent settings, as before. The main chat no longer has a tab, and the thread list shows only threads.

### Fixed

- Go back from a thread to the agent's main chat at once. Before, the main chat was built again, which took about half
  a second and moved it to the top. Now it keeps its place.
- Show the full time of each thread in the thread list. Before, a 12-hour time such as "10:12 AM" stopped after "10:1".
- Close the side panel after you close its last tab. Before, the app stopped responding and the panel stayed open.
- Keep the provider session of a thread when its delete fails and you restore it. Before, the restored thread started a
  new session and lost its thread instructions.
