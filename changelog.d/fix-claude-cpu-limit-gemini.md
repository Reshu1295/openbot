### Fixed

- On a Docker server of `docker/instances` with LXCFS, Gemini works again. Before, it stopped with
  SIGILL when it started, because the container listed only the CPUs of its limit as online.
- On a server, Node programs that Claude agents start now also see the server's CPU limit. Before,
  only Codex and the ACP agents got it, and a build of a Claude agent started a worker for each CPU of
  the host.
