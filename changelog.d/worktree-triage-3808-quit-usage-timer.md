### Fixed

- Quit OpenBot without the error "OpenBot database is not initialized." when an agent reports its
  context use during the quit.
- Keep a self-hosted or hosted server responsive after an error in the main process, and let it
  finish a quit. Before, an error box that nobody could close on the server display stopped the
  process, and the service manager did not start it again. A quit on desktop also shows no error box.
