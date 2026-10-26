### Fixed

- Connecting Firecrawl, or another plugin that starts with `npx`, no longer fails with "The server did
  not answer in 10 seconds" on its first start. A local server now has 60 seconds to download its
  package and answer. A server at a web address still has 10 seconds.
