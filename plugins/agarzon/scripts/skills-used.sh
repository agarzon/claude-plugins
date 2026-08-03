#!/usr/bin/env bash
# List the skills invoked in the current Claude Code session.
#
# Reads the session transcript directly — no hook, no state file, nothing to
# keep in sync. Claude Code already records every Skill tool call in
#   ~/.claude/projects/<cwd, with "/" replaced by "-">/<session-uuid>.jsonl
# so the data exists whether or not anything was tracking it.
#
# Two separate signals, because they live in different places:
#   - Skill tool calls  -> assistant messages, content[].type == "tool_use"
#   - typed /commands   -> entries with .type == "system"
# Do NOT grep the raw file for <command-name>: assistant messages that merely
# quote the tag match too, and so do tool results echoing it back.
#
# A count above 1 means that skill's SKILL.md body entered context more than
# once. Within one process Claude Code dedupes repeat loads (the second call
# gets "already loaded above; instructions unchanged" instead of the body), so
# counts >1 only show up across a --resume / /resume, where the dedupe state
# dies with the process.
#
# Usage: skills-used.sh [--selftest]

set -u

extract() {
    local f=$1
    echo "Skills invoked (count x name):"
    jq -r '.message.content[]? | select(.type=="tool_use" and .name=="Skill") | .input.skill' "$f" 2>/dev/null \
        | sort | uniq -c | sort -rn | sed 's/^/  /'
    echo "Slash commands typed:"
    jq -r 'select(.type=="system") | tostring | scan("<command-name>([^<]+)")[0]' "$f" 2>/dev/null \
        | sort -u | sed 's/^/  /'
}

# ── Self-check: fixture in, known output out ─────────────────────────
if [ "${1:-}" = "--selftest" ]; then
    tmp=$(mktemp) || exit 1
    trap 'rm -f "$tmp"' EXIT
    {
        echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"alpha"}}]}}'
        echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"alpha"}}]}}'
        echo '{"type":"assistant","message":{"content":[{"type":"text","text":"I will mention <command-name>/decoy</command-name> here"}]}}'
        echo '{"type":"system","content":"<command-name>/beta</command-name>"}'
    } > "$tmp"

    out=$(extract "$tmp")
    fail=0
    echo "$out" | grep -qE '^ +2 alpha$'  || { echo "FAIL: duplicate skill not counted as 2"; fail=1; }
    echo "$out" | grep -q  '/beta'        || { echo "FAIL: typed command not found"; fail=1; }
    echo "$out" | grep -q  '/decoy'       && { echo "FAIL: quoted tag leaked from assistant text"; fail=1; }
    [ "$fail" -eq 0 ] && echo "selftest OK"
    exit "$fail"
fi

dir="$HOME/.claude/projects/$(pwd | tr '/' '-')"
f=$(ls -t "$dir"/*.jsonl 2>/dev/null | head -1)
if [ -z "$f" ]; then
    echo "no transcript found for $(pwd)"
    exit 0
fi
extract "$f"
