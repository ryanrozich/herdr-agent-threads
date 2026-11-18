#!/bin/sh
# Copies the mod into Herdr's mods folder and checks it. The mod's name is its one folder
# under mods/.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
name=$(basename "$(ls -d "$here"/mods/*/ | head -n 1)")
dest="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/$name"
mkdir -p "$dest"
rsync -a --delete --exclude '.DS_Store' --exclude 'gpui-kit.d.ts' --exclude 'jsconfig.json' "$here/mods/$name/" "$dest/"
chmod +x "$dest/core/extract.sh"
# The settings card shows the version and, from a clone, the commit it was installed from
# (version.js). Only the installed copy's build.js changes; without git or a release tag it
# keeps the repo's null, which reads as "commit not known". Only a clone of this repo counts:
# a folder copied into some other git repo would describe that repo's tags.
build=""
top=$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$top" ] && [ "$(cd "$top" && pwd -P)" = "$(cd "$here" && pwd -P)" ]; then
  build=$(git -C "$here" describe --tags --match 'v[0-9]*' --long --dirty 2>/dev/null || true)
fi
# Only the exact shape version.js parseBuild reads ("v1.0.0-3-gabc1234", "-dirty" at the
# end) gets in, so no other text from a tag name reaches build.js. Anything else writes the
# "commit not known" file.
if printf '%s\n' "$build" | grep -Eqx 'v[0-9]+\.[0-9]+\.[0-9]+-[0-9]+-g[0-9a-f]{7,40}(-dirty)?'; then
  line="export const BUILD = \"$build\";"
else
  line="export const BUILD = null;"
fi
tmp=$(mktemp "$dest/.build.XXXXXX")
printf '%s\n' "$line" > "$tmp"
mv "$tmp" "$dest/build.js"
herdr-app check "$dest"
