# shellcheck shell=sh disable=SC2034,SC2154
# (threads_core comes from the script that sources this, and lines_note goes back to it.)
# agent-threads: sourced by extract.sh, calls.sh and locate.sh, after they set threads_core to
# this folder. lines is a filter that writes each line of its input as one JSON string, for
# jq to read as JSON (never with -R, whose 4 KB pieces split a character that crosses one).
# perl's lines.pl keeps every character whole. Without perl, jq's raw read is the one stand-in
# (broken characters are better than no chat), and lines_note marks extract.sh's chunk line so
# the pane's debug report can say so.
# whole <file> <from> and line_end <file> <from> say where lines end, as ends.pl does. Without
# perl they use tail and head, which are right on macOS and with GNU coreutils.
if command -v perl > /dev/null 2>&1; then
  lines() { perl "$threads_core/lines.pl"; }
  whole() { perl "$threads_core/ends.pl" whole "$1" "$2"; }
  line_end() { perl "$threads_core/ends.pl" next "$1" "$2"; }
  lines_note=
else
  lines() { jq -R .; }
  whole() {
    n=$(wc -c < "$1" | tr -d ' ')
    if [ "$n" -gt "$2" ] && [ "$(tail -c 1 "$1" | od -An -c | tr -d ' ')" != '\n' ]; then
      n=$((n - $(tail -n 1 "$1" | wc -c | tr -d ' ')))
    fi
    [ "$n" -ge "$2" ] || n=$2
    echo "$n"
  }
  line_end() {
    n=$(wc -c < "$1" | tr -d ' ')
    e=$(($2 + $(tail -c +$(($2 + 1)) "$1" | head -n 1 | wc -c | tr -d ' ')))
    if [ "$e" -le "$2" ] || { [ "$e" -ge "$n" ] && [ "$(tail -c 1 "$1" | od -An -c | tr -d ' ')" != '\n' ]; }; then e=-1; fi
    echo "$e"
  }
  lines_note=',"noperl":true'
fi
