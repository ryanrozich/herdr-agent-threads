#!/bin/sh
# agent-threads: one step group's tool calls, read from the transcript when the group opens.
# Usage: calls.sh [--tail] <transcript> <harness> <call id>...
# Prints one JSON line per part found, by call id: {"id","k":"in","ts","in"} for the call (its
# command, file, pattern or query, at most 400 characters) and {"id","k":"out","ts","err",
# "out","lines"} for its result (at most 24 KB of text, and its whole line count). The panel
# keeps these in memory only: nothing is written here, and nothing is saved.
# --tail reads only the transcript's last 4 MB, for the newest call of a group still running.
# Claude Code: the tool_use and tool_result blocks with these ids.
set -eu
tail=
if [ "${1:-}" = --tail ]; then tail=1; shift; fi
[ $# -ge 2 ] || { echo "usage: calls.sh [--tail] transcript harness call-id..." >&2; exit 2; }
file=$1
harness=$2
shift 2
[ $# -gt 0 ] || exit 0
for id in "$@"; do
  case $id in "" | *[!0-9A-Za-z_-]*) echo "bad call id" >&2; exit 2 ;; esac
done
case $file in /*) ;; *) file=./$file ;; esac
[ -f "$file" ] || { echo "no transcript" >&2; exit 3; }
ids=$(printf '%s ' "$@")
case $harness in
  claude)
    # One pass over the file for every id, then the blocks that carry them, on the
    # conversation's own lines (an api-request-blob line repeats a call with no time). perl,
    # not grep: macOS grep takes about 4 s a pattern over a 600 MB transcript, perl 0.25 s
    # for any number of them.
    if [ -n "$tail" ]; then tail -c 4194304 -- "$file"; else cat -- "$file"; fi |
      IDS=$ids perl -ne 'BEGIN { $re = join "|", split " ", $ENV{IDS}; $re = qr/$re/ } print if /$re/' | jq -c --arg ids "$ids" '
      def text: if type == "string" then . elif type == "array" then (map(select(type == "object" and .type == "text") | .text) | join("\n")) else "" end;
      ($ids | split(" ") | map(select(. != ""))) as $want
      | (fromjson? // empty) | select(type == "object" and (.type == "assistant" or .type == "user")) | . as $l
      | ($l.message.content? // empty) | arrays | .[] | select(type == "object")
      | if .type == "tool_use" and (.id as $i | $want | index($i)) != null then
          {id: .id, k: "in", ts: $l.timestamp,
           in: ((.input // {}) | if type == "object" then (.command // .file_path // .path // .pattern // .query // .url // .description // .prompt // tojson) else . end
                | tostring | .[0:400])}
        elif .type == "tool_result" and (.tool_use_id as $i | $want | index($i)) != null then
          (.content | text) as $o
          | {id: .tool_use_id, k: "out", ts: $l.timestamp, err: (.is_error == true), out: $o[0:24576], lines: ($o | split("\n") | length)}
        else empty end' -R
    ;;
  *) echo "not read for $harness yet" >&2; exit 4 ;;
esac
