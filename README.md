# claude-plugins

Alexander Garzon's personal [Claude Code](https://docs.claude.com/en/docs/claude-code)
plugin marketplace. A public GitHub repo that doubles as a CC marketplace,
distributing custom skills, hooks and themes (and later commands/agents/MCP)
across all machines via Claude Code's native `autoUpdate`.

## Install

```sh
claude plugin marketplace add agarzon/claude-plugins
claude plugin install agarzon@agarzon-plugins
```

Set `autoUpdate: true` for the `agarzon-plugins` entry in
`~/.claude/plugins/known_marketplaces.json` so machines pull new skills on the
next session.

## Add a skill, hook, or theme

1. Drop `plugins/agarzon/skills/<name>/SKILL.md` (or edit `hooks/hooks.json`).
2. Bump `version` in `plugins/agarzon/.claude-plugin/plugin.json`.
3. Commit and push. Machines with `autoUpdate` pull it on the next session.

Step 2 is not optional — without a version bump nothing propagates.

## Contents

- **`handoff`** (skill) — display a handoff summary to carry work into the next session.
- **claude-mem sync** (hooks + scripts) — keeps [claude-mem](https://github.com/thedotmack/claude-mem)
  memory in step across machines. See below.
- **`Agarzon Modarin`** (theme) — port of Midnight Commander's `modarin256`
  palette (neutral grey base, teal accents). Select via `/theme`; `Ctrl+E` copies
  it to `~/.claude/themes/` for local tweaking. Experimental CC feature — declared
  as `experimental.themes` in `plugin.json`.

## claude-mem sync

claude-mem stores its memory in a local SQLite database per machine, so each
machine accumulates its own history and none of them ever see each other's.
These hooks close that gap without a server.

| File | Role |
|---|---|
| `hooks/hooks.json` | `SessionStart` → import peers · `Stop` → publish own new rows |
| `scripts/mem-sync.sh` | the hook entry point: `export` \| `import` |
| `scripts/mem-export.sh` | DB → `/api/import` payload. `--since <epoch>` for incremental |
| `scripts/mem-import.sh` | chunked, ordered, resumable import. `--dry-run` does an FK check without sending |

A resumed session keeps its `content_session_id` but gets a **new**
`memory_session_id`, while `sdk_sessions` is unique on `content_session_id` — so a
peer's version of a session you already hold is dropped as a duplicate and its
summaries then fail the foreign key, jamming that peer's import permanently.
`mem-import.sh` rewrites incoming session ids to the local ones before posting.
Each side relinks on the way in, so the two machines disagreeing about the label
is harmless. `--dry-run` cannot catch this: its FK check is payload-internal.

Data travels as JSON in `~/General/claude-mem-sync/<device>.json` over
[Syncthing](https://syncthing.net/) — **never git**, this repo is public. Set
`CLAUDE_MEM_SYNC_DIR` to point elsewhere.

**One writer per file** is what makes this safe: a machine only ever writes its
own `<device>.json`, so no two machines touch the same file and
`.sync-conflict-*` cannot happen. Device name comes from
`CLAUDE_MEM_CLOUD_SYNC_DEVICE_NAME`, else claude-mem's settings, else `hostname -s`.

Export reads SQLite directly rather than claude-mem's read API, which caps out
near 200 rows and rewrites session ids such that its own output fails the
foreign key on re-import. Import goes through the worker's `POST /api/import`
so dedupe, transactions and FTS triggers stay the vendor's problem.

Sync never blocks a session: every path exits 0 and problems go to
`~/.claude-mem/logs/mem-sync.log`.

**Accepted ceilings.** Append-only — deletions and title/project edits do not
propagate. Identical work done on two machines survives twice, because dedupe
keys on session id and those differ per machine. Only one summary per session
survives an import. Embeddings never sync; Chroma is local per machine.

### One-time consolidation

To seed machines that have been drifting apart, bypass the hooks and merge
snapshots by hand:

```sh
mem-export.sh --db <snapshot>.db --out peer.json
mem-import.sh peer.json --dry-run   # expect 0 orphans
mem-import.sh peer.json
```

Take snapshots with `sqlite3 <db> ".backup <out>"` — the database is WAL-mode
with a live writer, so `cp` can capture a torn state.

Then **seed the watermark on each machine** so the first `Stop` hook publishes
only new work instead of re-shipping the history the machines already share:

```sh
date +%s000 > ~/.claude-mem/mem-sync.watermark
```

Skip this and the first export publishes every row the machine holds — correct,
but a needlessly large first sync that every peer then re-imports and skips.

See [`docs/design.md`](docs/design.md) for the full design and rationale.
