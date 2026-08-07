---
name: handoff
description: Display a handoff summary in chat for the user to copy into the next session, or write it to a file if they ask. Use when ending a session or transitioning work, and whenever the user says "handoff", "wrap up", "hand this off", or asks what the next session should pick up.
argument-hint: "What will the next session focus on?"
---

## Output format

Display the summary as a single, copyable text block:

- **Session context**: What was worked on
- **Current state**: What's done, what's pending, any blockers
- **Key findings**: Important discoveries or decisions
- **Next steps**: Specific tasks for the continuation
- **Suggested skills**: Which skills the agent should invoke in the next session
- **Relevant files/commands**: Exact paths and commands to resume work

Reference PRDs, plans, ADRs, issues, commits, and diffs by path — don't restate what they already hold.

Redact API keys, passwords, and personally identifiable information.

If an argument is given, bias the summary toward it.

After the block — outside it, so it doesn't get pasted forward — suggest a 2-4 word kebab-case name for the session that is ending, for the user to run as `/rename <name>`. It makes the session findable in history later, and a name chosen here beats the built-in's, which only reads the last 1000 characters of the conversation.

Aim for under 200 words. A handoff much longer than that is usually restating something that already lives in a file — link it instead. Go longer only when the detail genuinely has nowhere else to live; a truncated handoff defeats the point of writing one.

## Handoff file

Default to chat only. Save to disk only if the user asks for a file — then:

- Write it to the project root (the repo working-tree root), not a temp or scratchpad directory.
- Never `git add` or commit it.
- Don't edit `.gitignore`. It's tracked, so hiding a personal scratch file there pushes your local mess onto everyone else on the repo. `.git/info/exclude` does the same job for this clone only:

```bash
echo "HANDOFF.md" >> "$(git rev-parse --git-dir)/info/exclude"
```

Not a git repo? Just write the file.
