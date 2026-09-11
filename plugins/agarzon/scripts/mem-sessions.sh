#!/usr/bin/env bash
# Share Claude Code transcripts across machines, so a session started on one
# machine is `claude --resume`-able on another. Rides the Syncthing dir that
# already carries the claude-mem exports — no daemon, no server, no API key.
#
# claude-mem syncs distilled observations; this syncs the resumable transcript.
#
# One writer per file, same invariant as mem-sync.sh: every machine writes only
# its own $SHARED/<device>/ subtree, and filenames are session UUIDs, so two
# machines can never name the same file. Peer transcripts are recorded in
# $STATE/sessions.imported/ and never re-published, which is what stops a
# resumed peer session from acquiring a second writer.
#
# Paths are rewritten on import: a peer's $HOME differs from ours, so its slug
# directory AND every absolute path inside the transcript (cwd, file-history
# records, tool output) are translated. The peer publishes its own $HOME in a
# .home marker rather than us guessing it from the slug.
#
# Usage: mem-sessions.sh publish|import|status
set -euo pipefail

SHARED="${CLAUDE_SESSIONS_SYNC_DIR:-$HOME/General/claude-sessions}"
PROJECTS="${CLAUDE_PROJECTS_DIR:-$HOME/.claude/projects}"
STATE="${CLAUDE_MEM_STATE_DIR:-$HOME/.claude-mem}"
DEVICE="${CLAUDE_MEM_CLOUD_SYNC_DEVICE_NAME:-$(hostname -s)}"
DAYS="${CLAUDE_SESSIONS_RETENTION_DAYS:-30}"
LOG="$STATE/logs/mem-sessions.log"
MINE="$SHARED/$DEVICE"
IMPORTED="$STATE/sessions.imported"

mkdir -p "$STATE/logs" "$IMPORTED"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$1" >>"$LOG"; }
slug() { printf '%s' "$1" | sed 's|[\\/]|-|g; s|[^A-Za-z0-9._-]|-|g'; }

case "${1:-}" in
  publish)
    mkdir -p "$MINE"
    printf '%s' "$HOME" >"$MINE/.home"
    n=0
    while IFS= read -r rel; do
      # Slug dirs start with "-", so basename/dirname would read them as options.
      case "$rel" in */*) ;; *) continue ;; esac
      [ -e "$IMPORTED/${rel##*/}" ] && continue
      [ -f "$MINE/$rel" ] && [ ! "$PROJECTS/$rel" -nt "$MINE/$rel" ] && continue
      mkdir -p "$MINE/${rel%/*}"
      cp -p "$PROJECTS/$rel" "$MINE/$rel"
      n=$((n + 1))
    done < <(cd "$PROJECTS" && find . -name '*.jsonl' -mtime -"$DAYS" | sed 's|^\./||')

    # ponytail: retention mirrors mem-sync.sh — without it the share only grows
    # (138MB of local transcripts today). Ceiling: a machine offline longer than
    # the window loses those sessions. Widen DAYS if that bites.
    find "$MINE" -name '*.jsonl' -mtime +"$DAYS" -delete 2>/dev/null || true
    find "$MINE" -type d -empty -delete 2>/dev/null || true
    log "publish: $n transcript(s) as $DEVICE"
    echo "published $n transcript(s) to $MINE"
    ;;

  import)
    LSLUG=$(slug "$HOME")
    total=0
    for PEER in "$SHARED"/*/; do
      D=$(basename "$PEER")
      [ "$D" = "$DEVICE" ] && continue
      PHOME=$(cat "$PEER/.home" 2>/dev/null || echo)
      [ -n "$PHOME" ] || { log "import: $D has no .home marker, skipped"; continue; }
      PSLUG=$(slug "$PHOME")
      n=0
      while IFS= read -r rel; do
        case "$rel" in */*) ;; *) continue ;; esac
        src="$PEER$rel"; base=${rel##*/}; dir=${rel%/*}
        out="$PROJECTS/${dir/#$PSLUG/$LSLUG}/$base"
        # Never clobber a locally-newer transcript — a forked resume is ours now.
        [ -f "$out" ] && [ ! "$src" -nt "$out" ] && continue
        mkdir -p "${out%/*}"
        sed "s|$PHOME|$HOME|g" "$src" >"$out.part" && mv -f "$out.part" "$out"
        touch "$IMPORTED/$base"
        n=$((n + 1))
      done < <(cd "$PEER" && find . -name '*.jsonl' | sed 's|^\./||')
      total=$((total + n))
      [ "$n" -gt 0 ] && log "import: $n transcript(s) from $D"
    done
    echo "imported $total transcript(s)"
    ;;

  status)
    printf 'shared dir : %s\n' "$SHARED"
    printf 'this device: %s\n' "$DEVICE"
    for PEER in "$SHARED"/*/; do
      [ -d "$PEER" ] || continue
      printf '  %-14s %4s transcripts  home=%s\n' "$(basename "$PEER")" \
        "$(find "$PEER" -name '*.jsonl' | wc -l | tr -d ' ')" \
        "$(cat "$PEER/.home" 2>/dev/null || echo '?')"
    done
    printf 'imported   : %s tracked\n' "$(find "$IMPORTED" -type f | wc -l | tr -d ' ')"
    ;;

  *) echo "usage: mem-sessions.sh publish|import|status" >&2; exit 2 ;;
esac
exit 0
