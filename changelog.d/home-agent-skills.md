### Added

- Agents use the skills in your `~/.agents/skills` folder with every provider. Claude gets them as `agents:<name>`, and a skill that Claude already reads from `~/.claude/skills` is not added again. Antigravity, Muse and custom ACP agents get a list of these skills in their instructions and read a skill's `SKILL.md` when a task needs it. The other providers already read the folder.
- Type `$` in the message field to tag a skill from `~/.agents/skills`. The agent gets the path of the skill's `SKILL.md`, so every provider can open it.
