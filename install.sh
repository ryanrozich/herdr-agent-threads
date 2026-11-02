#!/bin/sh
# Copies the mod into Herdr's mods folder and checks it. The mod's name is its one folder
# under mods/.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
name=$(basename "$(ls -d "$here"/mods/*/ | head -n 1)")
dest="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/$name"
mkdir -p "$dest"
rsync -a --delete --exclude '.DS_Store' --exclude 'gpui-kit.d.ts' --exclude 'jsconfig.json' "$here/mods/$name/" "$dest/"
chmod +x "$dest/extract.sh"
herdr-app check "$dest"
