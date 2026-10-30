### Fixed

- Let agents read and answer website alerts and confirmations for the requested action. Before,
  a native popup could stop the agent until a person pressed a button. Manual browsing keeps native dialogs.
- Give pending alerts and confirmations to the native handler when their agent turn ends or stops.
  Keep tabs working if the native dialog listener layout changes. Let Close cancel a handed-off
  native sheet before contents close, without waiting on its blocked tab queue. Report prevented
  navigation so agents can ask for help without repeating the action. Preserve Electron's unsupported prompt behavior.
- Keep follow-up alerts and confirmations native after a dialog handoff, including after the action
  deadline or shutdown control cleanup. Let Close cancel the current sheet without another user decision.
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
- Stop targeted typing when a page moves focus to another field or replaces the target. Text and
  submit keys no longer continue into the other field after these changes.
- Keep the same tab when its main frame replaces an unfinished load and the replacement finishes.
  A cancelled load or failed replacement still reports failure. No navigation or input is replayed.
- Distinguish pointer-disabled accessibility targets from covering layers. Keep checked child clicks
  and explicit overlay dismissal, without clicking an unrelated visual sibling.

### Changed

- Collect browser snapshots with fewer browser commands and avoid unnecessary images for frames.
  Report observed sign-in, challenge text, and HTTP denials without treating a timeout as proof of a block.
- Omit empty page evidence and recognize Czech and German sign-in text as observations.
- Classify owned browser deadlines by error type, so page error text cannot claim a timeout.
  Record queue waits of at least 100 ms with only tab ID and duration.
- Reuse tool schemas returned by search. Add local dialog decisions and browser action timings to
  diagnostic logs without page content or credentials.
