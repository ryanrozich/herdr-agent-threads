#!/bin/sh
# Scans the repo for things that must not be committed: this machine's home path, the
# per-user temp folder, the user's login name outside the repo slug, email addresses,
# session ids that are not the synthetic 00000000-… ones, and (with tesseract installed)
# the same strings plus the Herdr sidebar in every PNG. Prints each hit; exits 1 if any.
# Usage: sh test/scan-private.sh
set -u
cd "$(dirname "$0")/.." || exit 2
me=$(id -un)
hits=0
hit() { printf '%s\n' "$1"; hits=$((hits + 1)); }

pat="$HOME|/private/tmp/claude-[0-9]+|/tmp/claude-[0-9]+/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}"
git grep --untracked -n -I -E "$pat" -- . ':!*.pen' ':!test/scan-private.sh' \
  | grep -v -E 'noreply@anthropic\.com|@types/|@[0-9]|@github\.com[:/]' \
  | while IFS= read -r l; do printf 'text: %s\n' "$(printf '%s' "$l" | cut -c1-160)"; done > /tmp/scan-private.$$
# LICENSE names the copyright holder on purpose.
git grep --untracked -n -I -i -w "$me" -- . ':!*.pen' ':!test/scan-private.sh' ':!LICENSE' | grep -v -i "${me}rozich" \
  | grep -v -E "^docs/(decisions|research/[a-z]+)\.md:[0-9]+:.*${me}'s" -i \
  | while IFS= read -r l; do printf 'name: %s\n' "$(printf '%s' "$l" | cut -c1-160)"; done >> /tmp/scan-private.$$
git grep --untracked -n -I -o -E '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' -- . ':!*.pen' \
  | grep -v -E ':0{8}-0{4}-' \
  | while IFS= read -r l; do printf 'id: %s\n' "$l"; done >> /tmp/scan-private.$$
# Truncated ids as docs quote them ("b3159f26-…"), other than the synthetic 00000000.
git grep --untracked -n -I -o -E '[0-9a-f]{8}-(…|\.\.\.)' -- . ':!*.pen' ':!test/scan-private.sh' \
  | grep -v -E ':0{8}-' \
  | while IFS= read -r l; do printf 'id: %s\n' "$l"; done >> /tmp/scan-private.$$
# Link rules ship only with placeholder organisations: a linear.app link names acme, and
# the owner's own issue-key prefix (kept out of this file as octal) appears nowhere.
git grep --untracked -n -I -E 'linear\.app/[A-Za-z0-9_-]+' -- . ':!*.pen' ':!test/scan-private.sh' | grep -v -E 'linear\.app/acme/' \
  | while IFS= read -r l; do printf 'link: %s\n' "$(printf '%s' "$l" | cut -c1-160)"; done >> /tmp/scan-private.$$
key=$(printf '\103\124\103')
git grep --untracked -n -I -E "(^|[^A-Za-z])${key}-?[0-9]" -- . ':!*.pen' ':!test/scan-private.sh' \
  | while IFS= read -r l; do printf 'key: %s\n' "$(printf '%s' "$l" | cut -c1-160)"; done >> /tmp/scan-private.$$
while IFS= read -r l; do hit "$l"; done < /tmp/scan-private.$$
rm -f /tmp/scan-private.$$

if command -v tesseract >/dev/null 2>&1; then
  for f in $(git ls-files -co --exclude-standard '*.png'); do
    # Owner-approved screenshots (test/scan-approved.txt), skipped only while unchanged.
    sum=$(shasum -a 256 "$f" | cut -d" " -f1)
    grep -q -x "$sum $f" test/scan-approved.txt 2>/dev/null && continue
    t=$(tesseract "$f" - 2>/dev/null)
    printf '%s' "$t" | grep -i -E "$me|/Users/|claude-[0-9]+|private/tmp/claude|@[a-z0-9-]+\.(com|net|org)" >/dev/null && hit "png: $f names a private path, user or email"
    printf '%s' "$t" | grep -E '^(Spaces|Agents|Add machine)$' >/dev/null && hit "png: $f shows the Herdr sidebar"
  done
else
  echo "tesseract not installed: PNGs not checked"
fi
[ "$hits" -eq 0 ] && echo "scan: clean" && exit 0
exit 1
