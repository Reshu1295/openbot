### Added

- Agents now save lasting preferences and facts from your chats and side threads in the
  background. After every 20 turns, after 15 minutes with no new turn, when you clear a chat and when
  you close a side thread, the agent's provider reviews the new part of the conversation and adds,
  updates or forgets memories. The conversation shows the changes. Memories that you wrote or set
  stay as they are.
- Agents now search their saved memories before they say that they do not know something about you.
  A search also finds other forms of a word, so "closing" finds "closes".
- A memory review uses the provider's smaller default model when the agent's model costs more, such
  as Claude Haiku for an agent on Opus or Sonnet.
- Server settings > General > Memory review sets how often the agents on this computer review their
  memories: every 10, 20 or 40 turns, or Off. Off also stops the reviews after a pause, a clear and a
  closed side thread.
