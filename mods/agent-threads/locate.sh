#!/bin/sh
# agent-threads: read-only lookups for finding a terminal's Claude Code, Codex, Pi or Cursor transcript.
#   locate.sh find <claude-home> <id>                the transcript for a session id (real path)
#   locate.sh folder <projects> <slug> [cwd-json]    the project folder for a working directory
#                                                    (with cwd-json, also scans for a folder
#                                                    whose newest transcript ran there)
#   locate.sh list <folder>                          "<mtime> <bytes> <path>", newest first, 20 at most
#   locate.sh names <folder>                         every transcript path in the folder
#   locate.sh held <claude-home> [own-pid]           session ids other live claude processes record
#   locate.sh codex-dir                              the folder Codex keeps its sessions in
#   locate.sh codex-open <pid>                       the session file a Codex process has open
#   locate.sh codex-find <id>                        the session file for a Codex session id
#   locate.sh pi-dir                                 the folder Pi keeps its sessions in
#   locate.sh pi-peers <pid> <folder>                how many other pi processes run there
#   locate.sh pi-label <file>                        a Pi session's name, else its first prompt
#   locate.sh cursor-dir                             the folder Cursor keeps its data in
#   locate.sh cursor-open <pid>                      the chat store a Cursor process has open
#   locate.sh cursor-find <data> <id>                the transcript for a Cursor chat id
#   locate.sh cursor-list <folder>                   a project's transcripts, as list prints them
#   locate.sh cursor-peers <pid> <folder>            how many other Cursor processes run there
#   locate.sh cursor-label <file>                    a Cursor chat's first prompt
#   locate.sh etime <pid>                            how long a process has run (ps -o etime)
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
codex-dir)
  printf '%s\n' "${CODEX_HOME:-$HOME/.codex}/sessions" ;;
codex-open)
  # A process keeps its session file open, and its subagents' too, so the newest file whose
  # first line does not mark it a subagent is the terminal's. A launcher runs the real program
  # as a child.
  pids="$1 $(pgrep -P "$1" 2>/dev/null | tr '\n' ' ')"
  # shellcheck disable=SC2086 # the pids are meant to split
  files=$(for p in $pids; do lsof -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p' | grep -E '/rollout-[^/]*\.jsonl$' || true; done | sort -u)
  [ -n "$files" ] || exit 1
  printf '%s\n' "$files" | while IFS= read -r f; do
    [ -f "$f" ] && printf '%s %s\n' "$(date -r "$f" +%s)" "$f"
  done | sort -rn | cut -d ' ' -f 2- | while IFS= read -r f; do
    if ! head -c 65536 "$f" | head -n 1 | LC_ALL=C grep -q '"source":{"subagent"'; then printf '%s\n' "$f"; exit 0; fi
  done
  exit 0 ;;
codex-find)
  f=$(find "${CODEX_HOME:-$HOME/.codex}/sessions" -type f -name "rollout-*-$1.jsonl" 2>/dev/null | head -n 1)
  [ -n "$f" ] || exit 1
  printf '%s\n' "$f" ;;
pi-dir)
  printf '%s\n' "${PI_CODING_AGENT_SESSION_DIR:-${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/sessions}" ;;
pi-peers)
  # Pi runs under node and names its process "pi".
  n=0
  for p in $(pgrep -x pi 2>/dev/null || true); do
    [ "$p" = "$1" ] && continue
    [ "$(lsof -a -d cwd -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)" = "$2" ] && n=$((n + 1))
  done
  printf '%s\n' "$n" ;;
pi-label)
  # /name writes a session_info line; the last one wins. Else the first prompt, 100 characters.
  name=$(LC_ALL=C grep -F '"type":"session_info"' "$1" 2>/dev/null | tail -n 1 | jq -r '.name // empty' 2>/dev/null)
  if [ -n "$name" ]; then printf '%s\n' "$name"; exit 0; fi
  LC_ALL=C grep -m 1 -F '"role":"user"' "$1" 2>/dev/null \
    | jq -r '.message.content | if type == "string" then . else ([.[]? | select(.type == "text") | .text] | join(" ")) end | .[0:100]' 2>/dev/null ;;
cursor-dir)
  printf '%s\n' "${CURSOR_DATA_DIR:-$HOME/.cursor}" ;;
cursor-open)
  # A Cursor process keeps its chat's store.db open (<data>/chats/<folder hash>/<chat id>/), so
  # the path names the chat. Only the path is read, never the database. After a new chat the
  # newest store wins. A launcher runs the real program as a child.
  pids="$1 $(pgrep -P "$1" 2>/dev/null | tr '\n' ' ')"
  # shellcheck disable=SC2086 # the pids are meant to split
  files=$(for p in $pids; do lsof -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p' | grep -E '/chats/[^/]+/[^/]+/store\.db$' || true; done | sort -u)
  [ -n "$files" ] || exit 1
  printf '%s\n' "$files" | while IFS= read -r f; do
    [ -f "$f" ] || continue
    t=$(date -r "$f" +%s)
    [ -f "$f-wal" ] && w=$(date -r "$f-wal" +%s) && [ "$w" -gt "$t" ] && t=$w
    printf '%s %s\n' "$t" "$f"
  done | sort -rn | head -n 1 | cut -d ' ' -f 2- ;;
cursor-find)
  for f in "$1"/projects/*/agent-transcripts/"$2"/"$2".jsonl; do
    [ -f "$f" ] && printf '%s\n' "$f" && exit 0
  done
  exit 1 ;;
cursor-list)
  # Each chat is <folder>/<id>/<id>.jsonl.
  cd -P "$1" 2>/dev/null || exit 1
  d=$(pwd -P)
  for c in */; do
    f="${c%/}/${c%/}.jsonl"
    [ -f "$f" ] && printf '%s %s %s/%s\n' "$(date -r "$f" +%s)" "$(wc -c < "$f" | tr -d ' ')" "$d" "$f"
  done | sort -rn | head -n 20 ;;
cursor-peers)
  # Cursor runs under node; its script path names it.
  n=0
  for p in $(pgrep -f '/cursor-agent/versions/' 2>/dev/null || true); do
    [ "$p" = "$1" ] && continue
    [ "$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')" = "$1" ] && continue
    [ "$(lsof -a -d cwd -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)" = "$2" ] && n=$((n + 1))
  done
  printf '%s\n' "$n" ;;
cursor-label)
  # The first prompt as typed, 100 characters, read as the pane reads it.
  LC_ALL=C grep -m 1 -F '"role":"user"' "$1" 2>/dev/null \
    | jq -Rc -f "$(dirname "$0")/extract-cursor.jq" 2>/dev/null \
    | jq -r 'select(.k == "p") | .t | gsub("\\s+"; " ") | .[0:100]' 2>/dev/null ;;
etime)
  ps -o etime= -p "$1" 2>/dev/null ;;
*)
  echo "usage: locate.sh find|folder|list|names|held|codex-dir|codex-open|codex-find|pi-dir|pi-peers|pi-label|cursor-dir|cursor-open|cursor-find|cursor-list|cursor-peers|cursor-label|etime ..." >&2
  exit 2 ;;
esac
