### Fixed

- When Gemini or another ACP agent crashes, the error now shows the first line of the crash report,
  such as `F… Check failed: …` or `*** SIGABRT received …`. Before, it showed only the last line,
  `RAW: Raising signal 6`, which does not say why the agent stopped.
