#!/bin/sh
# Renames the mod: its folder under mods/, name.js, the keys.json chord, the docs, the tests
# and its command names ("<name>.next"). The repository's own name and the history under
# docs/ are left as they are. Usage: sh rename.sh <new-name>   (lowercase letters, digits, -)
set -eu
cd "$(dirname "$0")"
new=${1:-}
case $new in "" | *[!a-z0-9-]* | -*) echo "usage: sh rename.sh <new-name> (lowercase letters, digits and -)" >&2; exit 2 ;; esac
old=$(basename "$(ls -d mods/*/ | head -n 1)")
[ "$old" != "$new" ] || { echo "already $new"; exit 0; }
[ ! -e "mods/$new" ] || { echo "mods/$new exists" >&2; exit 1; }
git mv "mods/$old" "mods/$new"
# Whole-word uses only: mods/<old>, data/<old>, <old>.command, mod.open:<old>. Not the
# repository slug (owner/<old>) or temp-file prefixes (/tmp/<old>.XXXXXX, <old>-img).
files=$(git ls-files README.md RECIPE.md keys.json .gitignore docs/usage.md docs/develop.md docs/listing.md 'test/*.js' "mods/$new/*")
OLD=$old NEW=$new perl -i -pe '
  next if /PREVIOUS =/;
  s{(\b[\w.-]+/)?(?<![\w.-])\Q$ENV{OLD}\E(?![\w-])}{
    my $p = $1 // "";
    ($p eq "" || $p =~ m{^(mods|data)/$}) ? "$p$ENV{NEW}" : "$p$ENV{OLD}"
  }ge' $files
# The old name joins PREVIOUS, so a settings file saved under it is adopted.
OLD=$old perl -i -pe 's{(PREVIOUS = \[)}{$1"$ENV{OLD}", }' "mods/$new/name.js"
echo "renamed $old to $new. Run bun test, then ./install.sh (the old copy in Herdr's mods/ stays until you delete it)."
