#!/usr/bin/env bash
# Export claude-mem rows as a payload for the worker's POST /api/import.
#
# Reads SQLite DIRECTLY and never the worker's read API. Two independent reasons:
#   1. GET /api/search caps out near 200 rows regardless of `limit`, has no
#      wildcard, and no query returns the full set.
#   2. GET /api/summaries renames memory_session_id -> session_id AND substitutes
#      the Claude session id, so its output fails the FK on re-import.
#
# One script serves both phases:
#   Phase 0 (consolidation): --since 0        -> full dump
#   Phase 1 (steady state):  --since <epoch>  -> incremental since watermark
#
# Exports everything. There is no project filter: the one-time consolidation
# concluded DROP NOTHING, and the two flags that existed to shape that decision
# (--exclude, --remap) were removed once it completed. Recover them from git
# history if another salvage ever needs them.
#
# Usage: mem-export.sh [--db PATH] [--since EPOCH_MS] [--out FILE]
set -euo pipefail

DB="${HOME}/.claude-mem/claude-mem.db"
SINCE=0
OUT="-"

while [ $# -gt 0 ]; do
  case "$1" in
    --db)      DB="$2"; shift 2 ;;
    --since)   SINCE="$2"; shift 2 ;;
    --out)     OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -f "$DB" ] || { echo "no such db: $DB" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

URI="file:${DB}?mode=ro"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Results go to files, never to argv. A full Mac dump is ~20MB and passing that
# through `jq --argjson` dies with "Argument list too long" (ARG_MAX).
q() { sqlite3 -json "$URI" "$2" > "$TMP/$1.json"; [ -s "$TMP/$1.json" ] || echo '[]' > "$TMP/$1.json"; }

# Column lists deliberately omit `id` (SQLite assigns a fresh local one) and the
# sync_* / synced_at / origin_* columns (destination-local bookkeeping).
q obs "
SELECT memory_session_id, project, merged_into_project, type, title, subtitle,
       narrative, text, facts, concepts, files_read, files_modified,
       prompt_number, created_at, created_at_epoch
FROM observations
WHERE created_at_epoch > ${SINCE};"

q sums "
SELECT memory_session_id, project, merged_into_project, request, investigated,
       learned, completed, next_steps, notes, files_read, files_edited,
       prompt_number, created_at, created_at_epoch
FROM session_summaries
WHERE created_at_epoch > ${SINCE};"

# Sessions are FK targets for both tables above, and /api/import is transactional
# — ONE missing session rolls back the whole merge.
#
# claude-mem prunes sdk_sessions but keeps the memories: the MacBook has 3820
# observations against only 189 session rows, so 70% are orphans. Exporting just
# the real sessions guarantees a FOREIGN KEY failure on every non-trivial merge.
#
# So: ship the real session row where one survives, and synthesise a placeholder
# from the orphan's own project + earliest timestamp where it does not. The
# alternative is discarding 70% of the history, which defeats the entire salvage.
q sess "
WITH refs AS (
  SELECT memory_session_id msid, project, created_at, created_at_epoch
    FROM observations      WHERE created_at_epoch > ${SINCE}
  UNION ALL
  SELECT memory_session_id msid, project, created_at, created_at_epoch
    FROM session_summaries WHERE created_at_epoch > ${SINCE}
),
orphans AS (
  SELECT msid,
         MIN(project)          project,
         MIN(created_at)       first_at,
         MIN(created_at_epoch) first_epoch
  FROM refs r
  WHERE r.msid IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sdk_sessions k WHERE k.memory_session_id = r.msid)
  GROUP BY msid
)
SELECT content_session_id, memory_session_id, project, platform_source,
       user_prompt, custom_title, started_at, started_at_epoch,
       completed_at, completed_at_epoch, status
FROM sdk_sessions
WHERE memory_session_id IN (SELECT msid FROM refs)
UNION ALL
SELECT 'synthetic-'||msid, msid, project, 'claude',
       NULL, NULL, first_at, first_epoch, first_at, first_epoch, 'completed'
FROM orphans;"

# `!=` not `&&` — under `set -e` a bare `[ x = y ] && ...` that tests false makes
# the whole line non-zero and kills the script.
[ "$OUT" != "-" ] || OUT=/dev/stdout

jq -n --slurpfile sessions "$TMP/sess.json" --slurpfile summaries "$TMP/sums.json" \
      --slurpfile observations "$TMP/obs.json" \
      '{sessions:$sessions[0], summaries:$summaries[0], observations:$observations[0], prompts:[]}' > "$OUT"

[ "$OUT" = /dev/stdout ] || printf 'exported %s sessions, %s summaries, %s observations -> %s\n' \
  "$(jq 'length' "$TMP/sess.json")" \
  "$(jq 'length' "$TMP/sums.json")" \
  "$(jq 'length' "$TMP/obs.json")" "$OUT" >&2
