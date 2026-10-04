# claude-plugins

Alexander Garzon's personal [Claude Code](https://docs.claude.com/en/docs/claude-code)
plugin marketplace. A public GitHub repo that doubles as a CC marketplace,
distributing custom skills, hooks, themes and output styles (and later
commands/agents/MCP)
across all machines via Claude Code's native `autoUpdate`.

## Install

```sh
claude plugin marketplace add agarzon/claude-plugins
claude plugin install agarzon@agarzon-plugins
```

Set `autoUpdate: true` for the `agarzon-plugins` entry in
`~/.claude/plugins/known_marketplaces.json` so machines pull new skills on the
next session.

## Add a skill, hook, mod, theme, or output style

1. Drop `plugins/agarzon/skills/<name>/SKILL.md` (or `output-styles/<name>.md`,
   or edit `hooks/hooks.json`, or the mod in
   `hooks/register.tsx`; check a mod with `claude plugin validate plugins/agarzon`
   and `claude plugin test plugins/agarzon`).
2. Bump `version` in `plugins/agarzon/.claude-plugin/plugin.json`.
3. Commit and push. Machines with `autoUpdate` pull it on the next session.

Step 2 is not optional — without a version bump nothing propagates.

## Contents

- **`handoff`** / **`wrap`** (skills) — save pending work to `HANDOFF.md` and continue in a
  fresh session, or close the day. See below.
- **Session mod** (`hooks/register.tsx`) — prompt-cache countdown and warning, output-style
  switcher, context-fill nudge, handoff automation, and the list of loaded skills. See below.
- **claude-mem sync** (hooks + scripts) — keeps [claude-mem](https://github.com/thedotmack/claude-mem)
  memory in step across machines. See below.
- **`ELI5`** (output style) — small words, short answers, for a fried brain.
  Selectable as **`agarzon:ELI5`** — plugin styles are namespaced `plugin:style`,
  and bare `ELI5` resolves to nothing. Pick it in the `/config` panel, or set
  `"outputStyle": "agarzon:ELI5"` in `settings.json`. Note that the inline
  `/config outputStyle=` completion only offers the five built-ins, so this
  style never appears there. Files in `output-styles/` are picked up by
  convention; no `plugin.json` key needed.

## handoff and wrap

`HANDOFF.md`, at the repo root and kept out of git through `.git/info/exclude`, is the
to-do list that carries work between sessions. It holds only pending work: each item is
removed when done and the file is deleted when empty.

- `/handoff` writes or merges the file, then calls the mod's `handoff_ready` tool. When
  the turn ends the mod runs `/rename <name>`, `/clear`, `/rename <name>-2`, and sends
  the next session "Read HANDOFF.md and continue". Claude Code carries a session's name
  across `/clear`, so the second rename keeps the two sessions apart in history.
- `/wrap` does the same file plus the end-of-day chores (commits, artifacts to delete,
  memory and vault updates, approved in one batch), renames the session and stops.

## Session mod

A mod is a plugin hooks module: `hooks/hooks.json` lists it under `modules`, next to the
classic command hooks. The row it draws above the prompt:

```
⧗ cache 42m │ [ Concise ] │ ctx 62% → /handoff
loaded: ponytail·hook 1.3k  superpowers·hook 3.3k  plugin-authoring 4.9k ×2
```

- **Cache countdown.** The prompt cache lives 1 h (transcripts show only
  `ephemeral_1h` writes). The clock restarts when a main-loop turn that made an API call
  completes; subagent turns and local commands do not count. At 10 min left: a toast and
  a sound (`powershell.exe` on WSL, `afplay` on macOS). Past zero the next message
  re-caches the whole context at 2x input price.
- **Output style.** The button cycles the `/config` `outputStyle` row. It offers only the
  built-in styles, so `agarzon:ELI5` is not in the rotation.
- **Context nudge.** At 60 % fill, a toast and the `ctx` marker suggest `/handoff`.
- **Loaded list.** Every skill body and every hook-injected block in context now, read
  from the transcript so it survives `--resume`. Skills cyan, hooks magenta, **red ×N**
  when a body is in context more than once. That happens across a restart or
  `--resume`: Claude Code's "already loaded" dedupe lives in process memory, so a
  re-invocation injects the whole body again, and a typed `/skill` re-injects every
  time. Only `/compact` or a fresh session removes the copies.

The mod API is early access and changes between releases; `claude plugin validate`
reports anything the running build would refuse.

`allowed-tools` in a skill's frontmatter is a **command**-only key; adding it to a
`SKILL.md` makes the skill fail to load with `Execute skill: <name>`.

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
