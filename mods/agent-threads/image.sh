#!/bin/sh
# agent-threads: decode one prompt's pasted images to files the panel can draw.
# Usage: image.sh <transcript> <line uuid> <cache root> <session id> [claude|codex|pi|opencode]
# Finds the prompt line by its uuid, writes each image block to
# <cache root>/<session id>/<uuid>-<i>.<ext> (kept when already there), and prints one
# {"i":N,"file":"<name>","w":W,"h":H} line per image (w and h 0 when unknown). Then trims
# the cache to MAX_KB, oldest files first. Only metadata is printed: image data never goes
# through the panel. Codex: <line uuid> is <turn id>_<ordinal>, and the image data is on the
# message line just before that prompt's line. Pi: <line uuid> is the prompt entry's id. Pi's
# Ctrl-V saves an image to a temp file and puts its path in the prompt: those come first, copied
# from the temp folder only when the file starts like a PNG, JPEG, GIF or WebP. A path whose file
# is gone prints {"i":N,"gone":true}.
# OpenCode: <transcript> is <database>#<session>
# and <line uuid> is the prompt's message id, in 1.x's part table or 2.x's session_message.
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
  pi)
    blocks='[.[0].message.content[]? | select(type == "object" and .type == "image") | {mt: (.mimeType // ""), data: (.data // "")}]'
    # "id":"<id>" names the entry itself (parentId spells it with a capital I).
    LC_ALL=C grep -m 1 -F "\"id\":\"$uuid\"" "$file" > "$line" || { echo "no line" >&2; exit 4; } ;;
  opencode)
    # 1.x keeps an image as a data URL in a file part. 2.x keeps it in the prompt's files, as
    # bare base64 in .data. 1.19 already has an empty session_message, so both 2.x tables decide.
    blocks='[.[] | select((.mime // "") | startswith("image/")) | {mt: .mime, data: (if .url then ((.url | split(";base64,"))[1] // "") elif ((.data // "") | startswith("data:")) then ((.data | split(";base64,"))[1] // "") else (.data // "") end)}]'
    if [ "$(sqlite3 -readonly -batch -noheader "$file" "select count(*) from sqlite_master where type='table' and name in ('session_v2','session_message');")" = 2 ]; then
      sqlite3 -readonly -batch -noheader "$file" "select f.value from session_message m, json_each(m.data,'\$.files') f where m.session_id='$sid' and m.id='$uuid' order by f.key;" > "$line" || { echo "no line" >&2; exit 4; }
    else
      sqlite3 -readonly -batch -noheader "$file" "select data from part where session_id='$sid' and message_id='$uuid' and json_extract(data,'\$.type')='file' order by id;" > "$line" || { echo "no line" >&2; exit 4; }
    fi ;;
  *)
    # A prompt sent while Claude works keeps its blocks on an attachment line.
    blocks='[(.[0].message.content, .[0].attachment.prompt) | .[]? | select(type == "object" and .type == "image") | {mt: (.source.media_type // ""), data: (.source.data // "")}]'
    # "uuid":"<id>" names the line itself (parentUuid is spelled with a capital U).
    LC_ALL=C grep -m 1 -F "\"uuid\":\"$uuid\"" "$file" > "$line" || { echo "no line" >&2; exit 4; } ;;
esac

# The same paths extract-pi.jq turns into [Image #N]. They have no spaces or glob characters.
PI_CLIP='(?<!\S)(/private)?(/var/folders/[0-9A-Za-z_+-]+/[0-9A-Za-z_+-]+/T|/tmp)/pi-clipboard-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpeg|jpg|png|gif|webp)'

# The image type a file's first bytes say, as an extension, or nothing.
magic() {
  head -c 12 "$1" 2> /dev/null | od -An -tx1 | tr -d ' \n' | awk '
    /^89504e470d0a1a0a/ { print "png"; exit } /^ffd8ff/ { print "jpg"; exit }
    /^47494638/ { print "gif"; exit } /^52494646........57454250/ { print "webp"; exit }'
}

dims() {
  if command -v sips > /dev/null 2>&1; then
    sips -g pixelWidth -g pixelHeight "$1" 2> /dev/null | awk '/pixelWidth/ {w=$2} /pixelHeight/ {h=$2} END {printf "%d %d", w+0, h+0}'
  elif [ "$(head -c 8 "$1" | od -An -tx1 | tr -d ' \n')" = "89504e470d0a1a0a" ]; then
    od -An -tu1 -j16 -N8 "$1" | awk '{printf "%d %d", $1*16777216+$2*65536+$3*256+$4, $5*16777216+$6*65536+$7*256+$8}'
  else
    printf '0 0'
  fi
}

k=0
if [ "$harness" = pi ]; then
  clips=$(jq -rs --arg re "$PI_CLIP" '.[0].message.content | (if type == "string" then . else [.[]? | select(type == "object" and .type == "text") | (.text // "")] | join("\n") end) | match($re; "g") | .string' "$line")
  for p in $clips; do
    name=""
    for e in png jpg gif webp; do [ -s "$dir/$uuid-$k.$e" ] && name="$uuid-$k.$e"; done
    if [ -n "$name" ]; then
      touch "$dir/$name"
    elif [ -f "$p" ] && [ ! -L "$p" ] && [ "$(wc -c < "$p")" -le 52428800 ] && ext=$(magic "$p") && [ -n "$ext" ]; then
      name="$uuid-$k.$ext"
      if cp "$p" "$tmp" && mv "$tmp" "$dir/$name"; then tmp=$(mktemp "${TMPDIR:-/tmp}/agent-threads-img.XXXXXX"); else k=$((k + 1)); continue; fi
    else
      [ -e "$p" ] || printf '{"i":%s,"gone":true}\n' "$k"
      k=$((k + 1)); continue
    fi
    wh=$(dims "$dir/$name")
    w=${wh%% *} h=${wh##* }
    printf '{"i":%s,"file":"%s","w":%s,"h":%s}\n' "$k" "$name" "${w:-0}" "${h:-0}"
    k=$((k + 1))
  done
fi

types=$(jq -rs "$blocks | .[].mt" "$line")
i=$k
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
    jq -rs --argjson i "$((i - k))" "$blocks | .[\$i].data // empty" "$line" \
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
