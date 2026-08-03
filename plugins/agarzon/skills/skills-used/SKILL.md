---
name: skills-used
description: List the skills invoked in the current session, with invocation counts. Use when asked which skills are loaded, active, or already used, or to check whether a skill's body was injected into context more than once.
---

Run `scripts/skills-used.sh` with bash. Resolve it against the plugin root — this skill's base directory is printed directly above this body, so the script is `../../scripts/skills-used.sh` relative to it.

Print its output verbatim. Add nothing else unless a count is above 1.

A count above 1 means that skill's body entered context that many times. Within a single process Claude Code dedupes repeat loads — the second call returns `Skill /name is already loaded above; instructions unchanged.` instead of the body — so counts above 1 only appear across a `--resume` or `/resume`, where the dedupe state is lost with the process. If you see one, say so and name the skill.

An empty list is a valid result: it means no skill has been invoked in this session yet.
