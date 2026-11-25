#!/bin/sh
# Takes one still of the Threads pane in a real Herdr on Linux, as evidence in a ticket's run:
# a virtual display, an isolated Herdr with this checkout's mod, a pane reading a transcript,
# a shot, then the app, its core and the display stopped and their folder removed, all in this
# one command (nothing has to outlive a setup step). Herdr is the pinned release that
# test/herdr-install.sh (the install-herdr setup step) put in HERDR_RIG, by default .herdr-rig
# in this checkout. Exit codes: 0 a still was written; 2 bad arguments or not Linux; 3 no
# Herdr installed; 4 the whole run passed its deadline (HERDR_STILL_DEADLINE, 240 s); 1
# anything else, including an overlay over the window, an error Herdr reports, or a --do
# command that failed or that the mod did not act on, so a wrong picture is never a pass.
# Usage: sh test/herdr-still.sh <transcript.jsonl> <out.png> [--px 500] [--theme dark|light]
#          [--size 1460x1150] [--do <command>]...
#   --do runs a command before the shot, one second apart: --do agent-threads.pin
# The app gets a clean environment (env -i): its own display, home, XDG folders and temp
# folder inside a fresh folder, no Wayland or session bus. Its proxy variables point at a
# closed port as a courtesy to programs that read them; they are not a network limit.
# HERDR_STILL_SHOW_ENV=1 prints that environment and exits, starting nothing; HERDR_STILL_X11
# is where the display's socket appears (/tmp/.X11-unix), for test/herdr-still.test.js.
set -u
usage() { sed -n '11,13p' "$0" >&2; exit 2; }
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
RIG=$(abs "${HERDR_RIG:-.herdr-rig}")
APP=$RIG/bin/herdr-app
X11=${HERDR_STILL_X11:-/tmp/.X11-unix}

# The processes that run already: the cleanup leaves them alone.
OLD=$(echo /proc/[0-9]*)
R=$(mktemp -d "${TMPDIR:-/tmp}/herdr-still.XXXXXX") || exit 2
# As the system gives a working folder: links followed.
R=$(cd "$R" && pwd -P) || exit 2
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
    HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 ALL_PROXY=http://127.0.0.1:9 NO_PROXY= "$@" 3>&-
}
# In the background with wait, so the deadline's signal ends a call that hangs at once; the
# subshell execs, so HPID is the timeout process, which passes a kill on to the call.
HPID=""
# HPID is cleared once the call is reaped, so cleanup never signals a reaped pid.
h() {
  (X="exec"; appenv timeout -k 5 30 "$APP" "$@") &
  HPID=$!
  wait "$HPID"
  hs=$?
  HPID=""
  return "$hs"
}
WPID=""
DONE=""
cleanup() {
  # A deadline that passes during cleanup cannot cut it short.
  trap '' USR1
  [ -n "$DONE" ] && return
  DONE=1
  [ -n "$WPID" ] && kill "$WPID" 2> /dev/null
  [ -n "$HPID" ] && kill "$HPID" 2> /dev/null
  [ -n "$APID" ] && { appenv timeout -k 2 8 "$APP" "do" app.quit > /dev/null 2>&1; sleep 1; kill "$APID" 2> /dev/null; }
  # The core and anything it started have the folder in their command line or work in it. A
  # process that ran before this script is never one of them. No environment is read.
  for p in /proc/[0-9]*; do
    case " $OLD " in *" $p "*) continue ;; esac
    grep -qsF "$R" "$p/cmdline" && { kill "${p#/proc/}" 2> /dev/null; continue; }
    case $(readlink "$p/cwd" 2> /dev/null)/ in "$R"/* | "$R (deleted)/") kill "${p#/proc/}" 2> /dev/null ;; esac
  done
  [ -n "$XPID" ] && kill "$XPID" 2> /dev/null
  rm -rf "$R"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
if [ "${HERDR_STILL_SHOW_ENV:-}" = 1 ]; then appenv env; exit 0; fi
DEADLINE=${HERDR_STILL_DEADLINE:-240}
case $DEADLINE in "" | *[!0-9]*) usage ;; esac
# One deadline for the whole run: a watcher signals this shell when it passes, and the
# trap names it and exits 4 through the same cleanup. It writes to fd 3, the script's own
# stderr, since it can run inside a call whose stderr is sent elsewhere.
exec 3>&2
trap 'echo "herdr-still: the run passed its ${DEADLINE} s deadline" >&3; exit 4' USR1
(trap 'kill "$s" 2> /dev/null; exit 0' TERM; sleep "$DEADLINE" 3>&- & s=$!; wait "$s" && kill -USR1 $$) 3>&- &
WPID=$!

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

# In the run's folder: the core it starts names only the rig in its command line, but keeps the
# folder it was started in, so the cleanup finds it by that.
(cd "$R" && X="exec" && appenv "$APP") > "$R/app.log" 2>&1 &
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
# A command that fails stops here: no still of the state before it. Herdr answers ok and
# exits 0 for any agent-threads.<name>, one the mod has or not, so for those the pane's debug
# report (props debug) says whether the mod acted on it: a new entry with that name (the part
# before any colon), within 6 s (the report is written once a second). Any command that names
# this mod, in any case, takes that check. The loop's own names (cmd, was, seen, want) never
# reuse n, which holds the display number for every call to Herdr.
said() { jq -r --arg t "$T" ".\"threads.debug\"[\$t].command.$1 // empty" "$A/shared.json" 2> /dev/null || true; }
printf '%s' "$DOS" > "$R/do.txt"
while IFS= read -r cmd; do
  cmd=$(printf '%s' "$cmd" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  [ -n "$cmd" ] || continue
  was=$(said n)
  h "do" "$cmd" > "$R/do.out" 2> "$R/do.err" || fail "--do $cmd failed: $(tail -2 "$R/do.err") $(tail -c 300 "$R/do.out")"
  case $(printf '%s' "$cmd" | tr '[:upper:]' '[:lower:]') in
    agent-threads.*)
      want=$(printf '%s' "$cmd" | cut -c 15-)
      want=${want%%:*}
      i=0
      while seen=$(said n) && { [ -z "$seen" ] || [ "$seen" = "$was" ]; }; do
        i=$((i + 1))
        [ $i -le 6 ] || fail "--do $cmd: the Threads pane did not report it"
        sleep 1
      done
      [ "$(said name)" = "$want" ] && [ "$(said acted)" = true ] \
        || fail "--do $cmd: the mod did not act on it (not one of its commands, or nothing to do)"
      ;;
  esac
  sleep 1
done < "$R/do.txt"
check "before the shot"
h shot "$OUT" > /dev/null || fail "shot failed"
[ -s "$OUT" ] || fail "no picture written"
echo "$OUT"
