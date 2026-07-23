# claude-plugins

Alexander Garzon's personal Claude Code plugin marketplace (public repo
`agarzon/claude-plugins`). Distributes custom skills — and later commands, hooks,
agents, MCP — across all machines via Claude Code's native marketplace `autoUpdate`,
replacing ad-hoc chezmoi/loose-file distribution.

## Status

Design approved and written. **Implementation not started.** The repo currently
contains only the design doc and this file.

## Next session: finish the job

Read `docs/design.md` — it holds the locked decisions, the exact file contents to
scaffold, and a numbered **implementation checklist** with verify steps. Execute
that checklist.

Quick map (all detail in `docs/design.md`):

- Marketplace `claude-plugins` → one plugin `agarzon` → skills (first: `handoff`,
  migrated verbatim from `~/.claude/skills/handoff/SKILL.md`).
- Public repo; MIT; plugin `version` 0.1.0.
- After install, remove the loose `~/.claude/skills/handoff` copy so there's exactly
  one `handoff` skill (user runs the `rm -rf`).
- Roll out to M3 (M2 deferred); record register #25 in the toolbox
  `docs/claude-code-inventory.md` + `docs/handoff.md`.
