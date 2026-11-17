#!/bin/sh
# Runs bun test with TMPDIR set to a fresh empty folder, and fails when the run leaves
# anything behind: an entry in that folder, or a live process from the run. A process counts
# as the run's when it is in the run's process group (bun test runs as its own job, and its
# children stay in the group even once orphaned) or when its command line or environment
# names the folder (every child inherits TMPDIR).
# Exits with bun test's own code when the tests fail, 1 when they pass but left something.
# Usage: sh test/leftover-check.sh [bun test arguments]
set -u
cd "$(dirname "$0")/.." || exit 2
base=${TMPDIR:-/tmp}
base=${base%/}
run=$(mktemp -d "$base/threads-check.XXXXXX") || exit 2
run=$(cd "$run" && pwd -P) || exit 2
snap=$(mktemp "$base/threads-check-ps.XXXXXX") || exit 2

# bun test leads a process group of its own (perl's setpgrp, then exec: the same pid), so
# its children, orphaned or not, are found by group below. In the background, so a signal to
# this script runs the trap at once and ends the run's whole group.
TMPDIR=$run perl -e 'setpgrp(0, 0); exec @ARGV or die "exec: $!"' bun test "$@" &
job=$!
trap 'kill -TERM -"$job" 2>/dev/null' INT TERM HUP
wait "$job"
rc=$?
trap - INT TERM HUP

# A process still on its way out gets a moment.
sleep 1
bad=0
left=$(ls -A "$run")
if [ -n "$left" ]; then
  echo "leftover-check: the run left $(printf '%s\n' "$left" | wc -l | tr -d ' ') entries in its temp folder:" >&2
  printf '%s\n' "$left" | head -20 >&2
  bad=1
fi
# The snapshot goes to a file first, so the search below is not in it. With e, ps adds each
# process's environment to its command line (BSD and procps both).
ps axeww -o pid=,command= > "$snap"
pids=$(grep -F "$run" "$snap" | awk '{ print $1 }')
pids="$pids $(ps -A -o pid=,pgid= | awk -v g="$job" '$2 == g { print $1 }')"
pids=$(printf '%s\n' $pids | sort -u)
rm -f "$snap"
if [ -n "$pids" ]; then
  echo "leftover-check: the run left these processes running:" >&2
  # Without e here: the log gets the command lines, not the environments.
  for p in $pids; do ps -ww -o pid=,command= -p "$p" >&2; done
  for p in $pids; do kill -9 "$p" 2>/dev/null; done
  bad=1
fi
rm -rf "$run"
[ "$rc" -ne 0 ] && exit "$rc"
[ "$bad" -ne 0 ] && exit 1
echo "leftover-check: the run left nothing behind"
exit 0
