---
name: challenge
description: Question a plan, design or decision until every choice in it is settled and nothing is silently assumed, before anything is built. Works in any project.
argument-hint: "[the plan or decision to challenge]"
disable-model-invocation: true
---

# Challenge

Question the user about a plan, design or decision until every choice in it is made explicitly. The result is a shared understanding, not code.

## Facts are yours, decisions are theirs

- Before asking anything, check what the project can tell you: code, config, docs, git history, and live state reachable with read-only commands. Use a subagent for wide searches. Ask the user only for facts that exist in their head or in systems you cannot reach; those go under **Need from you**, never dressed up as a decision.
- When the user states how something works, verify it. A contradiction becomes a question: "You said X; `path:line` does Y. Which is right?"
- Mark every finding proven (cite where) or inferred.
- A vague or overloaded term ("account", "deleted", "user") becomes a question that proposes the precise meaning.

## Rounds

List every decision the plan needs, including the ones the user did not mention: cutover, rollback, cost, who is affected, how it fails. A decision is ready when nothing it depends on is still open. Each round asks every ready decision and holds back the rest.

A round is, in this order:

1. **Settled**: from the second round on, each answer just given, one line each, restated as you understood it.
2. **Findings**: what you checked, one line each, marked proven or inferred. Only what is new since the last round.
3. **Need from you**: facts only the user can supply, as plain numbered questions with no recommendation. Decisions that depend on them go to Held back.
4. **Decisions**, numbered across the whole session, each one a choice between options:

   **Q3 — <title>**: <the options and their trade-offs>
   ➡️ Recommended: <one of the options> — <one-line reason>

5. **Held back**: the decisions waiting on this round's answers, one line.

Then stop and wait. The answers settle decisions and unlock the next round.

## Done

The session is done when no decision is open. The final reply is, in this order:

1. **Agreed plan**: each decision and its answer, one line each.
2. **Worth recording**: the decisions that pass all three tests below, each with where it would go; or "none".
   - Hard to reverse.
   - A future reader would be surprised by it without the context.
   - It came from a real trade-off.

   The place is where the project's CLAUDE.md says durable decisions go. If it names none, it is `docs/adr/NNNN-<slug>.md` (next free number; one to three sentences: context, decision, why).

Then stop. Write records only after a yes, and implement nothing until the user confirms the plan and says go.
