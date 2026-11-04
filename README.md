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
   `hooks/`; check a mod with `claude plugin validate plugins/agarzon`
   and `claude plugin test plugins/agarzon`). The engine allows one hook per
   event without a matcher, so those `on()` calls all live in `register.tsx`;
   each feature module declares the atoms it owns, because a `read`/`update`
   must name an atom declared in the same file.
2. Bump `version` in `plugins/agarzon/.claude-plugin/plugin.json`.
3. Commit and push. Machines with `autoUpdate` pull it on the next session.

Step 2 is not optional — without a version bump nothing propagates.

## Contents

- **`handoff`** (skill) — closes the session: end-of-session chores, then pending work saved
  to `HANDOFF.md` for the next session. See below.
- **`challenge`** (skill, `/challenge` only) — questions a plan or decision in rounds until
  every choice is settled, then posts the agreed plan and the decisions worth recording.
  Builds nothing.
- **`debug`** (skill) — root cause before any fix: reproduce, find the failing layer, one
  hypothesis at a time, stop after 3 failed fixes.
- **`tdd`** (skill) — test-first: watch it fail for the right reason, least code to pass,
  whole suite green before done.
- **`what`** (skill, `/what` only) — the last answer did not land: says it again with context,
  in Simplified Technical English. `/what <part>` re-explains only that part.
- **Session mod** (`hooks/`, entry `register.tsx`) — a band above the prompt: prompt rail, git row,
  model/effort/style switches, context, 5h/7d usage, prompt-cache timer, cold-send guard,
  keep-warm, auto-handoff, sounds, loaded skills. See below.
- **claude-mem sync** (hooks + scripts) — keeps [claude-mem](https://github.com/thedotmack/claude-mem)
  memory in step across machines. See below.
- **`ELI5`** (output style) — small words, short answers, for a fried brain.
  Selectable as **`agarzon:ELI5`** — plugin styles are namespaced `plugin:style`,
  and bare `ELI5` resolves to nothing. Pick it in the `/config` panel, or set
  `"outputStyle": "agarzon:ELI5"` in `settings.json`. Note that the inline
  `/config outputStyle=` completion only offers the five built-ins, so this
  style never appears there. Files in `output-styles/` are picked up by
  convention; no `plugin.json` key needed.

## handoff

`HANDOFF.md`, at the repo root and kept out of git by the global gitignore in `agarzon/dotfiles`, is the
to-do list that carries work between sessions. It holds only pending work: each item is
removed when done and the file is deleted when empty.

`/handoff` (also "wrap", "done for today", or the context nudge) runs the end-of-session
chores (commits, artifacts to delete, memory and vault updates, approved in one batch),
writes or merges the file, and calls the mod's `handoff_ready` tool, which renames the
session when the turn ends. Then it stops: you `/clear` or quit, and the next session
reads the file, presents the state and waits for your go.

## Session mod

A mod is a plugin hooks module: `hooks/hooks.json` lists it under `modules`. It draws a band
above the prompt. Every part has an on/off switch in `/config` → agarzon.

```
prompts ‹ 4 5 6 7 8 9 10 11 [12] › 12/12
⎇ feat/x* ↑2 +12 −3 │ MR !5 ✓ │ ~/GIT/app │ v2.1.318 │ 1h15m
⧗ cache 42m warm │ opus-5.5 medium │ Concise │ ctx 162k ▓▓░░░░░░ │ 5h 31% @16:40 │ 7d 12% @Fri │ skills 2 · 18k │ ♪
```

- **Prompt rail.** Your last 9 typed prompts. Click a number to scroll the transcript to
  it; `‹ ›` step one prompt; hover shows its first line. Narrow terminals show `‹ 12/27 ›`.
- **Git row.** Branch (`*` = uncommitted changes), worktree, ahead/behind, uncommitted
  `+/−` lines, the open PR (`gh`, GitHub remotes) or MR (`glab`, any other remote) with its
  CI, then folder, Claude Code version and session time. Refreshed after each turn and
  each `git` command; PR/MR every 5 min and after a push.
- **Model and effort.** Click to cycle. The change is for this session only: the mod
  rewrites each main-conversation request, so `settings.json` is never written and
  `/status` keeps showing the default. The label reads `opus?` until the next send, then
  the version actually served. `best` and `opusplan` are left out of the cycle.
- **Output style.** Cycles the built-in styles (`agarzon:ELI5` is not in the rotation).
- **Context.** Tokens and an 8-cell bar against the model's window. Yellow from half the
  limit, red at the limit (default 200k), where a toast, a sound and a `/agarzon:handoff`
  button appear.
- **5h / 7d.** The colour is the usage projected at the window's reset from the last
  30 min of pace: orange from 75 %, red from 90 %. Red shows when it reaches 100 %.
  In the window's first hour (first day for 7d) the colour follows the % used instead.
- **Cache.** The main conversation's prompt cache lives 1 h from its last request. Toast
  and sound at 10 min left and when it goes cold.
- **Cold-send guard.** Once the cache is cold and the context is 50k or more, your next
  typed prompt is held back once and put back in the box; Enter again sends it.
  Background, scheduled and slash-command prompts are never held.
- **Keep-warm** (`warm` button, or `/warm`, `/warm 90m`, `/warm off`). Pings the
  cache invisibly after 45 min idle so it never expires. Stops after 10 pings in a row,
  when a ping finds the cache cold, or at the time you gave. `/warm` lists the pings.
- **Auto-handoff** (off by default). At 5 min before the cache expires, with a 1-min
  warning, runs `/agarzon:handoff` and declines its permission prompts. Never fires
  while keep-warm is on.
- **Sounds.** Turn done (over 30 s), needs you, subagent done, cache expiring, context
  limit, cache cold: bundled CC0 files (`sounds/LICENSES.md`), each replaceable in
  `/config`. `♪` mutes all; `/sounds` mutes or unmutes one sound.
  Players: `afplay` (macOS), `paplay`/`aplay` (Linux), `powershell.exe` (WSL, Windows).
- **Skills chip and skill guard.** `skills N · Xk`: the skills now in context and their
  size, read from the transcript so it survives `--resume`; red when one is in context
  more than once. Claude Code skips a repeat only for a `Skill` tool call in the
  same run: a typed `/skill`, or any load after `--resume`, re-sends the whole body. The
  guard turns those repeats into a one-line pointer to the first copy, and toasts when a
  skill of 8k tokens or more loads.

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
