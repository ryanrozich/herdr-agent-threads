#!/bin/sh
# agent-threads: read one chunk of a Claude Code transcript from a byte offset.
# Usage: extract.sh <file> <offset> <max-bytes>
# Prints {"k":"file","size":N,"head":"<first uuid>"}, {"k":"chunk","used":N} (bytes of
# whole lines read), then extract.jq's events. Reads only the bytes between offset and
# offset+max-bytes, so a 700 MB transcript is never loaded at once. A cut-off last line is
# left for the next call. Output stays under 6 MiB (exec allows 8): a chunk whose events
# come to more is read again at half the size.
set -eu
file=$1
case $file in /*) ;; *) file=./$file ;; esac # a relative name may start with "-"
offset=$2
max=$3
here=$(dirname "$0")
limit=6291456
[ -f "$file" ] || { echo '{"k":"missing"}'; exit 0; }
size=$(wc -c < "$file" | tr -d ' ')
# The first line uuid names the file's contents: a replaced file has another one.
head=$(head -c 65536 "$file" | LC_ALL=C grep -m 1 -o '"uuid":"[0-9a-f-]*"' | head -n 1 | cut -d '"' -f 4) || head=""
printf '{"k":"file","size":%s,"head":"%s"}\n' "$size" "$head"
if [ "$offset" -ge "$size" ]; then echo '{"k":"chunk","used":0}'; exit 0; fi

tmp=$(mktemp "${TMPDIR:-/tmp}/agent-threads.XXXXXX")
out=$(mktemp "${TMPDIR:-/tmp}/agent-threads.XXXXXX")
trap 'rm -f "$tmp" "$out"' EXIT INT TERM
while :; do
  # dd seeks the open file to the offset without reading; head reads on from there.
  { dd bs=1 skip="$offset" count=0 2>/dev/null; head -c "$max"; } < "$file" > "$tmp"
  got=$(wc -c < "$tmp" | tr -d ' ')
  # Bytes after the last newline belong to a line that is still being written.
  if [ "$got" -gt 0 ] && [ "$(tail -c 1 "$tmp" | od -An -c | tr -d ' ')" != '\n' ]; then
    partial=$(tail -n 1 "$tmp" | wc -c | tr -d ' ')
  else
    partial=0
  fi
  used=$((got - partial))
  if [ "$used" -gt 0 ]; then
    # Bookkeeping lines start with {"type":"<name>" and are most of the bytes; drop every
    # type except user, assistant, system and custom-title, and every tool result, before
    # jq parses anything. extract.jq drops the same lines again if one gets through.
    head -c "$used" "$tmp" \
      | LC_ALL=C grep -E -v '^\{"type":"([^uasc]|u[^s]|a[^s]|s[^y]|c[^u])' \
      | LC_ALL=C grep -v -F '"type":"tool_result"' \
      | jq -Rc -f "$here/extract.jq" > "$out"
  else
    : > "$out"
  fi
  [ "$(wc -c < "$out" | tr -d ' ')" -gt "$limit" ] && [ "$max" -gt 65536 ] || break
  max=$((max / 2))
done
printf '{"k":"chunk","used":%s}\n' "$used"
cat "$out"
