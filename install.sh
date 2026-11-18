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
case "$build" in
  v[0-9]*)
    tmp=$(mktemp "$dest/.build.XXXXXX")
    printf 'export const BUILD = "%s";\n' "$build" > "$tmp"
    mv "$tmp" "$dest/build.js"
    ;;
esac
herdr-app check "$dest"
