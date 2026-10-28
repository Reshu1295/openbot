### Fixed

- When Gemini starts slowly after its first download, as on an Intel Mac, OpenBot now keeps the
  download and tries again, and waits twice as long at each try. Before, OpenBot deleted Gemini
  after 3 minutes, and each Retry downloaded it again and failed the same way.
