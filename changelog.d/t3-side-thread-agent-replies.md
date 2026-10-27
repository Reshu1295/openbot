### Fixed

- When an agent asks another agent from a side thread, the answer now comes back to that side thread. Before, it arrived in the agent's own chat. The request still arrives in the other agent's own chat.
- A side thread now names the other agent as the author of its answer. Before, screen readers read the answer as a message from the thread's own agent.
