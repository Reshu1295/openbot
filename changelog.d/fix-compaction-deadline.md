### Fixed

- A long context compaction with Codex or Pi now runs to its end. Before, OpenBot stopped each
  compaction after 2 minutes, so the compaction of a long thread did not complete. OpenBot now stops
  a compaction only when the provider does not start it in 2 minutes, or when it runs for 20 minutes.
