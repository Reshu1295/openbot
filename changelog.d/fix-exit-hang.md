### Fixed

- OpenBot now quits within 10 seconds when a file operation never finishes, for example when macOS
  waits for a privacy approval that nobody answers. Before, OpenBot stopped responding after you
  quit it, and it did not open again until you forced it to quit on macOS or ended it on Linux.
