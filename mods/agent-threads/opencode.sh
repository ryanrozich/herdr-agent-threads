#!/bin/sh
# agent-threads: read-only lookups in OpenCode's SQLite database (sqlite3 -readonly only).
#   opencode.sh db                                  the database's path, if there is one
#   opencode.sh sessions <db> <folder>...           a folder's root sessions, newest update first:
#                                                   {"id","created","updated","title","first"}, 20 at most
#                                                   2.x rows also carry "busy", when its last turn began
#   opencode.sh peers <pid> <folder>                how many other opencode terminals run there
#   opencode.sh read <db> <session> <turn> <max>    extractor events, as extract.sh prints them
# OpenCode 2.x keeps sessions in session_v2 and session_message, and 1.x in session, message and
# part. The tables decide which: 2.x copies 1.x sessions into its own tables and stops writing
# the old ones. 1.19 already has an empty session_message, so it takes both.
# read works in turns, not bytes: <turn> is how many of the session's prompts are settled, and
# <max> is how many it may read, cut down when the output would pass 6 MiB. OpenCode rewrites a
# running turn in place, so a read also returns the turns after the last finished one, each
# time, and "rewind":true tells the pane to drop what it had of them. A {"k":"settle"} event
# follows the finished turns.
set -eu
cmd=${1:-}
[ $# -gt 0 ] && shift

q() { sqlite3 -readonly -batch -noheader -cmd ".timeout 3000" "$@"; }
# A folder or id inside an SQL string.
sql_str() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }
# Whether a database has OpenCode 2.x's tables.
v2() { [ "$(q "$1" "select count(*) from sqlite_master where type='table' and name in ('session_v2','session_message');")" = 2 ]; }

case "$cmd" in
db)
  db="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/opencode.db"
  [ -f "$db" ] || exit 1
  printf '%s\n' "$db" ;;
sessions)
  db=$1
  shift
  dirs=""
  for d in "$@"; do dirs="$dirs${dirs:+,}$(sql_str "$d")"; done
  if v2 "$db"; then
    q "$db" "select json_object('id', id, 'created', time_created, 'updated', time_updated, 'busy', time_busy, 'title', title,
        'first', (select substr(json_extract(m.data,'\$.text'), 1, 100) from session_message m
          where m.session_id = s.id and m.type = 'user' order by m.seq limit 1))
      from session_v2 s where directory in ($dirs) and parent_id is null and time_archived is null
      order by time_updated desc limit 20;"
    exit 0
  fi
  q "$db" "select json_object('id', id, 'created', time_created, 'updated', time_updated, 'title', title,
      'first', (select substr(json_extract(p.data,'\$.text'), 1, 100) from part p join message m on m.id = p.message_id
        where p.session_id = session.id and json_extract(m.data,'\$.role') = 'user' and json_extract(p.data,'\$.type') = 'text'
          and coalesce(json_extract(p.data,'\$.synthetic'), 0) = 0 order by m.time_created, p.id limit 1))
    from session where directory in ($dirs) and parent_id is null and time_archived is null
    order by time_updated desc limit 20;" ;;
peers)
  n=0
  for p in $(pgrep -x opencode 2>/dev/null || true); do
    [ "$p" = "$1" ] && continue
    # OpenCode 2.x terminals share one background "opencode serve", which is not a terminal.
    case " $(ps -o args= -p "$p" 2>/dev/null) " in *" serve "*) continue ;; esac
    [ "$(lsof -a -d cwd -p "$p" -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)" = "$2" ] && n=$((n + 1))
  done
  printf '%s\n' "$n" ;;
read)
  db=$1 sid=$2 off=$3 max=$4
  case $sid in "" | *[!0-9A-Za-z_-]*) echo "bad session id" >&2; exit 2 ;; esac
  case $off$max in "" | *[!0-9]*) echo "bad offset" >&2; exit 2 ;; esac
  [ -f "$db" ] || { echo '{"k":"missing"}'; exit 0; }
  prev=0
  [ "$off" -eq 0 ] || prev=$((off - 1))
  # anchor: the last settled prompt. An undone turn can be replaced without changing the count.
  sql=opencode-read.sql
  if v2 "$db"; then
    sql=opencode-read-v2.sql
    q "$db" "select json_object('k', 'file', 'size', count(*), 'head', coalesce(min(id), ''),
        'anchor', (select id from session_message where session_id='$sid' and type in ('user','compaction')
          order by seq limit 1 offset $prev))
      from session_message where session_id='$sid' and type in ('user','compaction');"
  else
    q "$db" "select json_object('k', 'file', 'size', count(*), 'head', coalesce(min(id), ''),
        'anchor', (select id from message where session_id='$sid' and json_extract(data,'\$.role')='user'
          order by time_created, id limit 1 offset $prev))
      from message where session_id='$sid' and json_extract(data,'\$.role')='user';"
  fi
  win=$max
  [ "$win" -gt 40 ] && win=40
  here=$(dirname "$0")
  while :; do
    ev=$(sqlite3 -readonly -batch -noheader -cmd ".timeout 3000" -cmd ".parameter set :sid '$sid'" \
      -cmd ".parameter set :off $off" -cmd ".parameter set :win $win" "$db" < "$here/$sql")
    [ "${#ev}" -gt 6291456 ] && [ "$win" -gt 1 ] || break
    win=$((win / 2))
  done
  printf '%s\n' "$ev" ;;
*)
  echo "usage: opencode.sh db|sessions|peers|read ..." >&2
  exit 2 ;;
esac
