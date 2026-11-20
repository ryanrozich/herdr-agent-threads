#!/bin/sh
# Takes one still of the Threads pane in a real Herdr on Linux, as evidence in a ticket's run:
# a virtual display, an isolated Herdr with this checkout's mod, a pane reading a transcript,
# a shot, then the app, its core and the display stopped and their folder removed, all in this
# one command (nothing has to outlive a setup step). Herdr comes from the install-herdr setup
# step in .catalyst/catalyst.toml (under HERDR_RIG, default ~/.cache/herdr-rig), and the
# display packages from its system_packages. It takes no still, and exits non-zero, when an
# overlay covers the window or Herdr reports an error, so a covered picture is never a pass.
# Usage: sh test/herdr-still.sh <transcript.jsonl> <out.png> [--px 500] [--theme dark|light]
#          [--size 1460x1150] [--do <command>]...
#   --do runs a mod command before the shot, one second apart: --do agent-threads.pin
set -u
usage() { sed -n '9,11p' "$0" >&2; exit 2; }
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
[ -f "$TR" ] || fail "no transcript at $TR"
case $THEME in dark | light) ;; *) usage ;; esac
W=${SIZE%x*}
H=${SIZE#*x}
case $W$H$PX in *[!0-9]*) usage ;; esac
RIG=${HERDR_RIG:-$HOME/.cache/herdr-rig}
APP=$RIG/.local/bin/herdr-app
[ -x "$APP" ] || fail "no Herdr at $APP: the install-herdr setup step puts it there"
command -v Xvfb >/dev/null || fail "no Xvfb: it comes from the settings file's system_packages"
command -v jq >/dev/null || fail "no jq"

R=$(mktemp -d "${TMPDIR:-/tmp}/herdr-still.XXXXXX") || exit 2
A=$R/a
XPID=""
APID=""
cleanup() {
  [ -n "$APID" ] && { h "do" app.quit >/dev/null 2>&1; sleep 1; kill "$APID" 2>/dev/null; }
  # The core and anything it started carry the folder in their environment.
  for p in /proc/[0-9]*; do
    grep -qs "$R" "$p/environ" && kill "${p#/proc/}" 2>/dev/null
  done
  [ -n "$XPID" ] && kill "$XPID" 2>/dev/null
  rm -rf "$R"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

mkdir -p "$A/mods" "$R/code"
cp -R mods/agent-threads "$A/mods/agent-threads"
# A fresh app home shows the Welcome card, which no close command removes; the card records
# its outcome here and does not show again.
printf '{"frame.welcomed":"skipped"}\n' > "$A/shared.json"
# A fresh home also toasts "Updated to <version>" in the corner; a note that this version has
# already run stops it.
v=$("$APP" --version 2>/dev/null | awk 'NR == 1 { print $NF }')
[ -n "$v" ] && printf '{"last_run":"%s","presented":[]}\n' "$v" > "$A/update-notes.json"
if [ "$THEME" = light ]; then printf '{ "zoom": 1, "appearance": "light" }\n'; else printf '{ "zoom": 1 }\n'; fi > "$A/settings.json"
printf '{"state":"windowed","bounds":[40.0,40.0,%s.0,%s.0]}\n' "$W" "$H" > "$A/window.json"

n=99
while [ -e "/tmp/.X11-unix/X$n" ] && [ $n -lt 140 ]; do n=$((n + 1)); done
Xvfb ":$n" -screen 0 "$((W + 80))x$((H + 80))x24" -nolisten tcp > "$R/xvfb.log" 2>&1 &
XPID=$!
i=0
while [ ! -e "/tmp/.X11-unix/X$n" ]; do
  i=$((i + 1))
  [ $i -le 20 ] || fail "the virtual display :$n did not start: $(tail -3 "$R/xvfb.log")"
  sleep 0.5
done

h() {
  env -u HC_SOCKET -u HC_TERMINAL_SOCKET -u HC_TERMINAL_ID -u HC_SCOPE \
    HOME="$R" HERDR_APP_HOME="$A" HC_SESSION="still$n" DISPLAY=":$n" DO_NOT_TRACK=1 HERDR_TELEMETRY=0 \
    HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 "$APP" "$@"
}
h > "$R/app.log" 2>&1 &
APID=$!
i=0
until h status > "$R/status.json" 2>/dev/null && [ -s "$R/status.json" ]; do
  i=$((i + 1))
  kill -0 "$APID" 2>/dev/null || fail "Herdr stopped: $(tail -5 "$R/app.log")"
  [ $i -le 60 ] || fail "Herdr did not answer status in 60 s"
  sleep 1
done
# No overlay over the window and no error, or no still.
check() {
  h status > "$R/status.json" 2>/dev/null || fail "Herdr did not answer status"
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
h "do" layout.resize --id "$TP" --px "$PX" > /dev/null
h "do" pane.focus --pane "$TP" > /dev/null
sleep 3
printf '%s' "$DOS" | while IFS= read -r c; do
  [ -n "$c" ] || continue
  h "do" "$c" > /dev/null || echo "herdr-still: $c failed" >&2
  sleep 1
done
check "before the shot"
h shot "$OUT" > /dev/null || fail "shot failed"
[ -s "$OUT" ] || fail "no picture written"
echo "$OUT"
