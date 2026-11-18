#!/bin/sh
# Runs bun test with TMPDIR set to a fresh empty folder, and fails when the run leaves
# anything behind: an entry in that folder, or a live process from the run. A process counts
# as the run's when it is in the run's process group (bun test runs as its own job, and its
# children stay in the group even once orphaned), when its command line or environment names
# the folder (every child inherits TMPDIR), or on macOS when its working folder is in it.
# Exits with bun test's own code when the tests fail, 1 when they pass but left something.
# Usage: sh test/leftover-check.sh [bun test arguments]
set -u
cd "$(dirname "$0")/.." || exit 2
base=${TMPDIR:-/tmp}
base=${base%/}
run=$(mktemp -d "$base/threads-check.XXXXXX") || exit 2
run=$(cd "$run" && pwd -P) || exit 2
snap=$(mktemp "$base/threads-check-ps.XXXXXX") || exit 2
ids=$(mktemp "$base/threads-check-ids.XXXXXX") || exit 2
cut=$(mktemp "$base/threads-check-cut.XXXXXX") || exit 2
# A command with a 5 s limit (perl's alarm outlives the exec; macOS has no timeout).
limit() { perl -e 'alarm 5; exec @ARGV or die "exec: $!"' "$@"; }
# A search cut off by the limit (SIGALRM: 142) saw only part of the processes: noted in
# $cut, and the check fails.
cutoff() { [ "$1" -eq 142 ] && echo x >> "$cut"; return 0; }

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

# The run's processes still alive: in its process group; or with the folder in their command
# line or environment (with e, ps adds the environment; BSD and procps both); or, on macOS,
# where ps does not show a system binary's environment, with their working folder in it (one
# lsof over this user's processes, cwd only: under a second). A zombie is dead (a parent that
# does not reap it, such as a container's pid 1, keeps it listed) and does not count. The
# snapshots go to files first, so the searches below (whose command lines hold the folder)
# are not in them.
alive() {
  LC_ALL=C limit ps -A -o pid=,ppid=,pgid=,stat=,lstart= > "$ids"
  cutoff $?
  limit ps axeww -o pid=,command= > "$snap"
  cutoff $?
  {
    grep -F "$run" "$snap" | awk '{ print $1 }'
    awk -v g="$job" '$3 == g { print $1 }' "$ids"
    if [ "$(uname)" = Darwin ] && command -v lsof > /dev/null; then
      limit lsof -n -w -a -d cwd -u "$(id -u)" -Fpn > "$snap" 2> /dev/null
      cutoff $?
      awk -v r="$run" '/^p/ { pid = substr($0, 2) } /^n/ && index($0, r) { print pid }' "$snap"
    fi
  } | sort -u | awk 'FILENAME == ARGV[1] { if ($4 ~ /^Z/) z[$1] = 1; next } !($1 in z)' "$ids" -
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
  # Without e here: the log gets the command lines, not the environments.
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
rm -f "$snap" "$ids" "$cut"
rm -rf "$run"
[ "$rc" -ne 0 ] && exit "$rc"
[ "$bad" -ne 0 ] && exit 1
echo "leftover-check: the run left nothing behind"
exit 0
