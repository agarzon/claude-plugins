---
name: handoff
description: Display a handoff summary in chat for the user to copy and use in the next session. Use when ending a session or transitioning work.
argument-hint: "What will the next session focus on?"
---

Generate a concise handoff summary of the current conversation and display it as text in the chat. The user can copy this directly for the next session.

## Output format

Display the summary as a single, copyable text block. Include:
- **Session context**: What was worked on
- **Current state**: What's done, what's pending, any blockers
- **Key findings**: Important discoveries or decisions
- **Next steps**: Specific tasks for the continuation
- **Suggested skills**: Which skills the agent should invoke in the next session
- **Relevant files/commands**: Exact paths and commands to resume work

Do NOT save to disk. Do NOT duplicate content from PRDs, plans, ADRs, issues, commits, or diffs — reference them by path instead.

Redact API keys, passwords, and personally identifiable information.

If the user provided an argument, use it to tailor the focus (e.g., "next session will focus on fixing the auth bug" → emphasize auth-specific context).

Keep it under 200 words unless critical details demand more. Use clear, scannable formatting. Make it trivial to copy and paste into the next session.
