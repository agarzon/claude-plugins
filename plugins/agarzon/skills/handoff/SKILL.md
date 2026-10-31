---
name: handoff
description: Close the session. Save pending work to HANDOFF.md, the contract the next session starts from, after the end-of-session chores. Use when the user says "handoff", "hand this off", "wrap", "wrap up", "done for today", "close the day", "let's stop here", "save everything and stop", "start fresh", "the context is getting long", or when the context-fill nudge appears.
argument-hint: "[what the next session should focus on]"
---

# Handoff

`HANDOFF.md` is the to-do list that carries work from one session to the next. It holds only what is still to do, never a record of what was done. The handoff ends the session: it starts nothing.

## 1. Gather

A handoff is written when context is fullest and recall is weakest. Ground it in the repo, not memory:

```bash
git status -sb; git log --oneline @{u}.. 2>/dev/null; git diff --stat
```

Read the existing `HANDOFF.md` if there is one, the session's task list, and any plan or spec being executed. Scan the session for approaches that were tried and rejected.

## 2. Chores

Collect everything first, then ask once (one AskUserQuestion, or one list) before doing any of it:

- Uncommitted changes and unpushed commits: propose commit and push, following the repo's rules.
- Artifacts this session created that are no longer needed (scratch files, probes, temp dirs, finished plans): exact paths.
- Memories worth saving and knowledge-base notes to update, per the project's CLAUDE.md.
- Constraints in the existing `HANDOFF.md` whose thread has no To do item left: offer to save the ones that still matter as a memory or knowledge-base note. They leave the file either way.

Do what was approved and say what was skipped. Nothing destructive runs without that yes. If nothing was collected, skip the question.

## 3. Write HANDOFF.md

Location: the repo's working-tree root (`git rev-parse --show-toplevel`); outside a repo, the session's root. Never commit it. Keep it out of git for this clone only, never via `.gitignore`:

```bash
x="$(git rev-parse --git-dir)/info/exclude"; grep -qxF HANDOFF.md "$x" || echo HANDOFF.md >> "$x"
```

Merge with the existing file: drop the items finished in this session, keep the rest, add the new ones. If nothing is left to do, delete the file instead of writing it, and say so.

```markdown
# Handoff: <project>, <YYYY-MM-DD HH:MM>

> Next session: read this file, present the state and the Next item, then wait for the user's go before acting on anything.

## Next
One line: the thread to resume and its first To do item. Exactly one, even when several threads are open.

## Goal
One or two lines: what the work is for, and the path of the plan or spec it follows.

## State
Branch, clean or dirty, ahead or behind. Facts the next session must trust or distrust, each marked (verified) or (unverified).

## To do
- [ ] Ordered items only. Each one stands alone: what to do, where (paths, commands, IDs), and how to tell it is done.

## Constraints / don't retry
- Decisions taken and approaches rejected, written as rules for the future, one line each with the reason. Only for threads that still have a To do item.

## Resume with
Skills to invoke, files to read first, commands to run.
```

Rules:

- No "done" section, no history, no narration of the session.
- Detailed enough to start cold, no longer than that: reference plans, specs, issues and commits by path instead of restating them.
- Redact secrets, tokens and personal data.
- If an argument names a focus, bias the file toward it.

Before saving, check the draft and fix what fails:

- `## Next` names one item, and that item is in To do.
- Every To do item says how to tell it is done.
- Every State fact is marked (verified) or (unverified).
- Every Constraint belongs to a thread with a To do item.

## 4. Stop

Choose a 2-4 word kebab-case name for the session that is ending and call the `handoff_ready` tool (an `mcp__…__handoff_ready` tool; load it with ToolSearch `handoff_ready` if it is deferred) with `name`. It renames the session when the turn ends. If the tool is not available, print `/rename <name>` for the user to run instead.

End the turn right after, with the file's path and one line: run `/clear` or quit; the next session starts by reading the file.
