#!/usr/bin/env bash
# Steady-state claude-mem sync across machines, carried by Syncthing.
#
#   export  — write this machine's new rows to <shared>/<device>.json
#   import  — pull in every OTHER machine's file
#
# Invoked from hooks (see hooks/hooks.json): import on SessionStart, export on Stop.
#
# Invariant that makes Syncthing safe: ONE WRITER PER FILE. This machine only ever
# writes its own <device>.json, so no two machines touch the same file and
# .sync-conflict-* cannot occur. Do not "helpfully" write to a peer's file.
#
# ponytail: append-only. Deletions and title/project edits do NOT propagate; the
# watermark stops already-shipped rows being re-sent, so a delete here survives
# unless the watermark is reset. Upgrade path is the vendor sync-hub (see the
# consolidation runbook) if edit propagation ever actually matters.
#
# NEVER blocks a session: every path exits 0. A broken sync hook that hard-errors
# nags on every single startup — see ~/.claude-mem/CAPTURE_BROKEN for that failure
# mode. Problems go to the log, not to the user's face.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHARED="${CLAUDE_MEM_SYNC_DIR:-$HOME/General/claude-mem-sync}"
STATE="$HOME/.claude-mem"
LOG="$STATE/logs/mem-sync.log"
MARK="$STATE/mem-sync.watermark"

mkdir -p "$SHARED" "$STATE/logs" 2>/dev/null
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG" 2>/dev/null; }
die() { log "ERROR: $*"; exit 0; }   # exit 0 — never block a session

DEVICE="${CLAUDE_MEM_CLOUD_SYNC_DEVICE_NAME:-}"
[ -n "$DEVICE" ] || DEVICE=$(jq -r '.CLAUDE_MEM_CLOUD_SYNC_DEVICE_NAME // empty' "$STATE/settings.json" 2>/dev/null)
[ -n "$DEVICE" ] || DEVICE=$(hostname -s 2>/dev/null | tr ' /' '__')
[ -n "$DEVICE" ] || die "cannot determine device name"

MINE="$SHARED/${DEVICE}.json"

# Daily cold snapshot. The real threat is not sync drift — it is a destructive
# auto-update migration: claude-mem 12.4.3 emptied ALEX-OFFICE outright, and the
# only reason the corpus survived was that other machines held independent copies.
# Date-stamped filename IS the once-a-day guard; no cron, launchd or systemd.
#
# ponytail: local-only and keeps 7. Covers a bad migration, NOT a dead disk —
# point CLAUDE_MEM_SNAPSHOT_DIR at ~/General if off-machine copies ever matter
# (costs ~22MB per machine per day of Syncthing traffic, which is why it doesn't
# by default).
snapshot() {
  local dir snap
  dir="${CLAUDE_MEM_SNAPSHOT_DIR:-$STATE/snapshots}"
  snap="$dir/$DEVICE-$(date +%F).db"
  [ -f "$snap" ] && return 0            # already taken today
  mkdir -p "$dir" 2>/dev/null || return 0
  # .backup, not cp — WAL-mode DB with a live worker; a plain copy can tear.
  if sqlite3 "$STATE/claude-mem.db" ".backup '$snap'" 2>>"$LOG"; then
    log "snapshot: $snap"
  else
    rm -f "$snap"; log "snapshot: FAILED (non-fatal)"; return 0
  fi
  # keep the 7 most recent for this device; never touches Phase 0 artifacts,
  # which live in ~/General/claude-mem-backups, not here.
  ls -t "$dir/$DEVICE"-*.db 2>/dev/null | tail -n +8 | while read -r old; do
    rm -f "$old"
  done
  return 0
}

case "${1:-}" in
  export)
    snapshot
    SINCE=$(cat "$MARK" 2>/dev/null || echo 0)
    case "$SINCE" in ''|*[!0-9]*) SINCE=0 ;; esac
    NOW=$(date +%s000)
    TMP="$MINE.tmp.$$"
    if ! "$HERE/mem-export.sh" --since "$SINCE" --out "$TMP" 2>>"$LOG"; then
      rm -f "$TMP"; die "export failed"
    fi
    N=$(jq '.observations|length' "$TMP" 2>/dev/null || echo 0)
    if [ "$N" -eq 0 ]; then
      rm -f "$TMP"; log "export: nothing new since $SINCE"; exit 0
    fi
    # Merge with what is already published so peers that have not yet synced do
    # not lose rows when the watermark advances past them.
    #
    # ponytail: 90-day retention window. Without it this file only ever grows and
    # every peer re-imports the whole history each time it changes. The ceiling: a
    # peer that stays offline longer than the window misses those rows permanently
    # (its watermark has no say in what WE publish). Widen the window, or move to
    # pruning below the oldest peer's seen-stamp, if a machine ever sits idle that
    # long. Sessions are exempt — they are ~5% of the volume and are FK targets.
    if [ -f "$MINE" ]; then
      jq -s '((now - 7776000) * 1000) as $cut
           | def recent: map(select(.created_at_epoch > $cut));
             {sessions:(.[0].sessions+.[1].sessions|unique_by(.memory_session_id)),
              summaries:(.[0].summaries+.[1].summaries|recent),
              observations:(.[0].observations+.[1].observations|recent),
              prompts:[]}' "$MINE" "$TMP" > "$TMP.merged" 2>>"$LOG" \
        && mv "$TMP.merged" "$TMP"
    fi
    mv -f "$TMP" "$MINE" || die "could not publish $MINE"
    printf '%s' "$NOW" > "$MARK"
    log "export: published $N new observations as $DEVICE"
    ;;

  import)
    shopt -s nullglob
    for PEER in "$SHARED"/*.json; do
      [ "$PEER" = "$MINE" ] && continue   # never import our own
      SEEN="$STATE/mem-sync.seen.$(basename "$PEER" .json)"
      STAMP=$(stat -c %Y "$PEER" 2>/dev/null || stat -f %m "$PEER" 2>/dev/null || echo 0)
      [ "$STAMP" = "$(cat "$SEEN" 2>/dev/null || echo)" ] && continue  # unchanged
      if "$HERE/mem-import.sh" "$PEER" >>"$LOG" 2>&1; then
        printf '%s' "$STAMP" > "$SEEN"
        log "import: applied $(basename "$PEER")"
      else
        log "import: FAILED $(basename "$PEER") — will retry next session"
      fi
    done
    ;;

  *) echo "usage: mem-sync.sh export|import" >&2; exit 2 ;;
esac
exit 0
