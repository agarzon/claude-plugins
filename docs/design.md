# Design: `agarzon/claude-plugins` — personal Claude Code plugin marketplace

**Status:** approved, ready to implement
**Last revised:** 2026-07-23

## Purpose

Distribute personal Claude Code custom skills (and later commands/hooks/agents/MCP)
across all machines via a **public GitHub repo that doubles as a CC marketplace**,
using Claude Code's native `autoUpdate` — the same mechanism already governing the
other 5 marketplaces (claude-plugins-official, claude-mem, ponytail,
understand-anything, ui-ux-pro-max-skill).

**Why not chezmoi:** chezmoi is for dotfiles and has no concept of CC's plugin
lifecycle. It only carries the statusline script today (`agarzon/dotfiles`
→ `dot_claude/executable_statusline-command.sh`). The `handoff` skill is currently
a loose, machine-local file (`~/.claude/skills/handoff/SKILL.md`) with **no
distribution at all**. This repo fixes that.

## Decisions (locked)

| Thing            | Value                              |
| ---------------- | ---------------------------------- |
| Repo visibility  | **public**                         |
| GitHub repo      | `agarzon/claude-plugins`           |
| Marketplace name | `agarzon-plugins` (was `claude-plugins`; CC now rejects any marketplace name containing "claude" as impersonation — discovered at install 2026-07-23. Repo stays `agarzon/claude-plugins`.) |
| Structure        | one plugin, many skills            |
| Plugin name      | `agarzon` (generic, artifact-agnostic — not `-skills`, because a plugin can also hold commands/hooks/agents/MCP) |
| First skill      | `handoff` → `handoff@agarzon`      |
| License          | MIT                                |
| Start version    | `0.1.0`                            |
| Local clone      | `~/GIT/experiments/claude-plugins` |

## Repo layout

```
agarzon/claude-plugins/                 (public GitHub repo)
├── .claude-plugin/
│   └── marketplace.json                # marketplace "agarzon-plugins", lists 1 plugin
├── plugins/
│   └── agarzon/
│       ├── .claude-plugin/
│       │   └── plugin.json             # plugin "agarzon", v0.1.0
│       └── skills/
│           └── handoff/
│               └── SKILL.md            # migrated verbatim from ~/.claude/skills/handoff
├── docs/
│   └── design.md                       # this file
├── AGENTS.md                           # context pointer for CC sessions in this repo
├── README.md
└── LICENSE                             # MIT
```

Same-repo plugin `source` is a relative-path string (confirmed against installed
marketplaces: understand-anything uses `"./understand-anything-plugin"`, the
official directory uses `"./plugins/agent-sdk-dev"`).

## Concrete file contents

### `.claude-plugin/marketplace.json`

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "agarzon-plugins",
  "description": "Alexander Garzon's personal Claude Code plugins.",
  "owner": {
    "name": "Alexander Garzon"
  },
  "plugins": [
    {
      "name": "agarzon",
      "description": "Personal Claude Code skills and workflow extensions.",
      "source": "./plugins/agarzon",
      "author": {
        "name": "Alexander Garzon"
      }
    }
  ]
}
```

### `plugins/agarzon/.claude-plugin/plugin.json`

```json
{
  "name": "agarzon",
  "version": "0.1.0",
  "description": "Personal Claude Code skills and workflow extensions.",
  "author": {
    "name": "Alexander Garzon"
  },
  "repository": "https://github.com/agarzon/claude-plugins",
  "license": "MIT",
  "keywords": ["claude-code", "skills", "handoff", "personal"]
}
```

### `plugins/agarzon/skills/handoff/SKILL.md`

Copy **verbatim** from `~/.claude/skills/handoff/SKILL.md` (no content changes —
pure lift-and-shift). Current content is the canonical version.

### `AGENTS.md` (repo root)

Short pointer so a fresh CC session opened in this repo loads context:
"This is a personal Claude Code plugin marketplace. See `docs/design.md` for the
full design and the implementation checklist below."

### `README.md`

What it is; install one-liner; how to add a new skill (drop a
`plugins/agarzon/skills/<name>/SKILL.md`, bump `version` in `plugin.json`, commit,
push — machines pull on next session via autoUpdate).

### `LICENSE`

MIT, "Alexander Garzon", year 2026.

## Implementation checklist (for the finishing session)

1. Scaffold the files above verbatim.
   → verify: `ls -R` matches the layout; JSON is valid (`jq . <file>`).
2. Copy the handoff skill: `cp ~/.claude/skills/handoff/SKILL.md plugins/agarzon/skills/handoff/SKILL.md`.
   → verify: files identical (`diff`).
3. Commit; create the **public** GitHub repo and push
   (`gh repo create agarzon/claude-plugins --public --source . --push`).
   → verify: `gh repo view agarzon/claude-plugins` shows public; anonymous
     `git clone https://github.com/agarzon/claude-plugins /tmp/…` succeeds.
4. Install on M1: `claude plugin marketplace add agarzon/claude-plugins`
   then `claude plugin install agarzon@agarzon-plugins`.
   → verify: `claude plugin list` shows `agarzon` installed **and enabled**.
5. Set `autoUpdate: true` for the `agarzon-plugins` entry in
   `~/.claude/plugins/known_marketplaces.json` (standing rule — all marketplaces
   autoUpdate:true). Back up first; run the autoUpdate sweep AFTER install (install
   rewrites known_marketplaces.json).
   → verify: `jq '."agarzon-plugins".autoUpdate' known_marketplaces.json` → `true`.
6. Verify `handoff` resolves from the plugin (invoke `/handoff`).
7. **Migration cleanup:** remove the loose copy so exactly one `handoff` skill
   exists — `rm -rf ~/.claude/skills/handoff` (user runs this; the catastrophic
   denylist blocks the agent).
   → verify: `handoff` still works (now from plugin); no duplicate.
8. **Rollout M3 + M2:** run steps 4–5 on each. (M2 is currently deferred per the
   toolbox handoff; do M3 next.)
9. **Record in the toolbox normalization docs:** add register **#25**
   (personal marketplace `agarzon/claude-plugins`) to
   `docs/claude-code-inventory.md`, and a cross-machine step to `docs/handoff.md`.

## Success criteria

- `claude plugin list` shows `agarzon` installed and enabled on M1.
- Invoking `/handoff` produces a summary (loaded from the plugin).
- `known_marketplaces.json` has `agarzon-plugins` with `autoUpdate: true`.
- Exactly one `handoff` skill (loose copy removed).
- Repo public and anonymously clonable.

## Scope guards (YAGNI)

- One plugin; no commands/hooks/agents/MCP yet — add when a real need appears.
- No CI, no version automation, no tests. `version` bumped by hand.
- `handoff` SKILL.md content is NOT rewritten — pure lift-and-shift.
