### Fixed

- The activity log in `openbot.db` now records the turn of each `turn.completed` event and keeps the
  turn of each activity when OpenBot rebuilds a thread. Before, these rows had no turn. Rows that
  older versions wrote get their turn only when OpenBot rebuilds their thread.
