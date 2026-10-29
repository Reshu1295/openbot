### Fixed

- Let agents read and answer website alerts and confirmations for the requested action. Before,
  a native popup could stop the agent until a person pressed a button. Manual browsing keeps native dialogs.
- Report whether browser input started or completed when page inspection fails. Agents can check
  the result before another attempt, which helps prevent duplicate bookings or cancellations.
- Wait briefly for temporary obstructions and disabled controls before a click. Check other validated
  points when Chromium reports an empty hit instead of stopping at the first point.

### Changed

- Collect browser snapshots with fewer browser commands and avoid unnecessary images for frames.
  Report observed sign-in, challenge text, and HTTP denials without treating a timeout as proof of a block.
- Reuse tool schemas returned by search. Add local dialog decisions and browser action timings to
  diagnostic logs without page content or credentials.
