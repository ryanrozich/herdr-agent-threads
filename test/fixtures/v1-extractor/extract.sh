#!/bin/sh
# herdr-threads: read one chunk of a Claude Code transcript from a byte offset.
# Usage: extract.sh <file> <offset> <max-bytes>
# Prints {"k":"file","size":N}, {"k":"chunk","used":N} (bytes of whole lines read),
# then extract.jq's events. Reads only the bytes between offset and offset+max-bytes,
# so a 700 MB transcript is never loaded at once. A cut-off last line is left for the
# next call.
set -eu
file=$1
offset=$2
max=$3
here=$(dirname "$0")
[ -f "$file" ] || { echo '{"k":"missing"}'; exit 0; }
size=$(wc -c < "$file" | tr -d ' ')
printf '{"k":"file","size":%s}\n' "$size"
if [ "$offset" -ge "$size" ]; then echo '{"k":"chunk","used":0}'; exit 0; fi

tmp=$(mktemp "${TMPDIR:-/tmp}/herdr-threads.XXXXXX")
trap 'rm -f "$tmp"' EXIT INT TERM
tail -c +"$((offset + 1))" "$file" | head -c "$max" > "$tmp"
got=$(wc -c < "$tmp" | tr -d ' ')
# Bytes after the last newline belong to a line that is still being written.
if [ "$got" -gt 0 ] && [ "$(tail -c 1 "$tmp" | od -An -c | tr -d ' ')" != '\n' ]; then
  partial=$(tail -n 1 "$tmp" | wc -c | tr -d ' ')
else
  partial=0
fi
used=$((got - partial))
printf '{"k":"chunk","used":%s}\n' "$used"
[ "$used" -gt 0 ] || exit 0
# Bookkeeping lines start with {"type":"<name>" and are most of the bytes; drop every
# type except user, assistant, system and custom-title before jq parses anything.
head -c "$used" "$tmp" \
  | LC_ALL=C grep -E -v '^\{"type":"([^uasc]|u[^s]|a[^s]|s[^y]|c[^u])' \
  | jq -Rc -f "$here/extract.jq"
