### Fixed

- Let agents read and answer website alerts and confirmations for the requested action. Before,
  a native popup could stop the agent until a person pressed a button. Manual browsing keeps native dialogs.
- Report whether browser input started or completed when page inspection fails. Agents can check
  the result before another attempt, which helps prevent duplicate bookings or cancellations.
- Wait briefly for temporary obstructions and disabled controls before a click. Check other validated
  points when Chromium reports an empty hit instead of stopping at the first point.
- Check clicks at the correct document position after scrolling. Before, a visible link could be
  reported as covered or unavailable because validation checked another part of the page.
- Put visible controls first in browser snapshots. On long pages, scrolling now exposes references
  to the visible links instead of keeping only early navigation controls.
- Keep text from later embedded frames when the snapshot control count is full.
- Skip automatic screenshots for canvas and video outside the document viewport. Requested images
  and images for pages with few controls remain available.

### Changed

- Collect browser snapshots with fewer browser commands and avoid unnecessary images for frames.
  Report observed sign-in, challenge text, and HTTP denials without treating a timeout as proof of a block.
- Reuse tool schemas returned by search. Add local dialog decisions and browser action timings to
  diagnostic logs without page content or credentials.
