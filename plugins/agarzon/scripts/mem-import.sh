#!/usr/bin/env bash
# Import a mem-export.sh payload into the local claude-mem worker.
#
# Chunks the payload. The worker's body limit sits between 5MB and 8MB (measured:
# 5MB -> 200, 8MB -> 413), and a full MacBook dump is 9.2MB, so a single POST
# fails outright. Batches are sized by row count, deliberately well under the cap.
#
# Order is load-bearing: sessions FIRST, in their own committed batch. Both
# observations and session_summaries carry a FK to sdk_sessions, and /api/import
# is transactional — a batch referencing an unshipped session rolls itself back.
#
# Safe to re-run. Dedupe is the worker's, so a second pass reports everything
# skipped rather than duplicating.
#
# Usage: mem-import.sh <payload.json> [--chunk N] [--dry-run]
set -euo pipefail

CHUNK=400
DRY=0
FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --chunk)   CHUNK="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *)         FILE="$1"; shift ;;
  esac
done

[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "usage: mem-import.sh <payload.json> [--chunk N] [--dry-run]" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

PORT="${CLAUDE_MEM_WORKER_PORT:-$(jq -r '.CLAUDE_MEM_WORKER_PORT // empty' "$HOME/.claude-mem/settings.json" 2>/dev/null)}"
PORT="${PORT:-37700}"
URL="http://127.0.0.1:${PORT}/api/import"

curl -sf "http://127.0.0.1:${PORT}/api/stats" >/dev/null \
  || { echo "worker not responding on ${PORT}" >&2; exit 1; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Relink resumed sessions. claude-mem issues a NEW memory_session_id when a session
# resumes, keeping the same content_session_id. The peer publishes the new id; we
# already hold a row with that content_session_id under the OLD one, and
# sdk_sessions is UNIQUE on (platform_source, content_session_id) — so the session
# insert is silently skipped, every summary/observation FK-ing the new id fails,
# and the batch rolls back on every retry, forever. Rewrite incoming ids to ours.
DB="${CLAUDE_MEM_DB:-$HOME/.claude-mem/claude-mem.db}"
if command -v sqlite3 >/dev/null 2>&1 && [ -f "$DB" ]; then
  sqlite3 -noheader -separator "$(printf '\t')" "file:${DB}?mode=ro" \
    'SELECT content_session_id, memory_session_id FROM sdk_sessions
      WHERE memory_session_id IS NOT NULL;' > "$TMP/local.tsv" 2>/dev/null \
    || : > "$TMP/local.tsv"
  if jq --rawfile local "$TMP/local.tsv" '
        ($local | split("\n") | map(select(length > 0) | split("\t"))
                | map({key: .[0], value: .[1]}) | from_entries) as $bycontent
      | ([ .sessions[]
           | select(($bycontent[.content_session_id] // .memory_session_id)
                    != .memory_session_id)
           | {key: .memory_session_id, value: $bycontent[.content_session_id]} ]
         | from_entries) as $ren
      | def relink: map(.memory_session_id |= ($ren[.] // .));
        .sessions |= relink | .summaries |= relink | .observations |= relink
      ' "$FILE" > "$TMP/relinked.json"; then
    n_ren=$(jq -n --slurpfile a "$FILE" --slurpfile b "$TMP/relinked.json" \
      '[$a[0].sessions[].memory_session_id] - [$b[0].sessions[].memory_session_id] | length')
    [ "$n_ren" = "0" ] || echo "relinked ${n_ren} resumed session(s) to local ids"
    FILE="$TMP/relinked.json"
  fi
fi

n_sess=$(jq '.sessions|length'     "$FILE")
n_sums=$(jq '.summaries|length'    "$FILE")
n_obs=$(jq  '.observations|length' "$FILE")
echo "payload: ${n_sess} sessions, ${n_sums} summaries, ${n_obs} observations"

if [ "$DRY" = "1" ]; then
  echo "dry run — nothing sent"
  jq -r '([.summaries[].memory_session_id]-[.sessions[].memory_session_id]|length) as $s
       | ([.observations[].memory_session_id]-[.sessions[].memory_session_id]|length) as $o
       | "FK check — orphan summaries: \($s), orphan observations: \($o)"' "$FILE"
  exit 0
fi

TOTAL_I=0; TOTAL_S=0

post() { # $1 = file holding a full payload object
  local resp code
  resp=$(curl -s -w '\n%{http_code}' -X POST "$URL" -H 'Content-Type: application/json' -d @"$1")
  code=$(printf '%s' "$resp" | tail -1)
  body=$(printf '%s' "$resp" | sed '$d')
  if [ "$code" != "200" ]; then
    echo "  !! HTTP $code: $(printf '%s' "$body" | head -c 300)" >&2
    return 1
  fi
  local i s
  i=$(printf '%s' "$body" | jq '[.stats|to_entries[]|select(.key|endswith("Imported"))|.value]|add')
  s=$(printf '%s' "$body" | jq '[.stats|to_entries[]|select(.key|endswith("Skipped"))|.value]|add')
  TOTAL_I=$((TOTAL_I + i)); TOTAL_S=$((TOTAL_S + s))
  echo "  +${i} imported, ${s} skipped"
}

# Sessions FIRST — every later batch FKs into them. The loop is sequential and
# each chunk is its own committed transaction, so sessions land before anything
# that references them. Sessions carry no FK of their own, so chunking them is safe.
for TABLE in sessions summaries observations; do
  n=$(jq --arg t "$TABLE" '.[$t]|length' "$FILE")
  [ "$n" -gt 0 ] || continue
  echo "${TABLE} (${n}, chunks of ${CHUNK})"
  off=0
  while [ "$off" -lt "$n" ]; do
    jq -c --arg t "$TABLE" --argjson o "$off" --argjson c "$CHUNK" \
      '{sessions:[], summaries:[], observations:[], prompts:[]} + {($t): .[$t][$o:($o+$c)]}' \
      "$FILE" > "$TMP/c.json"
    printf '  [%d-%d]' "$off" $((off + CHUNK > n ? n : off + CHUNK))
    post "$TMP/c.json"
    off=$((off + CHUNK))
  done
done

echo "done: ${TOTAL_I} imported, ${TOTAL_S} skipped"
