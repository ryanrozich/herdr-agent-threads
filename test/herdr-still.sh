#!/bin/sh
# Takes one still of the Threads pane in a real Herdr on Linux, as evidence in a ticket's run:
# a virtual display, an isolated Herdr with this checkout's mod, a pane reading a transcript,
# a shot, then the app, its core and the display stopped and their folder removed, all in this
# one command (nothing has to outlive a setup step). Herdr is the pinned release that
# test/herdr-install.sh (the install-herdr setup step) put in HERDR_RIG, by default .herdr-rig
# in this checkout. Exit codes: 0 a still was written; 2 bad arguments or not Linux; 3 no
# Herdr installed; 1 anything else, including an overlay over the window, an error Herdr
# reports, or a --do command that failed, so a picture of the wrong state is never a pass.
# Usage: sh test/herdr-still.sh <transcript.jsonl> <out.png> [--px 500] [--theme dark|light]
#          [--size 1460x1150] [--do <command>]...
#   --do runs a mod command before the shot, one second apart: --do agent-threads.pin
# The app gets a clean environment (env -i): its own display, home, XDG folders and temp
# folder inside a fresh folder, no Wayland or session bus, the network proxied to nowhere.
# HERDR_STILL_SHOW_ENV=1 prints that environment and exits, starting nothing; HERDR_STILL_X11
# is where the display's socket appears (/tmp/.X11-unix), for test/herdr-still.test.js.
set -u
usage() { sed -n '10,12p' "$0" >&2; exit 2; }
fail() { echo "herdr-still: $*" >&2; exit 1; }
[ $# -ge 2 ] || usage
abs() { case $1 in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$(pwd)" "$1" ;; esac; }
TR=$(abs "$1")
OUT=$(abs "$2")
shift 2
PX=500
THEME=dark
SIZE=1460x1150
DOS=""
while [ $# -gt 0 ]; do
  [ $# -ge 2 ] || usage
  case $1 in
    --px) PX=$2 ;;
    --theme) THEME=$2 ;;
    --size) SIZE=$2 ;;
    --do) DOS="$DOS$2
" ;;
    *) usage ;;
  esac
  shift 2
done
cd "$(dirname "$0")/.." || exit 2
case $THEME in dark | light) ;; *) usage ;; esac
W=${SIZE%x*}
H=${SIZE#*x}
case $W$H$PX in *[!0-9]*) usage ;; esac
RIG=${HERDR_RIG:-$(pwd)/.herdr-rig}
APP=$RIG/bin/herdr-app
X11=${HERDR_STILL_X11:-/tmp/.X11-unix}

