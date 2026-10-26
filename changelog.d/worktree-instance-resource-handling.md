### Fixed

- On a server, agent builds no longer take all the CPU and memory and drop your connection. Before,
  a build such as `next build` started one worker for each CPU of the host, not of the server's
  limit, the server stopped answering, and the apps reconnected every few minutes. Agent processes
  now run at a lower CPU priority, and Node programs of agents see the server's CPU limit.
- When a server is almost out of memory, OpenBot now stops leftover agent processes first, such as
  preview servers and build workers that stayed after their job ended. Before, they kept their memory
  until the kernel stopped a process or the server restarted.
- Routine wake-up commands now run also when the long command fails, so an agent learns that its job
  stopped.
