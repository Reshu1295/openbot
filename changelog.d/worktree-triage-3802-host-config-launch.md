### Fixed

- OpenBot starts on a Mac where `/Library/Application Support` or `/Library/Application Support/OpenBot`
  has a non-root owner or group write permission, and no host manager is installed. Before, OpenBot
  stopped at each start with an empty error. A start error from the host manager check now shows its
  cause.