R=$(mktemp -d "${TMPDIR:-/tmp}/herdr-still.XXXXXX") || exit 2
A=$R/a
n=99
XPID=""
APID=""
# Every Herdr call: the clean environment, and a time limit so a hung call cannot hold the
# cleanup. The app itself is started without one, with X=exec so its pid is the app's.
X=""
appenv() {
  $X env -i PATH="$RIG/bin:/usr/local/bin:/usr/bin:/bin" LANG=C.UTF-8 HOME="$R" TMPDIR="$R/tmp" \
    XDG_CONFIG_HOME="$R/config" XDG_DATA_HOME="$R/data" XDG_CACHE_HOME="$R/cache" XDG_STATE_HOME="$R/state" XDG_RUNTIME_DIR="$R/run" \
    DISPLAY=":$n" HERDR_APP_HOME="$A" HC_SESSION="still$n" DO_NOT_TRACK=1 HERDR_TELEMETRY=0 \
    HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 NO_PROXY= "$@"
}
h() { appenv timeout -k 5 30 "$APP" "$@"; }
cleanup() {
  [ -n "$APID" ] && { h "do" app.quit > /dev/null 2>&1; sleep 1; kill "$APID" 2> /dev/null; }
  # The core and anything it started carry the folder in their environment.
  for p in /proc/[0-9]*; do
    grep -qs "$R" "$p/environ" && kill "${p#/proc/}" 2> /dev/null
  done
  [ -n "$XPID" ] && kill "$XPID" 2> /dev/null
  rm -rf "$R"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
if [ "${HERDR_STILL_SHOW_ENV:-}" = 1 ]; then appenv env; exit 0; fi

# Only on Linux, where it starts its own display; never on a person's desktop session.
[ "$(uname -s)" = Linux ] || { echo "herdr-still: Linux only (this is $(uname -s))" >&2; exit 2; }
[ -f "$TR" ] || fail "no transcript at $TR"
[ -x "$APP" ] || { echo "herdr-still: no Herdr installed at $RIG: the install-herdr setup step did not run or did not install (its line in the setup log says why)" >&2; exit 3; }
for c in Xvfb jq timeout; do command -v "$c" > /dev/null || fail "no $c"; done

mkdir -p "$A/mods" "$R/code" "$R/tmp" "$R/config" "$R/data" "$R/cache" "$R/state" "$R/run" "$R/.local/bin"
chmod 700 "$R/run"
# The core where the app looks for it in a home.
ln -s "$RIG/bin/herdr-core" "$R/.local/bin/herdr-core"
ln -s herdr-core "$R/.local/bin/hc"
cp -R mods/agent-threads "$A/mods/agent-threads"
# A fresh app home shows the Welcome card, which no close command removes; the card records
# its outcome here and does not show again.
printf '{"frame.welcomed":"skipped"}\n' > "$A/shared.json"
# A fresh home also toasts "Updated to <version>" in the corner; a note that this version has
# already run stops it.
v=$(appenv timeout 30 "$APP" --version 2> /dev/null | awk 'NR == 1 { print $NF }')
[ -n "$v" ] && printf '{"last_run":"%s","presented":[]}\n' "$v" > "$A/update-notes.json"
if [ "$THEME" = light ]; then printf '{ "zoom": 1, "appearance": "light" }\n'; else printf '{ "zoom": 1 }\n'; fi > "$A/settings.json"
printf '{"state":"windowed","bounds":[40.0,40.0,%s.0,%s.0]}\n' "$W" "$H" > "$A/window.json"

while [ -e "$X11/X$n" ] && [ $n -lt 140 ]; do n=$((n + 1)); done
Xvfb ":$n" -screen 0 "$((W + 80))x$((H + 80))x24" -nolisten tcp > "$R/xvfb.log" 2>&1 &
XPID=$!
i=0
while [ ! -e "$X11/X$n" ]; do
  i=$((i + 1))
  [ $i -le 20 ] || fail "the virtual display :$n did not start: $(tail -3 "$R/xvfb.log")"
  sleep 0.5
done

(X="exec"; appenv "$APP") > "$R/app.log" 2>&1 &
APID=$!
i=0
until h status > "$R/status.json" 2> /dev/null && [ -s "$R/status.json" ]; do
  i=$((i + 1))
  kill -0 "$APID" 2> /dev/null || fail "Herdr stopped: $(tail -5 "$R/app.log")"
  [ $i -le 60 ] || fail "Herdr did not answer status in 60 s"
  sleep 1
done
# No overlay over the window and no error, or no still.
check() {
  h status > "$R/status.json" 2> /dev/null || fail "Herdr did not answer status"
  ov=$(jq -c '.overlays // "no overlays field"' "$R/status.json")
  [ "$ov" = "[]" ] || fail "an overlay covers the window ($1): $ov"
  er=$(jq -c '.errors // []' "$R/status.json")
  [ "$er" = "[]" ] || fail "Herdr reports errors ($1): $er"
}
check start

h "do" space.new --name still --folder "$R/code" --tab still --argv '["/bin/sh"]' > /dev/null || fail "space.new failed"
h ls > "$R/ls.json" || fail "ls failed"
P=$(jq -r '.spaces[] | select(.name == "still") | .tabs[0].terminals[0].pane' "$R/ls.json")
T=$(jq -r '.spaces[] | select(.name == "still") | .tabs[0].terminals[0].terminal' "$R/ls.json")
[ -n "$P" ] && [ "$P" != null ] || fail "no terminal in the new space"
PROPS=$(jq -cn --arg t "$T" --arg f "$TR" '{terminal: $t, transcript: $f, debug: true}')
TP=$(h "do" pane.split --pane "$P" --direction right --mod agent-threads --props "$PROPS" | jq -r '.pane // empty')
[ -n "$TP" ] || fail "the Threads pane did not open"
h "do" layout.resize --id "$TP" --px "$PX" > /dev/null || fail "layout.resize failed"
h "do" pane.focus --pane "$TP" > /dev/null || fail "pane.focus failed"
sleep 3
# A command that fails stops here: no still of the state before it.
printf '%s' "$DOS" > "$R/do.txt"
while IFS= read -r c; do
  [ -n "$c" ] || continue
  h "do" "$c" > /dev/null 2> "$R/do.err" || fail "--do $c failed: $(tail -2 "$R/do.err")"
  sleep 1
done < "$R/do.txt"
check "before the shot"
h shot "$OUT" > /dev/null || fail "shot failed"
[ -s "$OUT" ] || fail "no picture written"
echo "$OUT"
