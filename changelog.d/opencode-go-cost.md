### Fixed

- Usage now shows the token cost of OpenCode turns, including OpenCode Go. Before, the OpenCode cost was always "Unavailable". The cost is the session cost that OpenCode reports, at API-equivalent rates, not the subscription charge. When earlier turns of a session have no cost, as in a session that started before this release, the first turn with a cost has no cost.
- Two reads of the history of one Claude session at the same time no longer fail with "database is locked". Before, this error could show when an agent continued on its backup model while OpenBot read the session history after a start.
