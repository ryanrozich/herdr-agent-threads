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
# A command with a 5 s limit (perl's alarm outlives the exec; macOS has no timeout).
limit() { perl -e 'alarm 5; exec @ARGV or die "exec: $!"' "$@"; }

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
# lsof over this user's processes, cwd only: under a second). The snapshots go to files
# first, so the searches below (whose command lines hold the folder) are not in them.
alive() {
  limit ps axeww -o pid=,command= > "$snap"
  {
    grep -F "$run" "$snap" | awk '{ print $1 }'
    limit ps -A -o pid=,pgid= | awk -v g="$job" '$2 == g { print $1 }'
    if [ "$(uname)" = Darwin ] && command -v lsof > /dev/null; then
      limit lsof -n -w -a -d cwd -u "$(id -u)" -Fpn > "$snap" 2> /dev/null
      awk -v r="$run" '/^p/ { pid = substr($0, 2) } /^n/ && index($0, r) { print pid }' "$snap"
    fi
  } | sort -u
}

# A process on its way out gets up to 10 s (a slow CI runner) before it counts as left.
pids=$(alive)
i=0
while [ -n "$pids" ] && [ "$i" -lt 10 ]; do
  sleep 1
  i=$((i + 1))
  pids=$(alive)
done
# Each one's parent and start time now, checked again before it is killed.
for p in $pids; do echo "$p $(LC_ALL=C limit ps -o ppid=,lstart= -p "$p")"; done > "$snap"

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
  # Each one is killed only if its parent and start time are still the ones found above.
  for p in $pids; do
    was=$(awk -v p="$p" '$1 == p { $1 = ""; print }' "$snap" | xargs)
    now=$(LC_ALL=C limit ps -o ppid=,lstart= -p "$p" | xargs)
    [ -n "$was" ] && [ "$now" = "$was" ] && kill -9 "$p" 2>/dev/null
  done
  bad=1
fi
rm -f "$snap"
rm -rf "$run"
[ "$rc" -ne 0 ] && exit "$rc"
[ "$bad" -ne 0 ] && exit 1
echo "leftover-check: the run left nothing behind"
exit 0
