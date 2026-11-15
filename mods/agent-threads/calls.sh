#!/bin/sh
# agent-threads: one step group's tool calls, read from the transcript when the group opens.
# Usage: calls.sh [--tail] <transcript> <harness> <call id>...
# Prints one JSON line per part found, by call id: {"id","k":"in","ts","in"} for the call (its
# command, file, pattern or query, at most 400 characters) and {"id","k":"out","ts","err",
# "out","lines"} for its result (at most 24 KB of text, and its whole line count). The panel
# keeps these in memory only: nothing is written here, and nothing is saved.
# --tail reads only the transcript's last 4 MB, for the newest call of a group still running.
# Claude Code: the tool_use and tool_result blocks with these ids. Codex: the calls and outputs
# with these call ids.
set -eu
tail=
if [ "${1:-}" = --tail ]; then tail=1; shift; fi
[ $# -ge 2 ] || { echo "usage: calls.sh [--tail] transcript harness call-id..." >&2; exit 2; }
file=$1
harness=$2
shift 2
[ $# -gt 0 ] || exit 0
for id in "$@"; do
  case $id in "" | *[!0-9A-Za-z_.:\|-]*) echo "bad call id" >&2; exit 2 ;; esac
done
# OpenCode: the session is "<database>#<session id>", and opencode.sh reads it with SQL.
if [ "$harness" = opencode ]; then
  sh "$(dirname "$0")/opencode.sh" calls "${file%#*}" "${file##*#}" "$@"
  exit $?
fi
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
      IDS=$ids perl -ne 'BEGIN { $re = join "|", map { quotemeta } split " ", $ENV{IDS}; $re = qr/$re/ } print if /$re/' | jq -c --arg ids "$ids" '
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
  codex)
    # Codex: response_item lines. A function_call's arguments are JSON in a string; a
    # custom_tool_call's input is text (a patch, or the script its exec tool runs); a
    # local_shell_call has its command as a list. Outputs are text, JSON with an output and
    # an exit code, or a list of input_text parts. A compaction line repeats old calls inside
    # its history, so only response_item lines count. A call failed when its script failed, it
    # was aborted, or a command it ran (a chunk line of its exec tool) exited with a code.
    if [ -n "$tail" ]; then tail -c 4194304 -- "$file"; else cat -- "$file"; fi |
      IDS=$ids perl -ne 'BEGIN { $re = join "|", map { quotemeta } split " ", $ENV{IDS}; $re = qr/$re/ } print if /$re/' | jq -c --arg ids "$ids" '
      def argv: if type == "array" then (if .[2] != null and (.[1] | tostring | test("^-l?c$")) then .[2] else map(tostring) | join(" ") end) else . end;
      def firstline: tostring | split("\n") | map(select(test("\\S"))) | (.[0] // "");
      def input:
        if .type == "function_call" then
          ((.arguments // "") | (fromjson? // .)) as $a
          | if ($a | type) == "object" then
              ($a.cmd // ($a.command | if . == null then null else argv end) // $a.title // $a.path // $a.file_path // $a.query // $a.url // $a.message // ($a.code | if . == null then null else firstline end) // ($a | tojson))
            else $a end
        elif .type == "local_shell_call" then (.action.command // [] | argv)
        else (.input // "" | tostring) as $i
          | ($i | [scan("\\*\\*\\* (?:Update|Add|Delete) File: ([^\n]+)")] | map(.[0])) as $files
          | (first($i | match("cmd:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"") | .captures[0].string) // null | if . == null then null else (("\"" + . + "\"") | fromjson? // .) end) as $cmd
          | if ($files | length) != 0 then ($files | join(", ")) elif $cmd then $cmd else ($i | firstline) end
        end | tostring | .[0:400];
      def text: if type == "string" then . elif type == "array" then (map(select(type == "object" and (.type == "input_text" or .type == "output_text" or .type == "text")) | .text) | join("\n")) elif . == null then "" else tojson end;
      ($ids | split(" ") | map(select(. != ""))) as $want
      | (fromjson? // empty) | select(type == "object" and .type == "response_item") | . as $l | ($l.payload // {}) as $p
      | select(($p.call_id | type) == "string" and (($p.call_id) as $i | $want | index($i)) != null)
      | if ($p.type == "function_call" or $p.type == "custom_tool_call" or $p.type == "local_shell_call") then
          {id: $p.call_id, k: "in", ts: $l.timestamp, in: ($p | input)}
        elif ($p.type == "function_call_output" or $p.type == "custom_tool_call_output") then
          ($p.output | if type == "string" then (fromjson? // .) else . end) as $o
          | (if ($o | type) == "object" and ($o | has("output")) then ($o.output | text) else ($o | text) end) as $t
          | ((($o | type) == "object" and ((($o.metadata.exit_code? // 0) != 0) or $o.success? == false))
             or ($t | split("\n") | .[0:8] | any(test("^(Script failed|aborted)|tool failed|^Process exited with code [1-9]|^Exit code: [1-9]|^\\{\"chunk_id\".*\"exit_code\":[1-9]")))) as $err
          | {id: $p.call_id, k: "out", ts: $l.timestamp, err: $err, out: $t[0:24576], lines: ($t | split("\n") | length)}
        else empty end' -R
    ;;
  pi)
    # Pi: an assistant message's toolCall parts (id, name, arguments) and the toolResult
    # message for each (toolCallId, isError, durationMs, text parts).
    if [ -n "$tail" ]; then tail -c 4194304 -- "$file"; else cat -- "$file"; fi |
      IDS=$ids perl -ne 'BEGIN { $re = join "|", map { quotemeta } split " ", $ENV{IDS}; $re = qr/$re/ } print if /$re/' | jq -c --arg ids "$ids" '
      def text: if type == "string" then . elif type == "array" then (map(select(type == "object" and .type == "text") | .text) | join("\n")) else "" end;
      ($ids | split(" ") | map(select(. != ""))) as $want
      | (fromjson? // empty) | select(type == "object" and .type == "message") | . as $l | ($l.message // {}) as $m
      | if $m.role == "assistant" then
          ($m.content? // empty) | arrays | .[] | select(type == "object" and .type == "toolCall" and ((.id // "") as $i | $want | index($i)) != null)
          | {id: .id, k: "in", ts: $l.timestamp,
             in: ((.arguments // {}) | (if type == "string" then (fromjson? // .) else . end)
                  | if type == "object" then (.command // .path // .file_path // .pattern // .query // .url // tojson) else . end | tostring | .[0:400])}
        elif $m.role == "toolResult" and (($m.toolCallId // "") as $i | $want | index($i)) != null then
          ($m.content | text) as $o
          | {id: $m.toolCallId, k: "out", ts: $l.timestamp, err: ($m.isError == true), out: $o[0:24576], lines: ($o | split("\n") | length)}
            + (if ($m.durationMs | type) == "number" then {ms: $m.durationMs} else {} end)
        else empty end' -R
    ;;
  *) echo "not read for $harness yet" >&2; exit 4 ;;
esac
