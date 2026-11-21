---
name: blindspot
description: Find what you don't know you don't know about a system before the first change to it. Use before touching unfamiliar, fragile or rarely changed code, hosts or services, or when a plan rests on how something "should" work.
argument-hint: "[the system and the change planned]"
---

# Blindspot

Before the first change, map what the change touches that nobody has mentioned. The result is a list of blindspots and a better prompt, not a fix.

## Look

Read-only, no changes. Use a subagent for wide searches.

1. The planned change, in one sentence. If it is unclear, ask that first and stop.
2. What it touches: code, config, docs, git history, the project's notes, and live state reachable with read-only commands (process lists, logs, `docker ps`, DNS, crontabs, timers).
3. For each part, look for what would surprise someone who only read the docs:
   - Hidden coupling: other services, jobs, hooks or hosts that read or write the same thing.
   - State outside the repo: hand edits on a server, data in volumes, secrets, caches, certificates.
   - Silent failure: what could break and still look healthy.
   - Order and timing: restarts, migrations, renewals, scheduled jobs that run mid-change.
   - Rollback: what cannot be undone, and what a backup would miss.
   - Drift: where the live state differs from the source of truth.

## Report

Up to seven blindspots, most dangerous first. Each one:

**B1 — <title>**: what you found, and why it matters for this change. Proven (cite `path:line` or the command and its output) or inferred.
Prompt fix: the sentence to add to the task so it is handled.

Then one **Better prompt**: the original task rewritten with every prompt fix folded in, in a fenced `text` code block.

Then stop. Change nothing until the user says go.
