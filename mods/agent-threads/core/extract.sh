#!/bin/sh
# agent-threads: read one chunk of a Claude Code, Codex, Pi, Cursor or Antigravity transcript from a
# byte offset.
# Usage: extract.sh <file> <offset> <max-bytes> [claude|codex|pi|cursor|antigravity] [reasoning]
# A fifth argument "reasoning" (the ATIF export only, never the pane) keeps the model's
# reasoning for Claude Code and Codex: its text, or a mark that it was withheld.
# Prints {"k":"file","size":N,"head":"<first uuid>"}, {"k":"chunk","used":N} (bytes of
# whole lines read), then extract.jq's events. Reads only the bytes between offset and
# offset+max-bytes, so a 700 MB transcript is never loaded at once. A cut-off last line is
# left for the next call. Output stays under 6 MiB (exec allows 8): a chunk whose events
# come to more is read again at half the size.
# Cursor sometimes writes its whole transcript again rather than adding to it. For a Cursor
# file the same read also takes up to 4 KB before the offset: the file line carries their
# cksum as "anchor", and a closing {"k":"settle","id"} names the 4 KB the next read starts
# after. When they differ the earlier bytes changed, and the pane reads the file again.
set -eu
file=$1
case $file in /*) ;; *) file=./$file ;; esac # a relative name may start with "-"
offset=$2
max=$3
harness=${4:-claude}
reasoning=0
[ "${5:-}" = reasoning ] && reasoning=1
here=$(dirname "$0")
# shellcheck disable=SC2034 # read by lines.sh, which also sets lines_note
threads_core=$here
# shellcheck source=lines.sh
. "$here/lines.sh"
limit=6291456
# A line longer than this (64 MB, as the ATIF export) is skipped, not read: reading a 300 MB
# line whole took chunks of 128 and 512 MB and jq held it (about 1.3 GB at its peak). A line
# just under it costs one read of about 2 s. The chunk line counts the bytes skipped, for the
# pane's debug report. THREADS_LINE_MAX sets it for tests; the pane never does.
# Cursor has neither the ceiling nor the skip, as before it: its settle mark reads the chunk's
# own bytes, so a skipped line would leave nothing to read, and a ceiling with no skip would
# stop the session at a line longer than it for good.
line_max=${THREADS_LINE_MAX:-67108864}
if [ "$harness" != cursor ] && [ "$max" -gt "$line_max" ]; then max=$line_max; fi
[ -f "$file" ] || { echo '{"k":"missing"}'; exit 0; }
size=$(wc -c < "$file" | tr -d ' ')
# The first line uuid (a Codex file: its first timestamp, a Pi file: its header's id, an
# Antigravity file: its first step's time) names the file's contents: a replaced file has
# another one.
if [ "$harness" = cursor ]; then
  head=""
elif [ "$harness" = pi ]; then
  head=$(head -c 400 "$file" | LC_ALL=C grep -m 1 -o '"id":"[^"]*"' | head -n 1 | cut -d '"' -f 4) || head=""
elif [ "$harness" = antigravity ]; then
  head=$(head -c 65536 "$file" | LC_ALL=C grep -m 1 -o '"created_at":"[^"]*"' | head -n 1 | cut -d '"' -f 4) || head=""
elif [ "$harness" = codex ]; then
  head=$(head -c 200 "$file" | LC_ALL=C grep -m 1 -o '"timestamp":"[^"]*"' | head -n 1 | cut -d '"' -f 4) || head=""
else
  head=$(head -c 65536 "$file" | LC_ALL=C grep -m 1 -o '"uuid":"[0-9a-f-]*"' | head -n 1 | cut -d '"' -f 4) || head=""
fi
pre=0
if [ "$harness" = cursor ] && [ "$offset" -gt 0 ]; then pre=$((offset < 4096 ? offset : 4096)); fi
# The cksum of the bytes from <from>, <count> long, read from stdin.
sum() { { dd bs=1 skip="$1" count=0 2>/dev/null; head -c "$2"; } | cksum | cut -d ' ' -f 1; }
if [ "$offset" -ge "$size" ]; then
  if [ "$pre" -gt 0 ]; then
    printf '{"k":"file","size":%s,"head":"%s","anchor":"%s"}\n' "$size" "$head" "$(sum $((offset - pre)) "$pre" < "$file")"
  else
    printf '{"k":"file","size":%s,"head":"%s"}\n' "$size" "$head"
  fi
  echo '{"k":"chunk","used":0}'
  exit 0
fi

tmp=$(mktemp "${TMPDIR:-/tmp}/agent-threads.XXXXXX")
out=$(mktemp "${TMPDIR:-/tmp}/agent-threads.XXXXXX")
trap 'rm -f "$tmp" "$out"' EXIT INT TERM
while :; do
  # dd seeks the open file to the offset without reading; head reads on from there. $tmp
  # starts with the <pre> bytes before the offset (Cursor only).
  { dd bs=1 skip=$((offset - pre)) count=0 2>/dev/null; head -c $((pre + max)); } < "$file" > "$tmp"
  got=$(($(wc -c < "$tmp" | tr -d ' ') - pre))
  # The chunk's whole lines (whole, in lines.sh): bytes after its last newline belong to a line
  # that is still being written, or one longer than the chunk.
  used=$(($(whole "$tmp" "$pre") - pre))
  [ "$used" -ge 0 ] || used=0
  # A line with no end within line_max bytes: skipped to its end, when it has one.
  skipped=0
  if [ "$used" -eq 0 ] && [ "$got" -ge "$line_max" ] && [ "$harness" != cursor ]; then
    e=$(line_end "$file" "$offset")
    [ "$e" -gt "$offset" ] && skipped=$((e - offset))
  fi
  if [ "$used" -gt 0 ]; then
    if [ "$harness" = cursor ]; then
      tail -c +$((pre + 1)) "$tmp" | head -c "$used" | lines | jq -c -f "$here/extract-cursor.jq" > "$out"
    elif [ "$harness" = pi ]; then
      # Tool results and system prompts (with every tool's schema) are most of a Pi file. A
      # quote inside a string is escaped, so these patterns only match a message's own role.
      head -c "$used" "$tmp" \
        | LC_ALL=C grep -E -v '"role":"(toolResult|system|bashExecution)"' \
        | lines | jq -c -f "$here/extract-pi.jq" > "$out"
    elif [ "$harness" = antigravity ]; then
      # Tool output (GENERIC steps) is most of an Antigravity file. A quote inside a string is
      # escaped, so this pattern only matches a step's own type.
      head -c "$used" "$tmp" \
        | LC_ALL=C grep -v -F '"type":"GENERIC"' \
        | lines | jq -c -f "$here/extract-agy.jq" > "$out"
    elif [ "$harness" = codex ]; then
      # Tool output, reasoning and finished commands are most of a Codex file. A quote inside
      # a string is escaped, so these patterns only match a line's own type. extract-codex.jq
      # ignores the same lines if one gets through. A call's output line becomes a short "_x"
      # line: its time, its call id, and whether the start or end of the output says it failed
      # (an exit code other than 0, success false, the failure lines calls.sh reads).
      # A subagent's rollout starts with a copy of its parent's history. The ATIF export reads
      # one from its own first line on (THREADS_FROM_ORDINAL, session_meta's
      # subagent_history_start_ordinal), as Harbor does; the panel never sets it.
      # A subagent's thread names it in session_meta, near the start of the first line.
      nick=$(head -c 4096 "$file" | LC_ALL=C grep -m 1 -o '"agent_nickname":"[^"\\]*"' | head -n 1 | cut -d '"' -f 4) || nick=""
      { [ -z "$nick" ] || jq -cn --arg t "$nick" '{k: "an", t: $t[0:80]}'
      head -c "$used" "$tmp" \
        | LC_ALL=C perl -ne 'BEGIN { $keep = shift @ARGV; $from = $ENV{THREADS_FROM_ORDINAL}; $from = undef unless defined $from && $from =~ /^\d+$/ }
            next if defined $from && (!/^\{"timestamp":"[^"\\]{0,40}","ordinal":(\d+)/ || $1 < $from);
            if (/"type":"(?:function_call_output|custom_tool_call_output)"/) {
              my ($id) = /"call_id":"([0-9A-Za-z_.:|-]{1,200})"/; next unless defined $id;
              my ($ts) = /^\{"timestamp":"([^"\\]{1,40})"/;
              my $w = substr($_, 0, 4096) . substr($_, -1024);
              my $f = $w =~ /\\"exit_code\\":-?[1-9]|"exit_code":-?[1-9]|\\"success\\":false|(?:^|\\n|")(?:Script failed|aborted|Process exited with code [1-9]|Exit code: [1-9])|tool failed/ ? "true" : "false";
              printf qq({"type":"_x","timestamp":%s,"payload":{"call_id":"%s","f":%s}}\n), defined $ts ? qq("$ts") : "null", $id, $f; next }
            print unless /"type":"(?:session_meta|world_state|token_usage_record|Reasoning|CommandExecution|FileChange|McpToolCall|DynamicToolCall|Extension|SubAgentActivity|CollabAgentToolCall|ImageView|WebSearch|FunctionCallOutput|ContextCompaction)"/ || (!$keep && /"type":"reasoning"/)' "$reasoning" \
        | lines | jq -c --arg reasoning "$reasoning" -f "$here/extract-codex.jq"; } > "$out"
    else
      # Bookkeeping lines start with {"type":"<name>" and are most of the bytes; drop every
      # type except user, assistant, attachment, system, custom-title and agent-name, every attachment but
      # a queued prompt, and every tool result but a subagent's launch result (it names an
      # agentId), before jq parses anything. A quote inside a string is escaped, so these
      # patterns only match a line's own keys. extract.jq drops the same lines again if one
      # gets through. perl is as fast as grep here; awk took 60 times as long.
      # Every other result line becomes a short "_x" line: its time, its calls' ids and whether
      # it says is_error, so a call's result time is known without jq parsing its text.
      head -c "$used" "$tmp" \
        | LC_ALL=C grep -E -v '^\{"type":"([^uasc]|u[^s]|a[^gst]|ag[^e]|s[^y]|c[^u])|"attachment":\{"type":"([^q]|q[^u])' \
        | LC_ALL=C perl -ne 'if (index($_, q("type":"tool_result")) < 0 || index($_, q("agentId":")) != -1) { print; next }
            my @ids = /"tool_use_id":"([0-9A-Za-z_.:|-]{1,200})"/g; next unless @ids;
            my ($ts) = /"timestamp":"(\d{4}-\d\d-\d\dT[0-9:.]{1,20}Z?)"/;
            printf qq({"type":"_x","ts":%s,"ids":[%s],"err":%s}\n), defined $ts ? qq("$ts") : "null", join(",", map { qq("$_") } @ids), /"is_error":true/ ? "true" : "false"' \
        | lines | jq -c --arg reasoning "$reasoning" -f "$here/extract.jq" > "$out"
    fi
  else
    : > "$out"
  fi
  [ "$(wc -c < "$out" | tr -d ' ')" -gt "$limit" ] && [ "$max" -gt 65536 ] || break
  max=$((max / 2))
done
skip_note=
if [ "$skipped" -gt 0 ]; then used=$skipped; skip_note=",\"skipped\":$skipped"; fi
if [ "$harness" = cursor ]; then
  end=$((pre + used))
  n=$((end < 4096 ? end : 4096))
  if [ "$pre" -gt 0 ]; then
    printf '{"k":"file","size":%s,"head":"","anchor":"%s"}\n' "$size" "$(sum 0 "$pre" < "$tmp")"
  else
    printf '{"k":"file","size":%s,"head":""}\n' "$size"
  fi
  # shellcheck disable=SC2154 # lines_note is set by lines.sh
  printf '{"k":"chunk","used":%s%s%s}\n' "$used" "$lines_note" "$skip_note"
  cat "$out"
  printf '{"k":"settle","id":"%s"}\n' "$(sum $((end - n)) "$n" < "$tmp")"
  exit 0
fi
printf '{"k":"file","size":%s,"head":"%s"}\n' "$size" "$head"
# shellcheck disable=SC2154 # lines_note is set by lines.sh
printf '{"k":"chunk","used":%s%s%s}\n' "$used" "$lines_note" "$skip_note"
cat "$out"
