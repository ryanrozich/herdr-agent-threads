#!/bin/sh
# Fails when a file Biome lints is at or over its size limit (files.maxSize, 1 MiB by
# default). Biome skips such a file with a warning and still exits 0, so its lint would stop
# covering the file without failing. Biome skips a file of exactly 1,048,576 bytes too.
# The files are Biome's own list ("Files processed" in lint --verbose), so biome.jsonc's
# includes and ignores decide the set. Run from the repository root.
# BIOME: the Biome command (the version CI lints with by default).
set -eu
max=1048576
biome=${BIOME:-bunx @biomejs/biome@2.6.4}
# Biome's exit status is the lint step's to report; only its list of files is read here.
# shellcheck disable=SC2086 # BIOME is a command with its arguments
out=$($biome lint --verbose --max-diagnostics=0 2>&1) || true
# The list's lines are "  - path"; it ends at the first other line that is not blank.
files=$(printf '%s\n' "$out" | awk '/Files processed:/ { on = 1; next } on && /^  - / { sub(/^  - /, ""); print; next } on && /[^ ]/ { exit }')
if [ -z "$files" ]; then
  echo "lint-size: Biome listed no files; its output was:" >&2
  printf '%s\n' "$out" >&2
  exit 1
fi
over=0
missing=0
count=0
big=0
bigf=
while IFS= read -r f; do
  # A file Biome named that is not here means the list was misread: no size was checked.
  if [ ! -f "$f" ]; then
    echo "lint-size: Biome listed $f, which is not a file here" >&2
    missing=1
    continue
  fi
  size=$(wc -c < "$f" | tr -d ' ')
  count=$((count + 1))
  if [ "$size" -gt "$big" ]; then big=$size; bigf=$f; fi
  if [ "$size" -ge "$max" ]; then
    echo "$f: $size bytes, at or over Biome's limit of $max bytes, so Biome skips it" >&2
    over=1
  fi
done <<EOF
$files
EOF
if [ "$missing" -ne 0 ]; then
  echo "lint-size: run from the repository root; Biome's list did not match the files" >&2
  exit 1
fi
if [ "$count" -eq 0 ]; then
  echo "lint-size: no file was checked" >&2
  exit 1
fi
if [ "$over" -ne 0 ]; then
  echo "lint-size: split the file, or move part of it into a module of its own" >&2
  exit 1
fi
echo "lint-size: $count files, all under $max bytes; the largest is $bigf at $big bytes"
