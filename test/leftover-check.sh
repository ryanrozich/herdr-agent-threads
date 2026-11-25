#!/bin/sh
# Runs bun test with TMPDIR set to a fresh empty folder, and fails when the run leaves
# anything behind: an entry in that folder, or a live process from the run. A process counts
# as the run's when it is in the run's process group (bun test runs as its own job, and its
# children stay in the group even once orphaned), or, for one started since the run began, when
# its command line names the folder or its working folder is in it. No process's environment
# is asked for, and no other process's command line is put in a file. A process that left the
# group (setsid, setpgrp), runs in another folder and does not name the folder in its command
# line is not found, even though it carries TMPDIR.
# Exits with bun test's own code when the tests fail, 1 when they pass but left something.
# Usage: sh test/leftover-check.sh [bun test arguments]
set -u
cd "$(dirname "$0")/.." || exit 2
base=${TMPDIR:-/tmp}
base=${base%/}
run=$(mktemp -d "$base/threads-check.XXXXXX") || exit 2
run=$(cd "$run" && pwd -P) || exit 2
old=$(mktemp "$base/threads-check-old.XXXXXX") || exit 2
ids=$(mktemp "$base/threads-check-ids.XXXXXX") || exit 2
cut=$(mktemp "$base/threads-check-cut.XXXXXX") || exit 2
# A command with a 5 s limit (perl's alarm outlives the exec; macOS has no timeout).
limit() { perl -e 'alarm 5; exec @ARGV or die "exec: $!"' "$@"; }
# A search cut off by the limit (SIGALRM: 142) saw only part of the processes: noted in
# $cut, and the check fails.
cutoff() { [ "$1" -eq 142 ] && echo x >> "$cut"; return 0; }

# Every process as pid, parent, group, state and start time; no command line.
table() { LC_ALL=C limit ps -A -o pid=,ppid=,pgid=,stat=,lstart=; }

# What ran before the run began. A process missing from it (its start time moved by a second,
# or the list was cut off) is taken for a new one, and asked about too.
table > "$old"

# bun test leads a process group of its own (perl's setpgrp, then exec: the same pid), so
# its children, orphaned or not, are found by group below. In the background, so a signal to
# this script runs the trap at once and ends the run's whole group.
TMPDIR=$run perl -e 'setpgrp(0, 0); exec @ARGV or die "exec: $!"' bun test "$@" &
job=$!
# Before perl's setpgrp there is no group yet: then the signal goes to the pid.
trap 'kill -TERM -"$job" 2>/dev/null || kill -TERM "$job" 2>/dev/null' INT TERM HUP
wait "$job"
rc=$?
trap - INT TERM HUP

# The run's processes still alive: in its process group; or, of those started since the run
# began, with the folder in their command line, or with their working folder in it (one lsof,
# cwd only, or the links in /proc on Linux). A zombie is dead (a parent that does not reap it,
# such as a container's pid 1, keeps it listed) and does not count. The table goes to a file
# first, so the searches below are not in it; command lines and folders go only through pipes,
# and the folder reaches awk in its environment, so no search has it in its own command line.
alive() {
  table > "$ids"
  cutoff $?
  new=$(awk '
    { key = $1 " " $5 " " $6 " " $7 " " $8 " " $9 }
    FILENAME == ARGV[1] { was[key] = 1; next }
    !(key in was) { list = list (list == "" ? "" : ",") $1 }
    END { print list }' "$old" "$ids")
  {
    awk -v g="$job" '$3 == g { print $1 }' "$ids"
    if [ -n "$new" ]; then
      { limit ps -ww -o pid=,args= -p "$new"; cutoff $?; } |
        R=$run awk 'index($0, ENVIRON["R"]) { print $1 }'
      # The folder, one under it, or on Linux the folder when it is gone; never one whose name
      # only begins the same.
      folders "$new" | R=n$run awk '
        BEGIN { r = ENVIRON["R"] }
        /^p/ { pid = substr($0, 2) }
        $0 == r || index($0, r "/") == 1 || $0 == (r " (deleted)") { print pid }'
    fi
  } | sort -u | awk 'FILENAME == ARGV[1] { if ($4 ~ /^Z/) z[$1] = 1; next } !($1 in z)' "$ids" -
}

# The working folder of each process in a comma list, as lsof writes it: p<pid>, then n<folder>.
folders() {
  case $(uname) in
    Darwin)
      command -v lsof > /dev/null || return 0
      limit lsof -n -w -a -d cwd -p "$1" -Fpn 2> /dev/null
      cutoff $?
      ;;
    Linux)
      for p in $(echo "$1" | tr , ' '); do
        printf 'p%s\nn%s\n' "$p" "$(readlink "/proc/$p/cwd" 2> /dev/null)"
      done
      ;;
  esac
}

# A process on its way out gets up to 10 s (a slow CI runner) before it counts as left. Each
# pass keeps, in $ids, every process's parent and start time from the same moment as the list.
pids=$(alive)
i=0
while [ -n "$pids" ] && [ "$i" -lt 10 ]; do
  sleep 1
  i=$((i + 1))
  pids=$(alive)
done

bad=0
left=$(ls -A "$run")
if [ -n "$left" ]; then
  echo "leftover-check: the run left $(printf '%s\n' "$left" | wc -l | tr -d ' ') entries in its temp folder:" >&2
  printf '%s\n' "$left" | head -20 >&2
  bad=1
fi
if [ -n "$pids" ]; then
  echo "leftover-check: the run left these processes running:" >&2
  # Only their command lines go to the log.
  for p in $pids; do limit ps -ww -o pid=,command= -p "$p" >&2; done
  # Each one is killed only if its parent and start time are still the ones found with it.
  for p in $pids; do
    was=$(awk -v p="$p" '$1 == p { $1 = ""; $3 = ""; $4 = ""; print }' "$ids" | xargs)
    now=$(LC_ALL=C limit ps -o ppid=,lstart= -p "$p" | xargs)
    [ -n "$was" ] && [ "$now" = "$was" ] && kill -9 "$p" 2>/dev/null
  done
  bad=1
fi
if [ -s "$cut" ]; then
  echo "leftover-check: a process search ran out of time; the check cannot say nothing was left" >&2
  bad=1
fi
rm -f "$old" "$ids" "$cut"
rm -rf "$run"
[ "$rc" -ne 0 ] && exit "$rc"
[ "$bad" -ne 0 ] && exit 1
echo "leftover-check: the run left nothing behind"
exit 0
