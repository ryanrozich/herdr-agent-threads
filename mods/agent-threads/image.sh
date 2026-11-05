#!/bin/sh
# agent-threads: decode one prompt's pasted images to files the panel can draw.
# Usage: image.sh <transcript> <line uuid> <cache root> <session id> [claude|codex|opencode]
# Finds the prompt line by its uuid, writes each image block to
# <cache root>/<session id>/<uuid>-<i>.<ext> (kept when already there), and prints one
# {"i":N,"file":"<name>","w":W,"h":H} line per image (w and h 0 when unknown). Then trims
# the cache to MAX_KB, oldest files first. Only metadata is printed: image data never goes
# through the panel. Codex: <line uuid> is <turn id>_<ordinal>, and the image data is on the
# message line just before that prompt's line. OpenCode: <transcript> is <database>#<session>
# and <line uuid> is the prompt's message id.
set -eu
file=$1
uuid=$2
root=$3
sid=$4
harness=${5:-claude}
max_kb=${HERDR_THREADS_IMAGE_KB:-204800}
if [ "$harness" = claude ]; then
  case $uuid in "" | *[!0-9a-f-]*) echo "bad uuid" >&2; exit 2 ;; esac
else
  case $uuid in "" | *[!0-9A-Za-z_-]*) echo "bad uuid" >&2; exit 2 ;; esac
fi
case $sid in "" | *[!0-9A-Za-z_-]*) echo "bad session id" >&2; exit 2 ;; esac
case $file in /*) ;; *) file=./$file ;; esac
[ "$harness" = opencode ] && file=${file%%#*}
[ -f "$file" ] || { echo "no transcript" >&2; exit 3; }
dir="$root/$sid"
mkdir -p "$dir"

line=$(mktemp "${TMPDIR:-/tmp}/agent-threads-img.XXXXXX")
tmp=$(mktemp "${TMPDIR:-/tmp}/agent-threads-img.XXXXXX")
trap 'rm -f "$line" "$tmp"' EXIT INT TERM
# Each kind of file's image blocks as [{mt, data}], from the slurped line or lines.
case $harness in
  codex)
    blocks='[.[0].payload.content[]? | select(type == "object" and .type == "input_image") | (.image_url // "") | select(startswith("data:")) | split(";base64,") | {mt: (.[0] | ltrimstr("data:")), data: (.[1] // "")}]'
    ord=${uuid##*_}
    case $ord in "" | *[!0-9]*) echo "bad uuid" >&2; exit 2 ;; esac
    back=1
    while :; do
      LC_ALL=C grep -m 1 -E "^\{\"timestamp\":\"[^\"]*\",\"ordinal\":$((ord - back))," "$file" > "$line" || :
      [ -s "$line" ] && [ "$(jq -s "$blocks | length" "$line" 2> /dev/null || echo 0)" -gt 0 ] && break
      back=$((back + 1))
      [ "$back" -le 3 ] || { echo "no line" >&2; exit 4; }
    done ;;
  opencode)
    blocks='[.[] | select((.mime // "") | startswith("image/")) | {mt: .mime, data: ((.url // "") | split(";base64,")[1] // "")}]'
    sqlite3 -readonly -batch -noheader "$file" "select data from part where session_id='$sid' and message_id='$uuid' and json_extract(data,'\$.type')='file' order by id;" > "$line" || { echo "no line" >&2; exit 4; } ;;
  *)
    blocks='[.[0].message.content[]? | select(type == "object" and .type == "image") | {mt: (.source.media_type // ""), data: (.source.data // "")}]'
    # "uuid":"<id>" names the line itself (parentUuid is spelled with a capital U).
    LC_ALL=C grep -m 1 -F "\"uuid\":\"$uuid\"" "$file" > "$line" || { echo "no line" >&2; exit 4; } ;;
esac

dims() {
  if command -v sips > /dev/null 2>&1; then
    sips -g pixelWidth -g pixelHeight "$1" 2> /dev/null | awk '/pixelWidth/ {w=$2} /pixelHeight/ {h=$2} END {printf "%d %d", w+0, h+0}'
  elif [ "$(head -c 8 "$1" | od -An -tx1 | tr -d ' \n')" = "89504e470d0a1a0a" ]; then
    od -An -tu1 -j16 -N8 "$1" | awk '{printf "%d %d", $1*16777216+$2*65536+$3*256+$4, $5*16777216+$6*65536+$7*256+$8}'
  else
    printf '0 0'
  fi
}

types=$(jq -rs "$blocks | .[].mt" "$line")
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
    jq -rs --argjson i "$i" "$blocks | .[\$i].data // empty" "$line" \
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
