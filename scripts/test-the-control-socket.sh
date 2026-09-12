#!/usr/bin/env bash
# Every running desktop answers a control socket, and each one answers its own.
#
#   ./scripts/test-the-control-socket.sh
#
# The unit tests own the socket's rules — what its name is made of, what
# happens to a stale one, what a line that is not a request gets back. This
# owns the wiring, which is the half they cannot reach: that the *binary* takes
# a socket of its own when it starts a desktop, says which one in DOMICILE_SOCK,
# answers on it from a thread while the supervisor is blocked waiting on its
# components, and that a second `domicile` on the same session comes up beside
# the first with a socket of its own rather than being refused.
#
# TWO DESKTOPS IS THE POINT OF THIS SCRIPT and it used to assert the opposite.
# A compositor that will not start because another compositor is running is not
# something Wayland, sway, Hyprland or river does, and it was not something
# Domicile should have done either.
#
# THE POSITIVE READING COMES FIRST, the same way
# `test-a-desktop-that-fails-says-why.sh` does it: a command that reaches a
# desktop and comes back with the right answer, before any of the refusals mean
# anything. "The command was refused" and "the desktop never came up" look
# identical from the outside otherwise.
#
# The two components are shell scripts here. Nothing about the supervisor cares
# what they are, and a real engine takes four hours to build and needs a
# display.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${CARGO_TARGET_DIR:-$ROOT/target}"

command -v cargo >/dev/null 2>&1 || { echo "SKIP: no cargo"; exit 77; }

echo "== building domicile =="
( cd "$ROOT" && cargo build -q -p domicile-launch --bin domicile ) || {
  echo "FAIL: domicile would not build"; exit 1; }
DOMICILE="$TARGET/debug/domicile"
[ -x "$DOMICILE" ] || { echo "FAIL: no binary at $DOMICILE"; exit 1; }

