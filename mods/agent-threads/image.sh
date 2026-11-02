#!/bin/sh
# agent-threads: decode one prompt's pasted images to files the panel can draw.
# Usage: image.sh <transcript> <line uuid> <cache root> <session id>
# Finds the prompt line by its uuid, writes each image block to
# <cache root>/<session id>/<uuid>-<i>.<ext> (kept when already there), and prints one
# {"i":N,"file":"<name>","w":W,"h":H} line per image (w and h 0 when unknown). Then trims
# the cache to MAX_KB, oldest files first. Only metadata is printed: image data never goes
# through the panel.
set -eu
file=$1
uuid=$2
root=$3
sid=$4
max_kb=${HERDR_THREADS_IMAGE_KB:-204800}
case $uuid in "" | *[!0-9a-f-]*) echo "bad uuid" >&2; exit 2 ;; esac
case $sid in "" | *[!0-9A-Za-z_-]*) echo "bad session id" >&2; exit 2 ;; esac
case $file in /*) ;; *) file=./$file ;; esac
[ -f "$file" ] || { echo "no transcript" >&2; exit 3; }
dir="$root/$sid"
mkdir -p "$dir"

line=$(mktemp "${TMPDIR:-/tmp}/agent-threads-img.XXXXXX")
tmp=$(mktemp "${TMPDIR:-/tmp}/agent-threads-img.XXXXXX")
trap 'rm -f "$line" "$tmp"' EXIT INT TERM
# "uuid":"<id>" names the line itself (parentUuid is spelled with a capital U).
LC_ALL=C grep -m 1 -F "\"uuid\":\"$uuid\"" "$file" > "$line" || { echo "no line" >&2; exit 4; }

dims() {
  if command -v sips > /dev/null 2>&1; then
    sips -g pixelWidth -g pixelHeight "$1" 2> /dev/null | awk '/pixelWidth/ {w=$2} /pixelHeight/ {h=$2} END {printf "%d %d", w+0, h+0}'
  elif [ "$(head -c 8 "$1" | od -An -tx1 | tr -d ' \n')" = "89504e470d0a1a0a" ]; then
    od -An -tu1 -j16 -N8 "$1" | awk '{printf "%d %d", $1*16777216+$2*65536+$3*256+$4, $5*16777216+$6*65536+$7*256+$8}'
  else
    printf '0 0'
  fi
}

types=$(jq -r '[.message.content[]? | select(type == "object" and .type == "image") | (.source.media_type // "")] | .[]' "$line")
i=0
for mt in $types; do
  case $mt in
    image/png) ext=png ;;
    image/jpeg) ext=jpg ;;
    image/gif) ext=gif ;;
    image/webp) ext=webp ;;
    *) i=$((i + 1)); continue ;;
  esac
  name="$uuid-$i.$ext"
  if [ -s "$dir/$name" ]; then
    touch "$dir/$name"
  else
    jq -r --argjson i "$i" '[.message.content[]? | select(type == "object" and .type == "image")][$i].source.data // empty' "$line" \
      | base64 --decode > "$tmp" 2> /dev/null || : > "$tmp"
    if [ -s "$tmp" ]; then mv "$tmp" "$dir/$name"; tmp=$(mktemp "${TMPDIR:-/tmp}/agent-threads-img.XXXXXX"); else i=$((i + 1)); continue; fi
  fi
  wh=$(dims "$dir/$name")
  w=${wh%% *} h=${wh##* }
  printf '{"i":%s,"file":"%s","w":%s,"h":%s}\n' "$i" "$name" "${w:-0}" "${h:-0}"
  i=$((i + 1))
done

# Keep the cache under max_kb: drop the least recently used files, a few at a time.
n=0
while [ "$n" -lt 50 ] && [ "$(du -sk "$root" | cut -f1)" -gt "$max_kb" ]; do
  old=$(find "$root" -type f -name '*-*.*' -exec ls -tr {} + 2> /dev/null | head -n 20)
  [ -n "$old" ] || break
  echo "$old" | while IFS= read -r f; do rm -f "$f"; done
  n=$((n + 1))
done
