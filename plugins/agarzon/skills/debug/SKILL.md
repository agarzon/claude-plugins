---
name: debug
description: Find the root cause before proposing any fix. Use when a bug, test failure, failed build or deploy, or unexpected behaviour shows up, and before trying a second fix.
argument-hint: "[the symptom]"
---

# Debug

No fix until the cause is found. A fix that makes the symptom go away without a known cause is a guess.

## Find it

1. Read the whole error: message, stack trace, exit code, the log lines around it.
2. Reproduce it. Write down the exact steps. If it does not reproduce reliably, gather more data; do not guess.
3. Check what changed: `git log` and diff, dependencies, config, environment, the host itself.
4. In a system with several parts (CI → build → deploy, proxy → app → database), log what enters and leaves each boundary, run once, and find the layer where good input becomes bad output. Then look only there.
5. Trace a bad value back to where it was first wrong. Fix it there, not where it surfaced.
6. Find a similar case that works and list every difference, even the ones that "can't matter".

## Test it

- One hypothesis at a time: "X is the cause because Y". Test it with the smallest change, one variable at a time.
- Wrong? Undo the change and form a new hypothesis. Never stack fixes.
- Don't know? Say "I don't understand X" and what would tell you.

## Fix it

- Before the fix, capture the failure as a test or a one-line reproduction command. After the fix, run it and show it pass.
- One change, the root cause only. No cleanups on the side.
- **After 3 failed fixes, stop.** Each fix moving the problem somewhere else means the design is wrong, not the hypothesis. Bring it to the user before a 4th attempt.

"No root cause" (timing, external service) is a valid result only after the steps above; it is usually an unfinished investigation. Then say what was checked and add the logging that would catch it next time.