WORK="$(mktemp -d)"
DESKTOPS=""
cleanup() {
  for desktop in $DESKTOPS; do
    kill "$desktop" 2>/dev/null
    wait "$desktop" 2>/dev/null
  done
  # The fake components outlive a supervisor killed with a signal: nothing runs
  # its cleanup, which is true of the real ones too.
  pkill -f "$WORK/engine/chrome" 2>/dev/null
  pkill -f "$WORK/domicile-compositor" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# One shell each, so that "which desktop answered" is a question the answer can
# be wrong about. Nothing loads either — the engine here is a shell script —
# but they are the files `which-shell` has to name.
mkdir -p "$WORK/first" "$WORK/second"
: >"$WORK/first/shell.js"
: >"$WORK/second/shell.js"

# The engine: creates the broker socket it was told to create, then stays alive.
mkdir -p "$WORK/engine"
cat >"$WORK/engine/chrome" <<'ENGINE'
#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    --domicile-broker-socket=*) broker="${arg#*=}" ;;
  esac
done
: >"$broker"
exec sleep 60
ENGINE
chmod +x "$WORK/engine/chrome"

# The compositor: publishes the session document, then stays alive. It also
# writes the DOMICILE_SOCK it was started with, which is the half of the
# hand-off no unit test can see: the supervisor puts the path in the
# compositor's environment, and every app the compositor spawns inherits it
# from there.
cat >"$WORK/domicile-compositor" <<'COMPOSITOR'
#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in --session) session="$2"; shift ;; esac
  shift
done
printf '%s' "${DOMICILE_SOCK-}" >"$session.sock-it-was-given"
: >"$session"
exec sleep 60
COMPOSITOR
chmod +x "$WORK/domicile-compositor"

mkdir -p "$WORK/runtime"
# `headless` because there is no display here and `platform` refuses to guess.
# One XDG_RUNTIME_DIR for both desktops, which is the whole question this
# script asks: a session is one runtime directory and may hold several
# desktops.
run_domicile() {
  env OZONE=headless \
      XDG_RUNTIME_DIR="$WORK/runtime" \
      DOMICILE_ENGINE="$WORK/engine" \
      DOMICILE_COMPOSITOR="$WORK/domicile-compositor" \
      "$DOMICILE" "$@"
}

# Put one command to the desktop answering at $1, the way a terminal started
# inside that desktop would have it in its environment.
ask_desktop() {
  env DOMICILE_SOCK="$1" "$DOMICILE" which-shell 2>&1
}

FAILED=0

# Start a desktop on $2, logging to $1, and wait until it is up. Sets UP_SOCK
# to the socket it said it was answering on and UP_PID to its process.
start_desktop() {
  local log="$1" shell="$2" waited=0
  run_domicile "$shell" >"$log" 2>&1 &
  DESKTOPS="$DESKTOPS $!"
  while ! grep -q "domicile is up" "$log" 2>/dev/null; do
    if [ "$waited" -ge 100 ]; then
      echo "FAIL: the desktop on $shell never came up, so nothing below would"
      echo "      mean anything. What it said:"
      sed 's/^/    /' "$log"
      exit 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  UP_SOCK="$(sed -n 's/^DOMICILE_SOCK=//p' "$log")"
  if [ -z "$UP_SOCK" ]; then
    echo "FAIL: the desktop on $shell came up without saying where it answers."
    echo "      A socket nothing names is a socket nothing can reach:"
    sed 's/^/    /' "$log"
    exit 1
  fi
  # Read back out of the name rather than taken from `$!`, which is the
  # subshell the background job runs in and not always the supervisor itself.
  # The pid in the socket's name is the supervisor's by construction, and it
  # is also what its run directory is named after.
  UP_PID="${UP_SOCK##*domicile-ipc.}"
  UP_PID="${UP_PID%.sock}"
  DESKTOPS="$DESKTOPS $UP_PID"
}

# ---- a desktop that is up, and is asked -----------------------------------

echo "== a desktop comes up and takes a control socket of its own =="
start_desktop "$WORK/first.log" "$WORK/first/shell.js"
FIRST_SOCK="$UP_SOCK"
FIRST_PID="$UP_PID"
echo "PASS: it is answering at $FIRST_SOCK"

echo "== which-shell names the module the desktop is running =="
SAID="$(ask_desktop "$FIRST_SOCK")"
if [ "$SAID" = "$WORK/first/shell.js" ]; then
  echo "PASS: $SAID"
else
  echo "FAIL: which-shell said '$SAID', and the desktop is running"
  echo "      $WORK/first/shell.js"
  FAILED=1
fi

echo "== the compositor is started with the socket to hand on to its apps =="
# What an app spawned by the shell inherits. A desktop whose compositor never
# saw DOMICILE_SOCK is one where `domicile which-shell` typed into its own
# terminal finds nothing.
GIVEN="$(cat "$WORK/runtime/domicile-$FIRST_PID/session.json.sock-it-was-given" 2>/dev/null)"
if [ "$GIVEN" = "$FIRST_SOCK" ]; then
  echo "PASS: the compositor was handed $GIVEN"
else
  echo "FAIL: the compositor was handed '$GIVEN', and the desktop answers at"
  echo "      $FIRST_SOCK"
  FAILED=1
fi

# ---- the second desktop ---------------------------------------------------

echo "== a second desktop on the same session comes up beside the first =="
start_desktop "$WORK/second.log" "$WORK/second/shell.js"
SECOND_SOCK="$UP_SOCK"
SECOND_PID="$UP_PID"
if [ "$SECOND_SOCK" = "$FIRST_SOCK" ]; then
  echo "FAIL: both desktops took the same socket ($SECOND_SOCK), so one of"
  echo "      them is answering for the other."
  FAILED=1
else
  echo "PASS: it is answering at $SECOND_SOCK, and the first one still has"
  echo "      $FIRST_SOCK"
fi

echo "== each desktop answers for itself =="
MINE="$(ask_desktop "$SECOND_SOCK")"
THEIRS="$(ask_desktop "$FIRST_SOCK")"
if [ "$MINE" = "$WORK/second/shell.js" ] && [ "$THEIRS" = "$WORK/first/shell.js" ]; then
  echo "PASS: the second says $MINE and the first still says $THEIRS"
else
  echo "FAIL: the second desktop said '$MINE' (running $WORK/second/shell.js)"
  echo "      and the first said '$THEIRS' (running $WORK/first/shell.js)"
  FAILED=1
fi

# ---- nowhere to ask -------------------------------------------------------

echo "== asking from outside every desktop says so rather than guessing =="
OUTSIDE="$WORK/outside.log"
# Two desktops are running as this is asked, which is the point: there is a
# socket in the runtime directory that would answer, and two of them, and
# picking one would be picking for the person who typed the command.
if env -u DOMICILE_SOCK XDG_RUNTIME_DIR="$WORK/runtime" "$DOMICILE" which-shell \
     >"$OUTSIDE" 2>&1; then
  echo "FAIL: a command answered from outside every desktop:"
  sed 's/^/    /' "$OUTSIDE"
  FAILED=1
elif grep -q "DOMICILE_SOCK is not set" "$OUTSIDE"; then
  echo "PASS: $(grep -m1 'DOMICILE_SOCK is not set' "$OUTSIDE")"
else
  echo "FAIL: it failed for some other reason:"
  sed 's/^/    /' "$OUTSIDE"
  FAILED=1
fi

# ---- the desktop that is gone ---------------------------------------------

echo "== the socket a killed desktop left behind fails rather than hangs =="
# SIGKILL, so nothing unlinks the socket: this is what every terminal still
# open inside that desktop has in its environment afterwards.
kill -9 "$SECOND_PID" 2>/dev/null
wait "$SECOND_PID" 2>/dev/null
GONE="$WORK/gone.log"
if [ ! -S "$SECOND_SOCK" ]; then
  echo "FAIL: the killed desktop's socket is gone, so this proves nothing"
  echo "      about the case it exists for."
  FAILED=1
elif ask_desktop "$SECOND_SOCK" >"$GONE" 2>&1; then
  echo "FAIL: a desktop that is not running answered:"
  sed 's/^/    /' "$GONE"
  FAILED=1
elif grep -q "no desktop is running here" "$GONE"; then
  echo "PASS: $(grep -m1 'no desktop is running here' "$GONE")"
else
  echo "FAIL: it failed for some other reason:"
  sed 's/^/    /' "$GONE"
  FAILED=1
fi

exit "$FAILED"
