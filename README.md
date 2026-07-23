# claude-plugins

Alexander Garzon's personal [Claude Code](https://docs.claude.com/en/docs/claude-code)
plugin marketplace. A public GitHub repo that doubles as a CC marketplace,
distributing custom skills (and later commands/hooks/agents/MCP) across all
machines via Claude Code's native `autoUpdate`.

## Install

```sh
claude plugin marketplace add agarzon/claude-plugins
claude plugin install agarzon@agarzon-plugins
```

Set `autoUpdate: true` for the `agarzon-plugins` entry in
`~/.claude/plugins/known_marketplaces.json` so machines pull new skills on the
next session.

## Add a new skill

1. Drop `plugins/agarzon/skills/<name>/SKILL.md`.
2. Bump `version` in `plugins/agarzon/.claude-plugin/plugin.json`.
3. Commit and push. Machines with `autoUpdate` pull it on the next session.

## Contents

- **`handoff`** (skill) — display a handoff summary to carry work into the next session.
- **`Agarzon Material Dark`** (theme) — Material-dark palette. Select via `/theme`;
  `Ctrl+E` copies it to `~/.claude/themes/` for local tweaking. Experimental CC
  feature — declared as `experimental.themes` in `plugin.json`.

See [`docs/design.md`](docs/design.md) for the full design and rationale.
