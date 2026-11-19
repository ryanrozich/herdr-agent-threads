# shellcheck shell=sh disable=SC2034,SC2154
# (threads_core comes from the script that sources this, and lines_note goes back to it.)
# agent-threads: sourced by extract.sh, calls.sh and locate.sh, after they set threads_core to
# this folder. lines is a filter that writes each line of its input as one JSON string, for
# jq to read as JSON (never with -R, whose 4 KB pieces split a character that crosses one).
# perl's lines.pl keeps every character whole. Without perl, jq's raw read is the one stand-in
# (broken characters are better than no chat), and lines_note marks extract.sh's chunk line so
# the pane's debug report can say so.
if command -v perl > /dev/null 2>&1; then
  lines() { perl "$threads_core/lines.pl"; }
  lines_note=
else
  lines() { jq -R .; }
  lines_note=',"noperl":true'
fi
