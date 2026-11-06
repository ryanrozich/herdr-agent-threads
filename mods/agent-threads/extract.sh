#!/bin/sh
# agent-threads: read one chunk of a Claude Code, Codex, Pi or Cursor transcript from a byte offset.
# Usage: extract.sh <file> <offset> <max-bytes> [claude|codex|pi|cursor]
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
here=$(dirname "$0")
limit=6291456
[ -f "$file" ] || { echo '{"k":"missing"}'; exit 0; }
size=$(wc -c < "$file" | tr -d ' ')
# The first line uuid (a Codex file: its first timestamp, a Pi file: its header's id) names the
# file's contents: a replaced file has another one.
if [ "$harness" = cursor ]; then
  head=""
elif [ "$harness" = pi ]; then
  head=$(head -c 400 "$file" | LC_ALL=C grep -m 1 -o '"id":"[^"]*"' | head -n 1 | cut -d '"' -f 4) || head=""
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
  # Bytes after the last newline belong to a line that is still being written.
  if [ "$got" -gt 0 ] && [ "$(tail -c 1 "$tmp" | od -An -c | tr -d ' ')" != '\n' ]; then
    partial=$(tail -n 1 "$tmp" | wc -c | tr -d ' ')
  else
    partial=0
  fi
  used=$((got - partial))
  [ "$used" -ge 0 ] || used=0
  if [ "$used" -gt 0 ]; then
    if [ "$harness" = cursor ]; then
      tail -c +$((pre + 1)) "$tmp" | head -c "$used" | jq -Rc -f "$here/extract-cursor.jq" > "$out"
    elif [ "$harness" = pi ]; then
      # Tool results and system prompts (with every tool's schema) are most of a Pi file. A
      # quote inside a string is escaped, so these patterns only match a message's own role.
      head -c "$used" "$tmp" \
        | LC_ALL=C grep -E -v '"role":"(toolResult|system|bashExecution)"' \
        | jq -Rc -f "$here/extract-pi.jq" > "$out"
    elif [ "$harness" = codex ]; then
      # Tool output, reasoning and finished commands are most of a Codex file. A quote inside
      # a string is escaped, so these patterns only match a line's own type. extract-codex.jq
      # ignores the same lines if one gets through.
      head -c "$used" "$tmp" \
        | LC_ALL=C grep -E -v '"type":"(session_meta|world_state|token_usage_record|reasoning|function_call_output|custom_tool_call_output|Reasoning|CommandExecution|FileChange|McpToolCall|DynamicToolCall|Extension|SubAgentActivity|CollabAgentToolCall|ImageView|WebSearch|FunctionCallOutput|ContextCompaction)"' \
        | jq -Rc -f "$here/extract-codex.jq" > "$out"
    else
      # Bookkeeping lines start with {"type":"<name>" and are most of the bytes; drop every
      # type except user, assistant, attachment, system and custom-title, every attachment but
      # a queued prompt, and every tool result, before jq parses anything. A quote inside a
      # string is escaped, so these patterns only match a line's own keys. extract.jq drops the
      # same lines again if one gets through.
      head -c "$used" "$tmp" \
        | LC_ALL=C grep -E -v '^\{"type":"([^uasc]|u[^s]|a[^st]|s[^y]|c[^u])|"attachment":\{"type":"([^q]|q[^u])' \
        | LC_ALL=C grep -v -F '"type":"tool_result"' \
        | jq -Rc -f "$here/extract.jq" > "$out"
    fi
  else
    : > "$out"
  fi
  [ "$(wc -c < "$out" | tr -d ' ')" -gt "$limit" ] && [ "$max" -gt 65536 ] || break
  max=$((max / 2))
done
if [ "$harness" = cursor ]; then
  end=$((pre + used))
  n=$((end < 4096 ? end : 4096))
  if [ "$pre" -gt 0 ]; then
    printf '{"k":"file","size":%s,"head":"","anchor":"%s"}\n' "$size" "$(sum 0 "$pre" < "$tmp")"
  else
    printf '{"k":"file","size":%s,"head":""}\n' "$size"
  fi
  printf '{"k":"chunk","used":%s}\n' "$used"
  cat "$out"
  printf '{"k":"settle","id":"%s"}\n' "$(sum $((end - n)) "$n" < "$tmp")"
  exit 0
fi
printf '{"k":"file","size":%s,"head":"%s"}\n' "$size" "$head"
printf '{"k":"chunk","used":%s}\n' "$used"
cat "$out"
