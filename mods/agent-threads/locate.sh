#!/bin/sh
# agent-threads: read-only lookups for finding a terminal's Claude Code transcript.
#   locate.sh find <claude-home> <id>                the transcript for a session id (real path)
#   locate.sh folder <projects> <slug> [cwd-json]    the project folder for a working directory
#                                                    (with cwd-json, also scans for a folder
#                                                    whose newest transcript ran there)
#   locate.sh list <folder>                          "<mtime> <bytes> <path>", newest first, 20 at most
#   locate.sh names <folder>                         every transcript path in the folder
#   locate.sh held <claude-home> [own-pid]           session ids other live claude processes record
# Exits 1 when nothing is found. Reads only; writes nothing.
set -u
cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
find)
  for f in "$1"/projects/*/"$2".jsonl; do
    [ -f "$f" ] || continue
    d=$(cd -P "$(dirname "$f")" && pwd -P) && printf '%s/%s.jsonl\n' "$d" "$2" && exit 0
  done
  exit 1 ;;
folder)
  if cd -P "$1/$2" 2>/dev/null; then pwd -P; exit 0; fi
  [ -n "${3:-}" ] || exit 1
  # Another Claude Code version may name the folder differently: use the folder whose newest
  # transcript was written in this working directory.
  want="\"cwd\":\"$3\""
  for d in "$1"/*/; do
    f=$(cd "$d" 2>/dev/null && ls -t -- *.jsonl 2>/dev/null | head -n 1)
    [ -n "$f" ] || continue
    if head -c 65536 "$d$f" | LC_ALL=C grep -m 1 -o '"cwd":"[^"]*"' | head -n 1 | grep -qxF "$want"; then
      cd -P "$d" && pwd -P && exit 0
    fi
  done
  exit 1 ;;
list)
  cd -P "$1" 2>/dev/null || exit 1
  d=$(pwd -P)
  ls -t -- *.jsonl 2>/dev/null | head -n 20 | while IFS= read -r f; do
    printf '%s %s %s/%s\n' "$(date -r "$f" +%s)" "$(wc -c < "$f" | tr -d ' ')" "$d" "$f"
  done ;;
names)
  cd -P "$1" 2>/dev/null || exit 1
  d=$(pwd -P)
  for f in *.jsonl; do [ -f "$f" ] && printf '%s/%s\n' "$d" "$f"; done
  exit 0 ;;
held)
  own=${2:-}
  for f in "$1"/sessions/*.json; do
    [ -f "$f" ] || continue
    pid=$(basename "$f" .json)
    [ "$pid" = "$own" ] && continue
    ps -p "$pid" >/dev/null 2>&1 || continue
    jq -r '.sessionId // empty' "$f" 2>/dev/null
  done
  exit 0 ;;
*)
  echo "usage: locate.sh find|folder|list|names|held ..." >&2
  exit 2 ;;
esac
