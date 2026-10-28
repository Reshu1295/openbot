### Fixed

- About 30 seconds after iOS puts the OpenBot app to sleep, a server now updates the iPhone Live Activity
  and Dynamic Island, and sends notifications. Before, when the app went to sleep before it told the
  server, the activity could show "Working" for more than two minutes after the agent finished, and
  notifications for that time did not come.
